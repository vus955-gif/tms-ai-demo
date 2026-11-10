"use client";

import { Check, Compass, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GUIDE_STEPS, markGuideStep, openGuideTool, restartGuide, setGuideOpen, useGuide, type GuideStep, type GuideTool } from "./guide-store";

type StepInfo = { title: string; text: string; action: string } & ({ href: string } | { tool: GuideTool });

const STEPS: Record<GuideStep, StepInfo> = {
  pojazd: {
    title: "Flota w ruchu",
    text: "Kliknij dowolny pojazd na mapie albo na liście. Zobaczysz jego trasę, prognozę przyjazdu i czas pracy kierowcy.",
    action: "Otwórz monitoring",
    href: "/monitoring",
  },
  sms: {
    title: "Kierowca pisze SMS",
    text: "W telefonie kierowcy wybierz kierowcę i napisz jako on, np. „Stoję w korku, będę godzinę później”. AI rozpozna, o co chodzi, a wiadomość trafi do Komunikatora.",
    action: "Pokaż telefon kierowcy",
    tool: "phone",
  },
  cmr: {
    title: "Zdjęcie CMR",
    text: "W tym samym telefonie wyślij zdjęcie CMR, przykładowe albo własne. AI odczyta dokument i dopasuje go do zlecenia; wynik czeka w Dokumentach.",
    action: "Pokaż telefon kierowcy",
    tool: "phone",
  },
  mail: {
    title: "Mail od klienta",
    text: "W poczcie klienta wybierz firmę i przykład „Zamówienie”, potem wyślij. W Skrzynce pojawi się szkic zlecenia przygotowany z treści maila.",
    action: "Pokaż pocztę klienta",
    tool: "client-mail",
  },
  dziennik: {
    title: "Co zrobiło AI",
    text: "Dziennik AI pokazuje każde wywołanie modelu: co dostał, co odpowiedział i ile to kosztowało. Zmiany statusu wykonane przez AI można cofnąć.",
    action: "Otwórz dziennik AI",
    href: "/dziennik-ai",
  },
};

/** Header button: opens the guide and shows how far the visitor got. */
export function GuideButton() {
  const guide = useGuide();
  const left = GUIDE_STEPS.length - guide.done.length;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setGuideOpen(!guide.open)}
      aria-expanded={guide.open}
      title="Przewodnik po demo"
      data-testid="guide-toggle"
      className={cn("relative", !guide.open && left === GUIDE_STEPS.length && "border-ai text-ai")}
    >
      <Compass /> <span className="sr-only xl:not-sr-only">Przewodnik</span>
      {!guide.open && left > 0 && left < GUIDE_STEPS.length && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-ai px-1 text-[10px] font-semibold leading-4 text-white" aria-label={`zostało kroków: ${left}`}>
          {left}
        </span>
      )}
    </Button>
  );
}

/** The guide itself: a card in the bottom-left corner of the work area (a bottom sheet on a phone). */
export function DemoGuide() {
  const guide = useGuide();
  const router = useRouter();
  const pathname = usePathname();

  // Opening the AI log is a step in itself; the other steps are reported by the screens where they happen.
  useEffect(() => {
    if (pathname === "/dziennik-ai") markGuideStep("dziennik");
  }, [pathname]);

  if (!guide.open) return null;
  const current = GUIDE_STEPS.find((s) => !guide.done.includes(s)) ?? null;

  const run = (step: StepInfo) => {
    if ("href" in step) router.push(step.href);
    else openGuideTool(step.tool);
  };

  return (
    <section
      aria-label="Przewodnik po demo"
      data-testid="guide"
      className="absolute inset-x-2 bottom-2 z-20 flex max-h-[60%] flex-col rounded-xl border bg-background shadow-2xl lg:inset-x-auto lg:bottom-3 lg:left-[11.75rem] lg:max-h-[calc(100%-1.5rem)] lg:w-[340px]"
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Zobacz demo w kilka minut</h2>
          <p className="text-xs text-muted-foreground">
            {current ? `Krok ${guide.done.length + 1} z ${GUIDE_STEPS.length}. Świat jest fikcyjny: klikaj śmiało.` : "To był skrót. Pozostałe moduły znajdziesz w menu."}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setGuideOpen(false)} aria-label="Zamknij przewodnik" data-testid="guide-close">
          <X />
        </Button>
      </div>
      <ol className="min-h-0 space-y-1 overflow-y-auto p-2">
        {GUIDE_STEPS.map((id, index) => {
          const step = STEPS[id];
          const done = guide.done.includes(id);
          const active = id === current;
          return (
            <li key={id} data-testid={`guide-step-${id}`} data-done={done} className={cn("rounded-lg px-2 py-1.5", active && "bg-ai-soft/60")}>
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    done ? "bg-ok text-white" : active ? "bg-ai text-white" : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                <span className={cn("font-medium", done && "text-muted-foreground line-through")}>{step.title}</span>
                {done && <span className="sr-only">(zrobione)</span>}
              </div>
              {active && (
                <div className="mt-1.5 space-y-2 pl-7">
                  <p className="text-xs leading-relaxed text-muted-foreground">{step.text}</p>
                  <Button size="xs" onClick={() => run(step)} data-testid="guide-action">
                    {step.action}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>Czas przyspieszysz przyciskami 1× / 10× / 60×.</span>
        {guide.done.length > 0 && (
          <button type="button" onClick={restartGuide} className="shrink-0 underline underline-offset-2 hover:text-foreground" data-testid="guide-restart">
            Od początku
          </button>
        )}
      </div>
    </section>
  );
}
