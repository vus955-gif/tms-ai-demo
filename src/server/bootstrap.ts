/**
 * Side-effect imports that register event handlers, tick phases, seed
 * extensions and timeline entries. Every API route imports this module first.
 * Order matters for tick phases: movement before risk.
 */
import "./monitoring/seed";
import "./monitoring/timeline";
import "./monitoring/movement";
import "./monitoring/risk-phase";
import "./monitoring/incidents";
import "./messages/handlers";
import "./orders/scenario";

export const BOOTSTRAPPED = true;
