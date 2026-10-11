import { randomUUID } from "node:crypto";
import { messages } from "@/db/schema";
import type { Executor } from "@/db/types";

/** One thread per quote and agent: `rfq:<quoteId>:<agentId>`. Demo: nothing is ever sent. */
export const rfqThread = (quoteId: string, agentId: string) => `rfq:${quoteId}:${agentId}`;

export async function storeAgentMessage(
  db: Executor,
  sandboxId: string,
  m: {
    agentId: string;
    threadKey: string;
    direction: "in" | "out";
    subject: string;
    body: string;
    atSim: Date;
    state: "draft" | "sent" | "received";
    sentBy: "system" | "dispatcher" | "agent";
    kind: string;
    classifiedBy?: "ai" | "rules" | null;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(messages).values({
    sandboxId,
    id,
    channel: "email",
    direction: m.direction,
    party: "agent",
    agentId: m.agentId,
    threadKey: m.threadKey,
    subject: m.subject.slice(0, 200),
    body: m.body.slice(0, 4000),
    state: m.state,
    sentBy: m.sentBy,
    atSim: m.atSim,
    readAtSim: m.direction === "out" ? m.atSim : null,
    kind: m.kind,
    classifiedBy: m.classifiedBy ?? null,
  });
  return id;
}
