import type { ShipmentStatus } from "@/db/schema";
import type { ClientUpdateState, ShipmentMode } from "@/domain/shipments";
import { TZDate } from "@date-fns/tz";
import { formatSimClock, formatWarsaw, WARSAW } from "@/lib/format";

export const MODE: Record<ShipmentMode, { label: string; icon: string }> = {
  sea: { label: "morska", icon: "🚢" },
  air: { label: "lotnicza", icon: "✈️" },
  rail: { label: "kolejowa", icon: "🚆" },
};

export const STATUS: Record<ShipmentStatus, { label: string; className: string }> = {
  planowana: { label: "planowana", className: "bg-muted text-foreground" },
  w_drodze: { label: "w drodze", className: "bg-brand/10 text-brand" },
  dostarczona: { label: "dostarczona", className: "bg-ok-soft text-ok" },
  anulowana: { label: "anulowana", className: "bg-muted text-muted-foreground line-through" },
};

export const CLIENT_STATE: Record<ClientUpdateState, { label: string; className: string }> = {
  ok: { label: "", className: "" },
  wkrotce: { label: "status dla klienta wkrótce", className: "bg-ai-soft text-ai" },
  po_terminie: { label: "status dla klienta po terminie", className: "bg-bad-soft text-bad" },
};

export const SOURCE: Record<string, { label: string; className: string; title: string }> = {
  plan: { label: "plan", className: "text-muted-foreground", title: "Termin z planu — nikt go jeszcze nie potwierdził" },
  agent_ai: { label: "agent · AI", className: "text-ai", title: "Odczytane przez AI z maila agenta" },
  agent_rules: { label: "agent · reguły", className: "text-foreground", title: "Odczytane regułami z maila agenta (AI niedostępne)" },
  dispatcher: { label: "spedytor", className: "text-ok", title: "Potwierdzone ręcznie przez spedytora" },
};

export const RHYTHMS = [4, 6, 8, 12, 24, 48, 72];

/** "+2 dni" / "+9 h" / "−1 dzień"; empty when on time (under an hour off). */
export function delayText(hours: number): string {
  if (Math.abs(hours) < 1) return "";
  const sign = hours > 0 ? "+" : "−";
  const h = Math.abs(hours);
  if (h < 36) return `${sign}${h} h`;
  const days = Math.round(h / 24);
  return `${sign}${days} ${days === 1 ? "dzień" : "dni"}`;
}

/** "za 1:30" / "1:30 temu" relative to simulated now, for schedules. */
export function relative(iso: string, simNow: string | undefined): string {
  if (!simNow) return "";
  const minutes = Math.round((new Date(iso).getTime() - new Date(simNow).getTime()) / 60_000);
  const abs = Math.abs(minutes);
  const text = abs >= 48 * 60 ? `${Math.round(abs / 1440)} dni` : `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")} h`;
  return minutes >= 0 ? `za ${text}` : `${text} temu`;
}

export const when = (iso: string | null) => (iso ? formatSimClock(iso) : "—");

/** Value for <input type="datetime-local">, in Warsaw time (the simulation's zone, whatever the browser's). */
export const toWarsawInput = (iso: string) => formatWarsaw(iso, "yyyy-MM-dd'T'HH:mm");

export function fromWarsawInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), WARSAW).toISOString();
}
