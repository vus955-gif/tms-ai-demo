import { agents, salesSettings } from "@/db/schema";
import { agentsSeed, roadRatesSeed } from "@/simulation/scenario/agents";
import { registerSeedExtension } from "../sandbox/repository";

/** Every world gets the demo agents and default road rates. */
registerSeedExtension(async (db, sandbox) => {
  await db.insert(agents).values(
    agentsSeed.map((a) => ({
      sandboxId: sandbox.id,
      id: a.id,
      company: a.company,
      contactName: a.contactName,
      email: a.email,
      modes: a.modes,
      regions: a.regions,
      replyRate: a.replyRate,
      priceFactor: a.priceFactor,
    })),
  );
  await db.insert(salesSettings).values({ sandboxId: sandbox.id, roadRates: roadRatesSeed });
});
