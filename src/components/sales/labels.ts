import type { AgentQuoteStatus, QuoteMode, QuoteStatus } from "@/db/schema";

export const MODE: Record<QuoteMode, { label: string; icon: string }> = {
  sea: { label: "morski", icon: "🚢" },
  air: { label: "lotniczy", icon: "✈️" },
  rail: { label: "kolejowy", icon: "🚆" },
  road: { label: "drogowy", icon: "🚚" },
};

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; className: string }> = {
  niekompletne: { label: "brak danych", className: "bg-warn-soft text-warn" },
  do_zatwierdzenia: { label: "do zatwierdzenia", className: "bg-ai-soft text-ai" },
  zbieranie: { label: "zbieranie stawek", className: "bg-brand/10 text-brand" },
  gotowe: { label: "gotowe do oferty", className: "bg-ok-soft text-ok" },
  oferta_wyslana: { label: "oferta wysłana", className: "bg-muted text-foreground" },
  wygrana: { label: "wygrana", className: "bg-ok text-white" },
  przegrana: { label: "przegrana", className: "bg-muted text-muted-foreground" },
  anulowana: { label: "anulowana", className: "bg-muted text-muted-foreground line-through" },
};

export const AGENT_STATUS: Record<AgentQuoteStatus, { label: string; className: string }> = {
  wyslane: { label: "czeka", className: "text-muted-foreground" },
  przypomniane: { label: "przypomniano", className: "text-warn" },
  odpowiedz: { label: "stawka", className: "text-ok" },
  brak_miejsca: { label: "brak miejsca", className: "text-muted-foreground" },
  brak_odpowiedzi: { label: "bez odpowiedzi", className: "text-bad" },
};

export const VEHICLE: Record<"bus" | "solo" | "tractor", string> = { bus: "bus", solo: "solówka", tractor: "ciągnik z naczepą" };
