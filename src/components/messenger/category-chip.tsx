import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const CATEGORY_LABEL: Record<string, string> = {
  potwierdzenie: "potwierdzenie",
  odmowa: "odmowa",
  warunek_pytanie: "warunek / pytanie",
  operacyjne: "problem w trasie",
  dokument: "dokument",
  luzne: "luźna wiadomość",
  niejasne: "niejasne",
};

const CATEGORY_STYLE: Record<string, string> = {
  potwierdzenie: "bg-ok-soft text-ok",
  odmowa: "bg-bad-soft text-bad",
  warunek_pytanie: "bg-warn-soft text-warn",
  operacyjne: "bg-bad-soft text-bad",
  dokument: "bg-ai-soft text-ai",
  luzne: "bg-muted text-muted-foreground",
  niejasne: "bg-muted text-muted-foreground",
};

export function CategoryChip({ category, source, summary }: { category: string; source?: "ai" | "rules" | null; summary?: string | null }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", CATEGORY_STYLE[category] ?? "bg-muted")}
      title={[summary, source === "rules" ? "klasyfikacja regułami awaryjnymi" : source === "ai" ? "klasyfikacja AI" : null].filter(Boolean).join(" · ")}
    >
      {source === "ai" && <Sparkles className="size-3" aria-hidden />}
      {CATEGORY_LABEL[category] ?? category}
    </span>
  );
}
