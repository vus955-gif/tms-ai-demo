import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { canRouteKey, getRouteByKey, hasRouteKey } from "@/adapters/routing/static-routes";
import { setAiClientForTests } from "@/ai/client";
import { orders, vehicleStates } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { isApproxRoute } from "@/simulation/approx-route";
import { createTestDb } from "@/test/db";
import { vehicleDetail } from "../monitoring/vehicle-detail";
import { assignOrder, confirmOrder } from "../orders/assign";
import { matchOrder } from "../orders/board";
import { createOrder } from "../orders/create";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { atMin } from "../sandbox/seed";
import { runTick } from "../tick/engine";
import { addContact, clientsOverview, createClient, createPoint, deletePoint, updatePoint } from "./clients";
import { geocode } from "./geocode";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

const point = (name: string, city: string, country: "PL" | "FR", lat: number, lng: number) => ({
  name,
  address: "ul. Testowa 1",
  city,
  country,
  lat,
  lng,
  openingHours: "pn–pt 6:00–18:00",
  requirements: "",
  notes: "",
  handlingMinutes: 45,
});

describe("stage 4b: new clients and points", () => {
  let db: Db;
  let sandbox: SandboxRow;
  let clientId: string;
  let pickupId: string;
  let deliveryId: string;
  const at = (m: number) => atMin(sandbox.simOrigin, m);

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "clients", realNow: realStart });
    await runTick(db, sandbox.id, realAt(5));
  });

  it("adds a client with its first contact and checks the tax number", async () => {
    await expect(createClient(db, sandbox.id, { name: "Brioche Test", taxId: "123-456-78-82", isKey: false, contact: { name: "Anne Martin", email: "anne@brioche-test.example", phone: "" } })).rejects.toThrow(/NIP/);
    clientId = await createClient(db, sandbox.id, { name: "Brioche Test", taxId: "PL 123 456 78 83", isKey: true, contact: { name: "Anne Martin", email: "anne@brioche-test.example", phone: "+33 1 00 00 00 00" } });
    await expect(createClient(db, sandbox.id, { name: "brioche test", taxId: "", isKey: false, contact: { name: "X Y", email: "x@y.example", phone: "" } })).rejects.toThrow(/już jest/);
    await addContact(db, sandbox.id, clientId, { name: "Paul Durand", email: "paul@gmail.com", phone: "" });
    const c = (await clientsOverview(db, sandbox.id)).find((x) => x.id === clientId)!;
    expect(c).toMatchObject({ name: "Brioche Test", taxId: "1234567883", isKey: true, manual: true });
    expect(c.contacts.map((k) => k.name)).toEqual(["Anne Martin", "Paul Durand"]);
  });

  it("adds points by map location; routes to them are approximate, never missing", async () => {
    await expect(createPoint(db, sandbox.id, clientId, point("Poza Europą", "Nowy Jork", "PL", 40.7, -74))).rejects.toThrow(/poza krajem Polska/);
    // Berlin with the country left at "Polska": the check catches it (the domestic-van rule depends on it).
    await expect(createPoint(db, sandbox.id, clientId, point("Berlin", "Berlin", "PL", 52.52, 13.4))).rejects.toThrow(/poza krajem Polska/);
    pickupId = await createPoint(db, sandbox.id, clientId, point("Magazyn Oleśnica", "Oleśnica", "PL", 51.21, 17.38));
    deliveryId = await createPoint(db, sandbox.id, clientId, point("Piekarnia Lyon", "Lyon", "FR", 45.76, 4.84));
    expect(pickupId).toMatch(/^pt-x-[0-9a-f]{10}$/);
    const key = `${pickupId}__${deliveryId}`;
    expect(hasRouteKey(key)).toBe(false);
    expect(canRouteKey(key)).toBe(true);
    const route = getRouteByKey(key);
    expect(isApproxRoute(route)).toBe(true);
    expect(route.distanceM / 1000).toBeGreaterThan(1000);
    // Scenario route keys still come from the precomputed OSRM routes.
    expect(hasRouteKey("pt-baza-poznan__pt-baza-lodz")).toBe(true);
    expect(isApproxRoute(getRouteByKey("pt-baza-poznan__pt-baza-lodz"))).toBe(false);
  });

  it("an order to the new points is matched, assigned and driven on the approximate route", async () => {
    const order = await createOrder(
      db,
      sandbox.id,
      {
        clientId,
        pickupPointId: pickupId,
        deliveryPointId: deliveryId,
        pickupFrom: at(120).toISOString(),
        pickupTo: at(300).toISOString(),
        deliveryFrom: at(1500).toISOString(),
        deliveryTo: at(2400).toISOString(),
        cargoPallets: 5,
        cargoKg: 800,
        bodyRequired: null,
        adrRequired: false,
        references: ["BT-1"],
        notes: "",
      },
      { simNow: at(10), source: "manual" },
    );
    const matches = await matchOrder(db, sandbox.id, order.id, at(10));
    const best = matches.find((m) => m.tier !== "excluded");
    // Every tractor is busy, on leave or blocked at this hour; the free international van from Wrocław takes the light load.
    expect(best?.plates).toBe("DW 1T07");
    expect(matches.find((m) => m.plates === "DW 3H56")!.reasons[0]).toMatch(/nie zdąży na załadunek \(ETA/);
    // The van stands in Wrocław, a scenario point; the pickup was added in the app — the km are an estimate.
    expect(best!.reasons.join(" ")).toMatch(/km od załadunku \(szacunek\)/);

    await db.transaction((tx) => assignOrder(tx, sandbox.id, order.id, best!.driverId, { actor: "dispatcher", simNow: at(10) }));
    await confirmOrder(db, sandbox.id, order.id, at(10));
    await runTick(db, sandbox.id, realAt(600));
    // Created before the scripted ZL-1042 (09:05): it must not take that order's id, and the script still runs.
    expect(order.id).not.toBe("zl-1042");
    const [scripted] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, "zl-1042")));
    expect(scripted?.clientId).toBe("cl-hanza");
    const [row] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, order.id)));
    expect(["POTWIERDZONE", "ZALADUNEK", "W_DRODZE"]).toContain(row.status);
    const [state] = await db.select().from(vehicleStates).where(and(eq(vehicleStates.sandboxId, sandbox.id), eq(vehicleStates.vehicleId, best!.vehicleId)));
    expect(state.routeKey).toMatch(/pt-x-/);
    const detail = await vehicleDetail(db, sandbox.id, best!.vehicleId, at(600));
    expect(detail.route?.approximate).toBe(true);
    expect(detail.breakdown?.eta).toBeTruthy();
  });

  it("edits point texts, refuses to delete a point in use and deletes an unused one", async () => {
    await updatePoint(db, sandbox.id, deliveryId, { notes: "Wjazd od tyłu, rampa 3", openingHours: "pn–sb 5:00–14:00" });
    const c = (await clientsOverview(db, sandbox.id)).find((x) => x.id === clientId)!;
    expect(c.points.find((p) => p.id === deliveryId)).toMatchObject({ notes: "Wjazd od tyłu, rampa 3", manual: true, lat: 45.76 });
    await expect(deletePoint(db, sandbox.id, deliveryId)).rejects.toThrow(/używany/);
    await expect(deletePoint(db, sandbox.id, "pt-baza-poznan")).rejects.toThrow();
    const spare = await createPoint(db, sandbox.id, clientId, point("Zapas", "Lille", "FR", 50.63, 3.06));
    await deletePoint(db, sandbox.id, spare);
    expect((await clientsOverview(db, sandbox.id)).find((x) => x.id === clientId)!.points.map((p) => p.id)).not.toContain(spare);
  });
});

describe("address search (Nominatim)", () => {
  const reply = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as typeof fetch;

  it("returns candidate places, identifies the app and caches the answer", async () => {
    let calls = 0;
    let userAgent = "";
    const fake = (async (_url: URL, init: RequestInit) => {
      calls++;
      userAgent = new Headers(init.headers).get("User-Agent") ?? "";
      return { ok: true, status: 200, json: async () => [{ display_name: "Oleśnica, powiat oleśnicki", lat: "51.21", lon: "17.38" }] };
    }) as unknown as typeof fetch;
    const hits = await geocode("w1", "Oleśnica, Wrocławska 1", "PL", { fetch: fake, gapMs: 0 });
    expect(hits).toEqual([{ label: "Oleśnica, powiat oleśnicki", lat: 51.21, lng: 17.38 }]);
    expect(userAgent).toMatch(/^tms-ai-demo/);
    await geocode("w1", "  oleśnica,   wrocławska 1 ", "PL", { fetch: fake, gapMs: 0 });
    expect(calls).toBe(1);
  });

  it("explains failures and limits the number of searches per world", async () => {
    const deps = (body: unknown, ok = true) => ({ fetch: reply(body, ok), gapMs: 0 });
    await expect(geocode("w2", "xy", "PL", deps([]))).rejects.toThrow(/co najmniej 3/);
    await expect(geocode("w2", "Nieistniejąca 1", "PL", deps(null, false))).rejects.toThrow(/nie odpowiada/);
    // 20 searches per world in 10 minutes; the 21st is refused (a cached repeat would not count).
    for (let i = 0; i < 20; i++) await geocode("w3", `Adres ${i}`, "PL", deps([]));
    await expect(geocode("w3", "Adres 20", "PL", deps([]))).rejects.toThrow(/Za dużo/);
  });
});
