import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import { couplings, orders, trailers } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { loadFleet } from "../monitoring/fleet-data";
import { matchOrder } from "../orders/board";
import { createOrder } from "../orders/create";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { swapTrailer, swapTrailerSafely, trailerSituation } from "./trailers";
import { fleetFile } from "./views";

const realStart = new Date("2026-10-21T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("A2: swapping trailers in the yard, with history", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  const trailerOf = async (vehicleId: string) => (await loadFleet(db, sandbox.id)).trailerByVehicle.get(vehicleId)?.plates ?? null;

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "trailers", realNow: realStart });
    await runTick(db, sandbox.id, realAt(5));
  });

  it("shows an empty tractor at the Łódź base the spare reefer standing next to it", async () => {
    const s = await trailerSituation(db, sandbox, "v-el9k41", at(5));
    expect(s).toMatchObject({ current: { plates: "EL 66SS" }, standsAt: "Baza Łódź", inProgressOrder: null });
    const reefer = s.options.find((o) => o.plates === "EL 40CZ")!;
    expect(reefer).toMatchObject({ where: "Baza Łódź", sameYard: true, check: { blockers: [], warnings: [] } });
    expect(s.options.find((o) => o.plates === "PO 11RS")!.check.blockers[0]).toMatch(/stoi w: Baza Poznań, a ciągnik w: Baza Łódź/);
  });

  it("refuses a swap on the road or with cargo on board", async () => {
    await expect(swapTrailer(db, sandbox, "v-gd2m88", "tr-el40cz", { confirm: true }, at(5))).rejects.toThrow(/w trasie|wiezie ładunek/);
    await expect(swapTrailer(db, sandbox, "v-wx9t04", "tr-el40cz", { confirm: true }, at(5))).rejects.toThrow(/to nie ciągnik/);
  });

  it("swaps: the old trailer stays in the yard, history keeps both, matching sees the reefer", async () => {
    const { id: reeferOrder } = await createOrder(
      db,
      sandbox.id,
      {
        clientId: "cl-baltic",
        pickupPointId: "pt-baltic-pruszcz",
        deliveryPointId: "pt-baltic-janki",
        pickupFrom: at(600).toISOString(),
        pickupTo: at(720).toISOString(),
        deliveryFrom: at(1200).toISOString(),
        deliveryTo: at(1400).toISOString(),
        cargoPallets: 20,
        cargoKg: 9000,
        bodyRequired: "chlodnia",
        adrRequired: false,
        references: [],
        notes: "",
      },
      { simNow: at(6), source: "manual" },
    );
    const before = (await matchOrder(db, sandbox.id, reeferOrder, at(6))).find((r) => r.plates === "EL 9K41")!;
    expect(before.reasons).toContain("wymagana chłodnia");

    await swapTrailer(db, sandbox, "v-el9k41", "tr-el40cz", { confirm: false }, at(7));
    expect(await trailerOf("v-el9k41")).toBe("EL 40CZ");
    const [old] = await db.select().from(trailers).where(and(eq(trailers.sandboxId, sandbox.id), eq(trailers.id, "tr-el66ss")));
    expect(old.parkedAtPointId).toBe("pt-baza-lodz");
    const after = (await matchOrder(db, sandbox.id, reeferOrder, at(7))).find((r) => r.plates === "EL 9K41")!;
    expect(after.reasons).not.toContain("wymagana chłodnia");

    const file = await fleetFile(db, sandbox, at(7));
    const tractor = file.vehicles.find((v) => v.title === "EL 9K41")!;
    expect(tractor.coupling).toMatchObject({ now: "naczepa EL 40CZ", since: at(7).toISOString() });
    expect(tractor.coupling!.history.map((h) => [h.trailerPlates, h.to === null])).toEqual([
      ["EL 40CZ", true],
      ["EL 66SS", false],
    ]);
    expect(file.trailers.find((t) => t.title === "EL 66SS")!.coupling).toMatchObject({ now: "stoi: Baza Łódź" });
    expect(file.trailers.find((t) => t.title === "EL 40CZ")!.coupling).toMatchObject({ now: "pod EL 9K41" });
  });

  it("asks to confirm when an assigned order needs what the new trailer lacks, then the order follows the trailer", async () => {
    // A chilled order is assigned to EL 9K41; going back to the curtain trailer would leave it without a reefer.
    const { id } = await createOrder(
      db,
      sandbox.id,
      {
        clientId: "cl-baltic",
        pickupPointId: "pt-baltic-pruszcz",
        deliveryPointId: "pt-baltic-janki",
        pickupFrom: at(900).toISOString(),
        pickupTo: at(960).toISOString(),
        deliveryFrom: at(1300).toISOString(),
        deliveryTo: at(1500).toISOString(),
        cargoPallets: 10,
        cargoKg: 5000,
        bodyRequired: "chlodnia",
        adrRequired: false,
        references: [],
        notes: "",
      },
      { simNow: at(8), source: "manual" },
    );
    await db.update(orders).set({ status: "PRZYPISANE", vehicleId: "v-el9k41", trailerId: "tr-el40cz" }).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id)));
    const s = await trailerSituation(db, sandbox, "v-el9k41", at(9));
    expect(s.options.find((o) => o.plates === "EL 66SS")!.check.warnings[0]).toMatch(/wymaga chłodni — EL 66SS to plandeka/);
    await expect(swapTrailer(db, sandbox, "v-el9k41", "tr-el66ss", { confirm: false }, at(9))).rejects.toThrow(/Potwierdź przepięcie/);
    await swapTrailer(db, sandbox, "v-el9k41", "tr-el66ss", { confirm: true }, at(9));
    const [order] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, id)));
    expect(order.trailerId).toBe("tr-el66ss");
    const open = await db.select().from(couplings).where(and(eq(couplings.sandboxId, sandbox.id), eq(couplings.vehicleId, "v-el9k41")));
    expect(open.filter((c) => c.toSim === null)).toHaveLength(1);
    expect(open).toHaveLength(3);
  });

  it("swaps back and forth at one sim instant (paused clock) and the database refuses a second open coupling", async () => {
    const t = at(9);
    await swapTrailerSafely(db, sandbox, "v-el9k41", "tr-el40cz", { confirm: true }, t);
    await swapTrailerSafely(db, sandbox, "v-el9k41", "tr-el66ss", { confirm: true }, t);
    await swapTrailerSafely(db, sandbox, "v-el9k41", "tr-el40cz", { confirm: true }, t);
    expect(await trailerOf("v-el9k41")).toBe("EL 40CZ");
    // Two clicks at once could pass the checks together: the second open coupling is refused by the database.
    await expect(db.insert(couplings).values({ sandboxId: sandbox.id, id: "cp-dup", vehicleId: "v-el9k41", trailerId: "tr-po11rs", fromSim: t, toSim: null })).rejects.toThrow();
    await expect(db.insert(couplings).values({ sandboxId: sandbox.id, id: "cp-dup2", vehicleId: "v-po2c19", trailerId: "tr-el40cz", fromSim: t, toSim: null })).rejects.toThrow();
    await swapTrailerSafely(db, sandbox, "v-el9k41", "tr-el66ss", { confirm: true }, t);
  });

  it("drops the trailer in the yard; the tractor then has none", async () => {
    await expect(swapTrailer(db, sandbox, "v-el9k41", null, { confirm: false }, at(10))).rejects.toThrow(/Potwierdź/);
    await swapTrailer(db, sandbox, "v-el9k41", null, { confirm: true }, at(10));
    expect(await trailerOf("v-el9k41")).toBeNull();
    const s = await trailerSituation(db, sandbox, "v-el9k41", at(11));
    expect(s.current).toBeNull();
    expect(s.drop.blockers).toEqual(["Ciągnik nie ma naczepy."]);
  });
});
