import { and, eq, isNotNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import { orders } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { createOrder } from "../orders/create";
import { createPlanned, deleteTemplate, listTemplates, MAX_TEMPLATES, saveTemplate, weekPlan } from "./templates";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("stage 4: templates and recurring orders", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "templates", realNow: realStart });
    await runTick(db, sandbox.id, realAt(10));
  });

  it("plans next week's runs of every active template", async () => {
    const plan = await weekPlan(db, sandbox, at(10));
    const byTemplate = (id: string) => plan.filter((p) => p.templateId === id).map((p) => p.date);
    // The demo day is Wednesday 14.10: the week runs Thursday 15 → Wednesday 21.
    expect(byTemplate("tpl-agropol-pasza")).toEqual(["2026-10-16", "2026-10-19", "2026-10-21"]);
    expect(byTemplate("tpl-baltic-chlodnia")).toEqual(["2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(byTemplate("tpl-hanza-dostawy")).toEqual(["2026-10-15", "2026-10-20"]);
  });

  it("forecasts from the same matching as klocki: the only reefer driver is on training on Friday", async () => {
    const plan = await weekPlan(db, sandbox, at(10));
    const baltic = (date: string) => plan.find((p) => p.key === `tpl-baltic-chlodnia:${date}`)!;
    // Thursday: the reefer is ~400 km away with today's order — cannot reach Pruszcz by 06:30.
    expect(baltic("2026-10-15")).toMatchObject({ forecast: "brak_kierowcy" });
    expect(baltic("2026-10-15").reason).toMatch(/nie zdąży na załadunek/);
    // Friday: its driver is on training. Monday: fine.
    expect(baltic("2026-10-16").forecast).toBe("brak_kierowcy");
    expect(baltic("2026-10-16").reason).toMatch(/szkolenie/);
    expect(baltic("2026-10-19")).toMatchObject({ forecast: "zdazy", bestDriver: "Anna Wiśniewska", bestPlates: "GD 2M88" });
    // Wednesday 21: the reefer trailer's ATP lapses on the 20th (fleet file, stage 6).
    expect(baltic("2026-10-21")).toMatchObject({ forecast: "brak_kierowcy" });
    expect(baltic("2026-10-21").reason).toMatch(/^GD 2M88: świadectwo ATP .*ważne tylko do 20\.10/);
    const agro = plan.find((p) => p.key === "tpl-agropol-pasza:2026-10-16")!;
    expect(agro.forecast).toBe("zdazy");
  });

  it("creates the selected orders in one click, once", async () => {
    const keys = ["tpl-agropol-pasza:2026-10-16", "tpl-baltic-chlodnia:2026-10-15"];
    const { created } = await createPlanned(db, sandbox, keys, at(11));
    expect(created).toHaveLength(2);
    const rows = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.source, "template")));
    expect(rows.map((o) => o.status)).toEqual(["NOWE", "NOWE"]);
    expect(rows.find((o) => o.templateKey === "tpl-baltic-chlodnia:2026-10-15")).toMatchObject({ bodyRequired: "chlodnia", cargoPallets: 18 });
    const again = await createPlanned(db, sandbox, keys, at(12));
    expect(again.created).toEqual([]);
    expect(again.skipped.map((x) => x.reason)).toEqual([`już utworzone (${created[0]})`, `już utworzone (${created[1]})`]);
    const plan = await weekPlan(db, sandbox, at(12));
    expect(plan.find((p) => p.key === keys[0])!.orderNumber).toMatch(/^ZL-\d+/);
  });

  it("forecasts a template that starts where another one ends (Gdynia → Łódź after Kutno → Gdynia)", async () => {
    const id = await saveTemplate(
      db,
      sandbox.id,
      {
        name: "Agro-Pol: powrót Gdynia → Łódź",
        clientId: "cl-agropol",
        pickupPointId: "pt-agropol-gdynia",
        deliveryPointId: "pt-agropol-lodz",
        pickupFromMin: 960,
        pickupToMin: 1080,
        deliveryDayOffset: 1,
        deliveryFromMin: 480,
        deliveryToMin: 720,
        cargoPallets: 10,
        cargoKg: 4000,
        bodyRequired: null,
        adrRequired: false,
        references: [],
        notes: "",
        weekdays: [5],
      },
      at(13),
    );
    const plan = await weekPlan(db, sandbox, at(13));
    expect(plan.filter((p) => p.templateId === id).map((p) => p.date)).toEqual(["2026-10-16"]);
  });

  it("rejects a template with a point of another client", async () => {
    await expect(
      saveTemplate(
        db,
        sandbox.id,
        {
          name: "Test",
          clientId: "cl-agropol",
          pickupPointId: "pt-agropol-kutno",
          deliveryPointId: "pt-baltic-janki",
          pickupFromMin: 360,
          pickupToMin: 480,
          deliveryDayOffset: 0,
          deliveryFromMin: 780,
          deliveryToMin: 960,
          cargoPallets: 10,
          cargoKg: 4000,
          bodyRequired: null,
          adrRequired: false,
          references: [],
          notes: "",
          weekdays: [1],
        },
        at(13),
      ),
    ).rejects.toThrow(/nie należy/);
  });
});

const input = (name: string) => ({
  name,
  clientId: "cl-hanza",
  pickupPointId: "pt-hanza-szczecin",
  deliveryPointId: "pt-hanza-poznan",
  pickupFromMin: 480,
  pickupToMin: 600,
  deliveryDayOffset: 0,
  deliveryFromMin: 900,
  deliveryToMin: 1080,
  cargoPallets: 10,
  cargoKg: 4000,
  bodyRequired: null,
  adrRequired: false,
  references: [],
  notes: "",
  weekdays: [2],
});

describe("stage 4: guards (code review)", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  const templateOrders = () => db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), isNotNull(orders.templateKey)));

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "templates-guards", realNow: realStart });
    await runTick(db, sandbox.id, realAt(10));
  });

  it("two clicks at the same time make one order per day", async () => {
    const keys = ["tpl-hanza-dostawy:2026-10-15", "tpl-hanza-dostawy:2026-10-20"];
    const [a, b] = await Promise.all([createPlanned(db, sandbox, keys, at(11)), createPlanned(db, sandbox, keys, at(11))]);
    expect([...a.created, ...b.created]).toHaveLength(2);
    expect((await templateOrders()).map((o) => o.templateKey).sort()).toEqual(keys);
  });

  it("the database refuses a second live order for the same template and day", async () => {
    const [o] = (await templateOrders()).filter((x) => x.templateKey === "tpl-hanza-dostawy:2026-10-15");
    const values = {
      clientId: o.clientId,
      pickupPointId: o.pickupPointId,
      deliveryPointId: o.deliveryPointId,
      pickupFrom: o.pickupFrom.toISOString(),
      pickupTo: o.pickupTo.toISOString(),
      deliveryFrom: o.deliveryFrom.toISOString(),
      deliveryTo: o.deliveryTo.toISOString(),
      cargoPallets: o.cargoPallets,
      cargoKg: o.cargoKg,
      bodyRequired: null,
      adrRequired: false,
      references: [],
      notes: "",
    };
    await expect(createOrder(db, sandbox.id, values, { simNow: at(12), source: "template", templateKey: o.templateKey! })).rejects.toThrow();
  });

  it("a cancelled order frees its day", async () => {
    await db.update(orders).set({ status: "ANULOWANE" }).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.templateKey, "tpl-hanza-dostawy:2026-10-15")));
    const plan = await weekPlan(db, sandbox, at(13));
    expect(plan.find((p) => p.key === "tpl-hanza-dostawy:2026-10-15")!.orderNumber).toBeNull();
    expect((await createPlanned(db, sandbox, ["tpl-hanza-dostawy:2026-10-15"], at(13))).created).toHaveLength(1);
  });

  it("takes keys from their own date: today still works after midnight, a missed window or a wrong day is explained", async () => {
    const friday0700 = new Date("2026-10-16T05:00:00Z");
    const keys = ["tpl-agropol-pasza:2026-10-16", "tpl-baltic-chlodnia:2026-10-16", "tpl-agropol-pasza:2026-10-15", "tpl-nope:2026-10-16"];
    const r = await createPlanned(db, sandbox, keys, friday0700);
    expect(r.created).toHaveLength(1);
    expect(r.skipped).toEqual([
      { key: "tpl-baltic-chlodnia:2026-10-16", reason: "okno załadunku już minęło" },
      { key: "tpl-agropol-pasza:2026-10-15", reason: "dzień poza paczką" },
      { key: "tpl-nope:2026-10-16", reason: "szablon usunięty albo wstrzymany" },
    ]);
  });

  it("deleting every template leaves the list empty (the examples do not come back); orders stay", async () => {
    const before = (await templateOrders()).length;
    for (const t of await listTemplates(db, sandbox)) await deleteTemplate(db, sandbox.id, t.id);
    expect(await listTemplates(db, sandbox)).toEqual([]);
    expect(await weekPlan(db, sandbox, at(14))).toEqual([]);
    expect(await templateOrders()).toHaveLength(before);
  });

  it(`caps a world at ${MAX_TEMPLATES} templates`, async () => {
    for (let i = 0; i < MAX_TEMPLATES; i++) await saveTemplate(db, sandbox.id, input(`Szablon ${i + 1}`), at(15));
    await expect(saveTemplate(db, sandbox.id, input("Jeden za dużo"), at(15))).rejects.toThrow(/najwyżej 20 szablonów/);
  });
});
