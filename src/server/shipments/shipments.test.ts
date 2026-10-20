import { and, eq, inArray, like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import { agents, alerts, messages, quoteRequests, shipmentMilestones, shipments } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { formatShipmentDate } from "@/domain/shipment-texts";
import { createTestDb } from "@/test/db";
import { fakeAiClient, ok } from "@/test/fake-ai";
import { sendDraft } from "../inbox/actions";
import { storeClientInbound } from "../inbox/gateway";
import { processClientEmail } from "../inbox/process";
import { storeAgentMessage } from "../sales/gateway";
import { quoteDetail } from "../sales/views";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { processAgentStatusReply } from "./reading";
import { ensureShipmentsSeeded } from "./seed";
import { cancelShipment, confirmMilestone, createShipment, draftClientUpdate, requestAgentStatusNow, sendClientUpdate, updateShipmentSettings } from "./shipments";
import { shipmentDetail, shipmentFormOptions, shipmentPrefill, shipmentsOverview } from "./views";

const realStart = new Date("2026-10-20T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);
const H = 60;

describe("Shipments: agents asked automatically, client updates on time", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  let reached = 0;
  /** Ticks every 15 sim minutes up to the minute, like a page polling the server. */
  const advance = async (minute: number) => {
    let simNow = at(reached);
    for (let m = Math.min(reached + 15, minute); reached < minute; m = Math.min(m + 15, minute)) {
      for (let i = 0; ; i++) {
        const r = await runTick(db, sandbox.id, realAt(m));
        simNow = r.simNow;
        if (r.remaining === 0) break;
        if (i > 50) throw new Error("world did not catch up");
      }
      reached = m;
    }
    return simNow;
  };
  const openAlerts = (prefix: string) =>
    db
      .select()
      .from(alerts)
      .where(and(eq(alerts.sandboxId, sandbox.id), like(alerts.dedupeKey, `${prefix}%`)));

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, {
      ipHash: "shipments",
      realNow: realStart,
    });
  });

  it("seeds four shipments with a short history; agent threads carry no client data", async () => {
    const list = await shipmentsOverview(db, sandbox.id, at(0));
    expect(list.map((s) => s.number).sort()).toEqual(["KOL-2001", "LOT-2001", "MOR-2001", "MOR-2002"]);
    const mor = await shipmentDetail(db, sandbox.id, "shp-demo-mor1", at(0));
    expect(mor.status).toBe("w_drodze");
    expect(mor.milestones.filter((m) => m.actual).map((m) => m.kind)).toEqual(["booking", "terminal_in", "departed"]);
    expect(mor.map.lastConfirmed?.name).toBe("Szanghaj");
    expect(mor.map.middle?.name).toBe("Rotterdam");
    expect(mor.map.path.length).toBeGreaterThan(30);
    for (const m of mor.agentThread) expect(m.body).not.toMatch(/Mazovia|Pawlak|MZE-PO-2291|mazovia-electronics/i);
    expect(mor.clientThread).toHaveLength(1);
  });

  it("reminds a silent agent and tells the forwarder a client update is due soon", async () => {
    await advance(5);
    const kol = await shipmentDetail(db, sandbox.id, "shp-demo-kol1", at(5));
    expect(kol.agentThread.at(-1)).toMatchObject({
      kind: "shipment_status_reminder",
      direction: "out",
    });
    expect(kol.agentThread.at(-1)?.body).toMatch(/friendly reminder/);
    // MOR-2002: first client update due 1.5 h after the start → reminder now; and its agent gets the first status request.
    expect(await openAlerts("shipment:shp-demo-mor2:client_soon")).toHaveLength(1);
    const mor2 = await shipmentDetail(db, sandbox.id, "shp-demo-mor2", at(5));
    expect(mor2.agentThread.at(-1)).toMatchObject({
      kind: "shipment_status_request",
    });
    expect(mor2.agentThread.at(-1)?.body).not.toMatch(/Sudety|Michalak|SP\/EXP/);
  });

  it("sends the automatic client update of the flight on time, with the facts only", async () => {
    await advance(70);
    const lot = await shipmentDetail(db, sandbox.id, "shp-demo-lot1", at(70));
    const auto = lot.clientThread.filter((m) => m.kind === "shipment_update_auto");
    expect(auto).toHaveLength(2);
    expect(auto.at(-1)?.body).toContain(formatShipmentDate(new Date(lot.etaCurrent).getTime()));
    expect(auto.at(-1)?.body).not.toMatch(/Warsaw Air Cargo|Kurek|waw-aircargo/i);
    expect(lot.clientUpdate.next).toBe(new Date(new Date(auto.at(-1)!.atSim).getTime() + 12 * 3_600_000).toISOString());
  });

  it("reads the agent's answer: new ETA, the reason, one alert, client update brought forward", async () => {
    // MOR-2001: regular request 2 h after the start; the agent reports congestion in Rotterdam.
    await advance(8 * H);
    const mor = await shipmentDetail(db, sandbox.id, "shp-demo-mor1", at(8 * H));
    const reply = mor.agentThread.find((m) => m.kind === "shipment_status_reply" && new Date(m.atSim) > at(0));
    expect(reply, "Baltic Ocean answered the status request").toBeTruthy();
    expect(reply!.classifiedBy).toBe("rules");
    expect(mor.delayHours).toBe(52);
    expect(mor.statusNote).toMatch(/Rotterdam/);
    const eta = await openAlerts("shipment:shp-demo-mor1:eta");
    expect(eta).toHaveLength(1);
    expect(eta[0]).toMatchObject({
      severity: "warning",
      actions: ["otworz_przesylke"],
    });
    expect(eta[0].title).toBe("MOR-2001: ETA później o 2 dni");
    // No separate "update due soon" alert for the same news.
    expect(await openAlerts("shipment:shp-demo-mor1:client_soon")).toHaveLength(0);
    expect(new Date(mor.clientUpdate.next!).getTime()).toBeLessThan(new Date(reply!.atSim).getTime() + 2 * 3_600_000);
  });

  it("drafts the client update from facts and refuses agent data typed in by hand", async () => {
    const simNow = await advance(8 * H + 10);
    const draftId = await draftClientUpdate(db, sandbox.id, "shp-demo-mor1", simNow);
    const mor = await shipmentDetail(db, sandbox.id, "shp-demo-mor1", simNow);
    expect(mor.draft?.id).toBe(draftId);
    expect(mor.draft?.body).toContain(formatShipmentDate(new Date(mor.etaCurrent).getTime()));
    expect(mor.draft?.body).toMatch(/opóźnienie ok\. 2 dni — kongestia w porcie Rotterdam/);
    expect(mor.draft?.body).not.toMatch(/Baltic Ocean|Nowicka/);
    await expect(
      sendClientUpdate(
        db,
        sandbox.id,
        "shp-demo-mor1",
        draftId,
        {
          subject: mor.draft!.subject,
          body: `${mor.draft!.body}\nInfo od Karoliny Nowickiej z Baltic Ocean Lines.`,
        },
        simNow,
      ),
    ).rejects.toThrow(/dane agenta/);
    await expect(
      sendClientUpdate(
        db,
        sandbox.id,
        "shp-demo-mor1",
        draftId,
        {
          subject: mor.draft!.subject,
          body: `${mor.draft!.body}\nKoszt dodatkowy 350 EUR.`,
        },
        simNow,
      ),
    ).rejects.toThrow(/kwotę/);
    await sendClientUpdate(db, sandbox.id, "shp-demo-mor1", draftId, { subject: mor.draft!.subject, body: mor.draft!.body }, simNow);
    const after = await shipmentDetail(db, sandbox.id, "shp-demo-mor1", simNow);
    expect(after.draft).toBeNull();
    expect(after.clientThread.at(-1)).toMatchObject({
      kind: "shipment_update",
      state: "sent",
    });
    expect(after.clientUpdate.next).toBe(new Date(simNow.getTime() + 48 * 3_600_000).toISOString());
    const open = (await openAlerts("shipment:shp-demo-mor1:")).filter((a) => a.status !== "resolved");
    expect(open).toHaveLength(0);
  });

  it("creates a shipment from the form and checks lane, agent and contact", async () => {
    const simNow = await advance(8 * H + 20);
    const base = {
      mode: "sea" as const,
      clientId: "cl-odra",
      contactId: "ct-odra-1",
      agentId: "ag-north-star",
      originId: "port-ningbo",
      destinationId: "port-gdansk",
      etd: new Date(simNow.getTime() + 5 * 86_400_000).toISOString(),
      eta: new Date(simNow.getTime() + 43 * 86_400_000).toISOString(),
      cargo: "1 × 20', chemia w beczkach",
      refs: { booking: "NGBGDN-1", clientRef: "OC-55" },
    };
    await expect(createShipment(db, sandbox.id, { ...base, destinationId: "port-newyork" }, simNow)).rejects.toThrow(/Tej trasy nie ma/);
    await expect(createShipment(db, sandbox.id, { ...base, agentId: "ag-skyline" }, simNow)).rejects.toThrow(/nie obsługuje/);
    await expect(createShipment(db, sandbox.id, { ...base, contactId: "ct-meble-1" }, simNow)).rejects.toThrow(/nie należy/);
    await expect(createShipment(db, sandbox.id, { ...base, eta: base.etd }, simNow)).rejects.toThrow(/ETA musi/);
    const id = await createShipment(db, sandbox.id, base, simNow);
    const s = await shipmentDetail(db, sandbox.id, id, simNow);
    expect(s).toMatchObject({
      number: "MOR-2003",
      status: "planowana",
      origin: "Ningbo",
      destination: "Gdańsk (DCT)",
    });
    expect(s.milestones[0]).toMatchObject({
      kind: "booking",
      source: "dispatcher",
    });
    expect(s.milestones.some((m) => m.kind === "transshipment" && m.location === "Rotterdam")).toBe(true);
    // No request right after booking: the regular rhythm starts now.
    expect(s.agentThread).toHaveLength(0);
    expect(s.schedule.nextAgentRequest).toBe(new Date(simNow.getTime() + 48 * 3_600_000).toISOString());
    const options = await shipmentFormOptions(db, sandbox.id);
    expect(options.lanes.some((l) => l.mode === "sea" && l.from === "port-ningbo" && l.to === "port-gdansk")).toBe(true);
    expect(options.agents.find((a) => a.id === "ag-multi")?.modes.sort()).toEqual(["air", "rail", "sea"]);
  });

  it("lets the forwarder confirm a milestone, ask now, change the rhythm and cancel", async () => {
    const simNow = await advance(8 * H + 30);
    const [s] = await db
      .select()
      .from(shipments)
      .where(and(eq(shipments.sandboxId, sandbox.id), eq(shipments.number, "MOR-2003")));
    const before = await shipmentDetail(db, sandbox.id, s.id, simNow);
    const departed = before.milestones.find((m) => m.kind === "departed")!;
    await expect(confirmMilestone(db, sandbox.id, s.id, departed.id, new Date(simNow.getTime() + 5 * 3_600_000).toISOString(), simNow)).rejects.toThrow(/przyszłości/);
    await confirmMilestone(db, sandbox.id, s.id, departed.id, null, simNow);
    const after = await shipmentDetail(db, sandbox.id, s.id, simNow);
    expect(after.status).toBe("w_drodze");
    expect(after.milestones.find((m) => m.kind === "departed")).toMatchObject({
      source: "dispatcher",
      actual: simNow.toISOString(),
    });

    await requestAgentStatusNow(db, sandbox.id, s.id, simNow);
    await expect(requestAgentStatusNow(db, sandbox.id, s.id, simNow)).rejects.toThrow(/przed chwilą/);
    const [req] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.sandboxId, sandbox.id), eq(messages.threadKey, `shp:${s.id}:agent`)));
    expect(req).toMatchObject({
      sentBy: "dispatcher",
      kind: "shipment_status_request",
    });
    expect(req.body).not.toMatch(/Odra|Sikora|OC-55/);

    await expect(updateShipmentSettings(db, sandbox.id, s.id, { clientEveryHours: 2 }, simNow)).rejects.toThrow(/4 h/);
    await updateShipmentSettings(db, sandbox.id, s.id, { clientEveryHours: 24, autoClientUpdates: true }, simNow);
    const set = await shipmentDetail(db, sandbox.id, s.id, simNow);
    expect(set.settings).toMatchObject({
      clientEveryHours: 24,
      autoClientUpdates: true,
    });
    expect(set.clientUpdate.next).toBe(new Date(simNow.getTime() + 24 * 3_600_000).toISOString());

    await cancelShipment(db, sandbox.id, s.id, simNow);
    await expect(requestAgentStatusNow(db, sandbox.id, s.id, simNow)).rejects.toThrow(/zamknięta/);
  });

  it("turns a won sea quote into a shipment: prefilled from the quote, one shipment per quote", async () => {
    const simNow = await advance(8 * H + 40);
    const mailId = await storeClientInbound(db, sandbox.id, {
      contactId: "ct-sudety-1",
      subject: "Wycena — kontener do Chin",
      body: "Dzień dobry,\nprosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t.\nLeszek Michalak, Sudety Papier",
      atSim: simNow,
    });
    await processClientEmail(db, sandbox.id, mailId, { simNow });
    const [q] = await db.select().from(quoteRequests).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.sourceMessageId, mailId)));
    await expect(shipmentPrefill(db, sandbox.id, q.id)).resolves.toMatchObject({ mode: "sea", originId: "port-gdansk", destinationId: "port-shanghai", clientId: "cl-sudety" });
    const input = {
      mode: "sea" as const,
      clientId: "cl-sudety",
      contactId: "ct-sudety-1",
      agentId: "ag-baltic-sea",
      originId: "port-gdansk",
      destinationId: "port-shanghai",
      etd: new Date(simNow.getTime() + 6 * 86_400_000).toISOString(),
      eta: new Date(simNow.getTime() + 46 * 86_400_000).toISOString(),
      quoteId: q.id,
    };
    await expect(createShipment(db, sandbox.id, input, simNow)).rejects.toThrow(/wygranej/);
    await db.update(quoteRequests).set({ status: "wygrana" }).where(and(eq(quoteRequests.sandboxId, sandbox.id), eq(quoteRequests.id, q.id)));
    await expect(createShipment(db, sandbox.id, { ...input, mode: "air", originId: "air-waw", destinationId: "air-pvg", agentId: "ag-skyline" }, simNow)).rejects.toThrow(/Rodzaj transportu/);
    const id = await createShipment(db, sandbox.id, input, simNow);
    await expect(createShipment(db, sandbox.id, input, simNow)).rejects.toThrow(/już istnieje/);
    expect((await quoteDetail(db, sandbox.id, q.id)).shipment).toEqual({ id, number: "MOR-2004" });
    expect((await shipmentDetail(db, sandbox.id, id, simNow)).quote?.id).toBe(q.id);
  });

  it("applies an AI reading only when it is sure; an unsure one waits for a person", async () => {
    const simNow = await advance(8 * H + 50);
    const crossed = new Date(simNow.getTime() - 3_600_000).toISOString();
    const reply = async (body: string) =>
      storeAgentMessage(db, sandbox.id, {
        agentId: "ag-eurasia",
        threadKey: "shp:shp-demo-kol1:agent",
        direction: "in",
        subject: "RE: Status request KOL-2001",
        body,
        atSim: simNow,
        state: "received",
        sentBy: "agent",
        kind: "shipment_status_reply",
      });
    const border = async () => (await shipmentDetail(db, sandbox.id, "shp-demo-kol1", simNow)).milestones.find((m) => m.kind === "border")!;
    const before = await border();
    expect(before.actual).toBeNull();
    try {
      setAiClientForTests(fakeAiClient([ok({ events: [{ kind: "border", date: crossed }], eta: null, delay_reason: null, confidence: 0.3 })]));
      const unsure = await reply("train passed the border probably yesterday, will check");
      await processAgentStatusReply(db, sandbox.id, unsure, { simNow });
      expect((await border()).actual).toBeNull();
      expect(await openAlerts(`shipment:shp-demo-kol1:unread:${unsure}`)).toHaveLength(1);

      setAiClientForTests(fakeAiClient([ok({ events: [{ kind: "border", date: crossed }], eta: null, delay_reason: null, confidence: 0.9 })]));
      const sure = await reply(`border crossing (Małaszewicze): ${formatShipmentDate(Date.parse(crossed))}`);
      await processAgentStatusReply(db, sandbox.id, sure, { simNow });
      expect(await border()).toMatchObject({ actual: crossed, source: "agent_ai" });

      // The forwarder's confirmation wins over any later reading.
      const confirmedAt = new Date(simNow.getTime() - 2 * 3_600_000).toISOString();
      await confirmMilestone(db, sandbox.id, "shp-demo-kol1", before.id, confirmedAt, simNow);
      setAiClientForTests(fakeAiClient([ok({ events: [{ kind: "border", date: crossed }], eta: null, delay_reason: null, confidence: 0.9 })]));
      await processAgentStatusReply(db, sandbox.id, await reply("border crossing again"), { simNow });
      expect(await border()).toMatchObject({ actual: confirmedAt, source: "dispatcher" });
    } finally {
      setAiClientForTests(null);
    }
  });

  it("guards every way out: agent words in the delay reason, the inbox send button, client data in agent numbers", async () => {
    const simNow = await advance(8 * H + 55);
    const [kol] = await db.select().from(shipments).where(and(eq(shipments.sandboxId, sandbox.id), eq(shipments.id, "shp-demo-kol1")));
    await db
      .update(shipments)
      .set({ statusNote: "kolejka, info od Eurasia Rail Bridge, postój 300 EUR", etaCurrent: new Date(kol.etaPlanned.getTime() + 30 * 3_600_000) })
      .where(and(eq(shipments.sandboxId, sandbox.id), eq(shipments.id, kol.id)));
    const draftId = await draftClientUpdate(db, sandbox.id, kol.id, simNow);
    const [draft] = await db.select().from(messages).where(and(eq(messages.sandboxId, sandbox.id), eq(messages.id, draftId)));
    expect(draft.body).toMatch(/opóźnienie ok\. 30 h\)/);
    expect(draft.body).not.toMatch(/Eurasia|300 EUR/);
    // The inbox "Wyślij" goes through the same guard as the shipment page.
    await expect(sendDraft(db, sandbox.id, draftId, { subject: draft.subject ?? "", body: `${draft.body}\nPozdrowienia od pani Petrenko.` }, simNow)).rejects.toThrow(/dane agenta/);
    await expect(sendDraft(db, sandbox.id, draftId, { subject: draft.subject ?? "", body: `${draft.body}\nDopłata 450 zł.` }, simNow)).rejects.toThrow(/kwotę/);
    // Numbers typed for the agent must not carry the client's data.
    await expect(
      createShipment(
        db,
        sandbox.id,
        {
          mode: "rail",
          clientId: "cl-meble",
          contactId: "ct-meble-1",
          agentId: "ag-polrail",
          originId: "rail-xian",
          destinationId: "rail-lodz",
          etd: new Date(simNow.getTime() + 5 * 86_400_000).toISOString(),
          eta: new Date(simNow.getTime() + 23 * 86_400_000).toISOString(),
          refs: { booking: "Meble Wielkopolska PO 77" },
        },
        simNow,
      ),
    ).rejects.toThrow(/dane klienta/);
  });

  it("gives older worlds the demo shipments on the first visit", async () => {
    const old = await createSandbox(db, {
      ipHash: "old-world",
      realNow: realStart,
    });
    // A world from before the module: no shipments and none of the agents added with it.
    await db.delete(agents).where(and(eq(agents.sandboxId, old.id), inArray(agents.id, ["ag-waw-cargo", "ag-hanseatic"])));
    await db.delete(shipments).where(eq(shipments.sandboxId, old.id));
    await db.delete(shipmentMilestones).where(eq(shipmentMilestones.sandboxId, old.id));
    await db.delete(messages).where(and(eq(messages.sandboxId, old.id), like(messages.threadKey, "shp:%")));
    const now = atMin(old.simOrigin, 600);
    await ensureShipmentsSeeded(db, old.id, now);
    await ensureShipmentsSeeded(db, old.id, now);
    const list = await shipmentsOverview(db, old.id, now);
    expect(list).toHaveLength(4);
    expect(list.find((s) => s.number === "LOT-2001")?.etaPlanned).toBe(new Date(now.getTime() + 15 * 3_600_000).toISOString());
  });
});
