import type { Rng } from "../random";

export type BotReplyKind = "confirm" | "condition" | "question" | "refusal" | "silent";

const TEXTS: Record<Exclude<BotReplyKind, "silent">, string[]> = {
  confirm: ["ok", "OK, jadę", "Przyjmuję", "Potwierdzam", "👍", "ok, będę na czas", "Jasne, biorę"],
  condition: [
    "Ok, ale będę ok. 2 h później, stoję jeszcze na rozładunku",
    "Ok, tylko muszę zatankować po drodze, będzie 30 min później",
    "Mogę, ale dopiero po 14, wcześniej nie zdążę",
  ],
  question: ["Jaki numer rampy?", "Czy jest awizacja, czy mam dzwonić sam?", "Palety wymienne czy nie?"],
  refusal: ["Nie dam rady, jutro mam wolne", "Nie pojadę, auto idzie do serwisu", "Nie zdążę, mam już inne plany na wieczór"],
};

/** Probabilities from spec §10.3. */
export const SILENT_P = 0.15;
const CONDITION_P = 0.12;
const QUESTION_P = 0.08;

/** Picks how a simulated driver answers an order SMS. */
export function chooseBotReply(rng: Rng, refusalPropensity: number, forced?: BotReplyKind): { kind: BotReplyKind; text: string | null } {
  const kind: BotReplyKind =
    forced ??
    (rng.chance(SILENT_P)
      ? "silent"
      : rng.chance(refusalPropensity)
        ? "refusal"
        : rng.chance(CONDITION_P)
          ? "condition"
          : rng.chance(QUESTION_P)
            ? "question"
            : "confirm");
  return { kind, text: kind === "silent" ? null : rng.pick(TEXTS[kind]) };
}

/** Reply delay in minutes (2–15). */
export function botReplyDelayMin(rng: Rng): number {
  return rng.int(2, 15);
}
