import { beforeAll, describe, expect, it } from "vitest";
import { setAiClientForTests } from "@/ai/client";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { matchOrder } from "../orders/board";
import { approveDraftOrder } from "../orders/drafts";
import { atMin } from "../sandbox/seed";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { runTick } from "../tick/engine";
import { addAbsence, driverCalendar, fleetFile, removeAbsence, renewFleetTerm } from "./views";

const realStart = new Date("2026-10-14T06:00:00Z");
const realAt = (simMinutes: number) => new Date(realStart.getTime() + (simMinutes * 60_000) / 10);

describe("stage 6: fleet file and driver calendar", () => {
  let db: Db;
  let sandbox: SandboxRow;
  const at = (m: number) => atMin(sandbox.simOrigin, m);
  const exclusionFor = async (plates: string) => (await matchOrder(db, sandbox.id, "zl-1043", at(50))).find((r) => r.plates === plates)!;

  beforeAll(async () => {
    setAiClientForTests(null);
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "fleet", realNow: realStart });
    await runTick(db, sandbox.id, realAt(45));
    await approveDraftOrder(db, sandbox.id, "zl-1043", null, at(46));
  });

  it("shows deadline states: overdue, soon, by date and by odometer", async () => {
    const f = await fleetFile(db, sandbox, at(46));
    const term = (title: string, kind: string) => [...f.vehicles, ...f.trailers, ...f.drivers].find((s) => s.title === title)!.terms.find((t) => t.kind === kind)!;
    expect(term("EL 9K41", "tachograf")).toMatchObject({ status: "po_terminie", blocking: true });
    expect(term("PO 2C19", "oc").status).toBe("wkrotce");
    expect(term("WB 6P77", "serwis")).toMatchObject({ status: "wkrotce", kmLeft: 1800 });
    expect(term("EL 5R30", "serwis")).toMatchObject({ status: "po_terminie", kmLeft: -1200, blocking: false });
    expect(term("GD 15PL", "atp").status).toBe("wkrotce");
    expect(term("Łukasz Krawczyk", "karta_kierowcy").status).toBe("wkrotce");
    expect(f.overdue).toBe(2);
    expect(f.soon).toBeGreaterThanOrEqual(5);
    expect(f.vehicles[0].worst).toBe("po_terminie");
  });

  it("excludes a vehicle with a lapsed blocking deadline and a driver on leave from the order", async () => {
    expect((await exclusionFor("EL 9K41")).reasons[0]).toMatch(/^legalizacja tachografu ważne tylko do/);
    expect((await exclusionFor("PO 2C19")).reasons[0]).toMatch(/^urlop/);
  });

  it("renewing the deadline brings the vehicle back", async () => {
    await renewFleetTerm(db, sandbox.id, "v-el9k41:tachograf", at(47));
    const f = await fleetFile(db, sandbox, at(47));
    expect(f.vehicles.find((v) => v.title === "EL 9K41")!.terms.find((t) => t.kind === "tachograf")!.status).toBe("ok");
    expect((await exclusionFor("EL 9K41")).tier).not.toBe("excluded");
  });

  it("adds and removes an absence that the matching respects", async () => {
    const cal = await driverCalendar(db, sandbox, at(48));
    expect(cal.days).toHaveLength(7);
    expect(cal.drivers.find((d) => d.id === "d-kaminska")!.absences[0]).toMatchObject({ kind: "urlop" });
    expect(cal.drivers.find((d) => d.id === "d-szymanski")!.orders.map((o) => o.number)).toContain("ZL-1037");

    const tomorrow = new Date(at(48).getTime() + 86_400_000).toISOString().slice(0, 10);
    const id = await addAbsence(db, sandbox.id, { driverId: "d-dabrowski", kind: "l4", from: tomorrow, to: tomorrow, note: "" });
    expect((await exclusionFor("EL 9K41")).reasons[0]).toMatch(/^zwolnienie lekarskie/);
    await removeAbsence(db, sandbox.id, id);
    expect((await exclusionFor("EL 9K41")).tier).not.toBe("excluded");
    await expect(addAbsence(db, sandbox.id, { driverId: "d-dabrowski", kind: "urlop", from: "2026-10-20", to: "2026-10-18", note: "" })).rejects.toThrow(/przed początkiem/);
    await expect(addAbsence(db, sandbox.id, { driverId: "d-nikt", kind: "urlop", from: "2026-10-20", to: "2026-10-21", note: "" })).rejects.toThrow(/kierowcy/);
  });
});
