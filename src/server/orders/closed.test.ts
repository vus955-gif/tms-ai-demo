import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { orders } from "@/db/schema";
import type { Db } from "@/db/types";
import "@/server/bootstrap";
import { createTestDb } from "@/test/db";
import { HttpError } from "../http";
import { createSandbox, type SandboxRow } from "../sandbox/repository";
import { exportClosedOrders, listClosedOrders } from "./closed";

const realStart = new Date("2026-10-14T06:00:00Z");

describe("A5: closed orders and the invoicing export", () => {
  let db: Db;
  let sandbox: SandboxRow;

  beforeAll(async () => {
    db = await createTestDb();
    sandbox = await createSandbox(db, { ipHash: "test", realNow: realStart });
  });

  it("lists the runs closed before the demo starts, newest first, none exported yet", async () => {
    const { orders: list } = await listClosedOrders(db, sandbox.id);
    expect(list.map((o) => o.number)).toEqual(["ZL-1029", "ZL-1028", "ZL-1027", "ZL-1026", "ZL-1024", "ZL-1022"]);
    expect(list.every((o) => o.exportedAt === null)).toBe(true);
    const berlin = list.find((o) => o.number === "ZL-1022")!;
    expect(berlin).toMatchObject({
      clientName: "Meble Wielkopolska Sp. z o.o.",
      pickupCity: "Swarzędz",
      deliveryCity: "Berlin",
      deliveryCountry: "Niemcy",
      vehiclePlates: "PO 4K21",
      trailerPlates: "PO 77N3",
      driverName: "Jan Nowak",
      distanceApprox: false,
      cmrOnFile: false,
    });
    // The NIP goes out as stored (with dashes): a spreadsheet keeps it as text instead of turning it into a number.
    expect(berlin.clientTaxId).toMatch(/^\d{3}-\d{3}-\d{2}-\d{2}$/);
    // A real road distance from the precomputed route, not a straight line (about 240 km as the crow flies).
    expect(berlin.distanceKm).toBeGreaterThan(250);
    expect(berlin.distanceKm).toBeLessThan(330);
  });

  it("exports the chosen orders oldest first and stamps only them", async () => {
    const simNow = new Date("2026-10-14T09:00:00Z");
    const out = await exportClosedOrders(db, sandbox.id, ["zl-1029", "zl-1022", "zl-1022"], simNow);
    expect(out.count).toBe(2);
    expect(out.filename).toBe("zlecenia-do-faktur-2026-10-14.csv");
    const lines = out.csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith("ZL-1022;")).toBe(true);
    expect(lines[2].startsWith("ZL-1029;")).toBe(true);

    const { orders: list } = await listClosedOrders(db, sandbox.id);
    expect(list.filter((o) => o.exportedAt !== null).map((o) => o.number).sort()).toEqual(["ZL-1022", "ZL-1029"]);
    expect(list.find((o) => o.number === "ZL-1022")!.exportedAt).toBe(simNow.toISOString());
  });

  it("refuses orders that are not closed and an empty selection", async () => {
    // zl-1031 is on the road at the start of the demo.
    await expect(exportClosedOrders(db, sandbox.id, ["zl-1024", "zl-1031"], realStart)).rejects.toThrow(HttpError);
    await expect(exportClosedOrders(db, sandbox.id, [], realStart)).rejects.toThrow("Wybierz co najmniej jedno");
    const [untouched] = await db.select().from(orders).where(and(eq(orders.sandboxId, sandbox.id), eq(orders.id, "zl-1024")));
    expect(untouched.invoiceExportedAt).toBeNull();
  });

  it("never reaches into another world", async () => {
    const other = await createSandbox(db, { ipHash: "other", realNow: realStart });
    await exportClosedOrders(db, other.id, ["zl-1026"], realStart);
    const mine = (await listClosedOrders(db, sandbox.id)).orders.find((o) => o.number === "ZL-1026")!;
    expect(mine.exportedAt).toBeNull();
  });
});
