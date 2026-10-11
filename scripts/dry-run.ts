/**
 * Plays the demo scenario in memory and prints the fleet every N simulated
 * minutes. Used to tune the scenario so the scripted story happens on time.
 *
 * Usage: npx tsx scripts/dry-run.ts [untilMin=360] [everyMin=20]
 */
import { and, eq } from "drizzle-orm";
import { alerts, documents, messages, orders, vehicles, vehicleStates } from "../src/db/schema";
import "../src/server/bootstrap";
import { createSandbox } from "../src/server/sandbox/repository";
import { runTick } from "../src/server/tick/engine";
import { createTestDb } from "../src/test/db";
import { formatHm, formatTime } from "../src/lib/format";

async function main() {
  const untilMin = Number(process.argv[2] ?? 360);
  const everyMin = Number(process.argv[3] ?? 20);
  const db = await createTestDb();
  const realStart = new Date("2026-10-14T06:00:00Z");
  const sandbox = await createSandbox(db, { ipHash: "dry-run", realNow: realStart });
  const seenAlerts = new Set<string>();
  const seenDocs = new Set<string>();
  const seenSms = new Set<string>();
  for (let m = 0; m <= untilMin; m += everyMin) {
    const realNow = new Date(realStart.getTime() + (m * 60_000) / 10);
    const tick = await runTick(db, sandbox.id, realNow);
    console.log(`\n=== T+${m} min · ${formatTime(tick.simNow)} (processed ${tick.processed}) ===`);
    const rows = await db
      .select({ plates: vehicles.plates, state: vehicleStates, kind: vehicles.kind })
      .from(vehicleStates)
      .innerJoin(vehicles, and(eq(vehicles.sandboxId, vehicleStates.sandboxId), eq(vehicles.id, vehicleStates.vehicleId)))
      .where(eq(vehicleStates.sandboxId, sandbox.id));
    const orderRows = await db.select().from(orders).where(eq(orders.sandboxId, sandbox.id));
    for (const r of rows.sort((a, b) => a.plates.localeCompare(b.plates))) {
      const o = orderRows.find((x) => x.vehicleId === r.state.vehicleId && !["ZAMKNIETE", "ANULOWANE"].includes(x.status));
      console.log(
        `${r.plates.padEnd(8)} ${r.state.mode.padEnd(10)} cont ${formatHm(r.state.continuousMin).padStart(5)} day ${formatHm(r.state.dailyMin).padStart(5)} | ` +
          (o
            ? `${o.number} ${o.status.padEnd(12)} risk ${String(o.risk).padEnd(6)} eta ${o.etaPredicted ? formatTime(o.etaPredicted) : "--:--"} okno ${formatTime(o.deliveryFrom)}–${formatTime(o.deliveryTo)}`
            : "—"),
      );
    }
    const alertRows = await db.select().from(alerts).where(eq(alerts.sandboxId, sandbox.id));
    for (const a of alertRows) {
      if (seenAlerts.has(a.id)) continue;
      seenAlerts.add(a.id);
      console.log(`  ALERT [${a.severity}] ${a.title} — ${a.body}`);
    }
    for (const d of await db.select().from(documents).where(eq(documents.sandboxId, sandbox.id))) {
      if (seenDocs.has(d.id)) continue;
      seenDocs.add(d.id);
      console.log(`  DOKUMENT ${d.imageRef ?? "upload"} od ${d.driverId} → ${d.status} ${formatTime(d.createdSim)}`);
    }
    for (const msg of await db.select().from(messages).where(eq(messages.sandboxId, sandbox.id))) {
      if (seenSms.has(msg.id) || !msg.kind?.startsWith("cmr")) continue;
      seenSms.add(msg.id);
      console.log(`  SMS ${msg.kind} → ${msg.driverId} ${formatTime(msg.atSim)}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
