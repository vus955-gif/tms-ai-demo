/** Raw `db.execute` results differ per driver; both PGlite and Neon expose `rows`. */
export function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
