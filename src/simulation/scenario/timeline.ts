/**
 * Scripted events of the demo (spec §10.2), in minutes after the 08:30 start.
 * Stages register their own entries; the world seeding schedules them all.
 */
export type TimelineEntry = { atMin: number; type: string; payload: Record<string, unknown> };

const entries: TimelineEntry[] = [];

export function addTimelineEntries(list: TimelineEntry[]) {
  for (const entry of list) {
    if (!entries.some((e) => e.type === entry.type && e.atMin === entry.atMin && JSON.stringify(e.payload) === JSON.stringify(entry.payload))) {
      entries.push(entry);
    }
  }
}

export function timeline(): readonly TimelineEntry[] {
  return [...entries].sort((a, b) => a.atMin - b.atMin);
}
