"use client";

import { Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AiStatus } from "@/ai/status";
import { cn } from "@/lib/utils";

export const FALLBACK_REASON_LABEL: Record<string, string> = {
  no_api_key: "Brak klucza API w tej instalacji — AI działa na prostych regułach.",
  sandbox_limit: "Wykorzystano godzinny limit wywołań AI dla tego świata demo.",
  daily_budget: "Wyczerpany dzienny budżet AI. AI wróci po północy UTC.",
  ai_error: "AI nie odpowiedziało poprawnie — użyto reguł awaryjnych.",
  refusal: "Model odmówił odpowiedzi — użyto reguł awaryjnych.",
};

export function AiBadge({ status }: { status: AiStatus | undefined }) {
  const live = status?.mode === "live";
  const text = !status ? "AI…" : live ? "AI aktywne" : "AI: tryb awaryjny";
  const hint = !status
    ? "Sprawdzanie stanu AI"
    : live
      ? "Claude Haiku 5.5 analizuje wiadomości, dokumenty i alerty."
      : (FALLBACK_REASON_LABEL[status.reason ?? ""] ?? "AI chwilowo niedostępne.");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="ai-badge"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            live ? "bg-ai-soft text-ai" : "bg-warn-soft text-warn",
          )}
        >
          <Sparkles className="size-3.5" aria-hidden />
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}
