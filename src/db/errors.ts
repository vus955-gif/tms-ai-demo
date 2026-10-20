/** Postgres unique violation (23505) → the violated constraint's name, looking through driver wrappers. */
export function uniqueViolation(error: unknown): string | null {
  for (let e = error as { code?: string; constraint?: string; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (e.code === "23505") return e.constraint ?? "";
  }
  return null;
}
