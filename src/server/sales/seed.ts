import { registerSeedExtension } from "../sandbox/repository";
import { seedSales } from "./quotes";

/** Every world gets the demo agents and default road rates. */
registerSeedExtension(async (db, sandbox) => {
  await seedSales(db, sandbox.id);
});
