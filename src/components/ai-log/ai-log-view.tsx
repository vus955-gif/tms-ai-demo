"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import type { Diagnostics } from "@/ai/status";
import type { AiLogEntry } from "@/app/api/ai/log/route";
import { FALLBACK_REASON_LABEL } from "@/components/shell/ai-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { POLL_MS } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatInt, formatSimClock, formatUsd } from "@/lib/format";

export const AI_FUNCTION_LABEL: Record<string, string> = {
  classifyDriverMessage: "Wiadomość kierowcy",
  readCmr: "Odczyt CMR",
  explainAlert: "Wyjaśnienie alertu",
  draftMessage: "Szkic wiadomości",
  triageClientEmail: "Mail klienta",
  diagnostics: "Diagnostyka",
};

const LOG_KEY = ["ai-log"] as const;

export function AiLogView() {
  const queryClient = useQueryClient();
  const log = useQuery({
    queryKey: LOG_KEY,
    queryFn: () => getJson<{ entries: AiLogEntry[] }>("/api/ai/log?limit=100"),
    refetchInterval: POLL_MS,
  });
  const diagnostics = useMutation({
    mutationFn: () => postJson<Diagnostics>("/api/ai/diagnostics"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LOG_KEY }),
    onError: (e) => toast.error(e.message),
  });
  const entries = log.data?.entries ?? [];
  const total = entries.reduce((sum, e) => sum + e.costUsd, 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dziennik AI</h1>
          <p className="text-sm text-muted-foreground">
            Każde wywołanie AI w tym świecie demo: co analizowało, co zwróciło i ile kosztowało.
          </p>
        </div>
        <Button variant="outline" onClick={() => diagnostics.mutate()} disabled={diagnostics.isPending} data-testid="ai-diagnostics">
          <Stethoscope />
          Sprawdź AI
        </Button>
      </div>

      {diagnostics.data && <DiagnosticsCard result={diagnostics.data} />}

      <div className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm">
          <span className="font-medium">{entries.length} wywołań</span>
          <span className="text-muted-foreground">Łączny koszt: {formatUsd(total)}</span>
        </div>
        {entries.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            AI jeszcze nic nie analizowało. Kliknij „Sprawdź AI”, żeby wykonać próbne wywołanie.
          </p>
        ) : (
          <Table data-testid="ai-log-table">
            <TableHeader>
              <TableRow>
                <TableHead>Czas symulacji</TableHead>
                <TableHead>Funkcja</TableHead>
                <TableHead>Wejście</TableHead>
                <TableHead>Wynik</TableHead>
                <TableHead className="text-right">Tokeny</TableHead>
                <TableHead className="text-right">Koszt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{formatSimClock(e.atSim)}</TableCell>
                  <TableCell>{AI_FUNCTION_LABEL[e.fn] ?? e.fn}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground" title={e.inputRef}>
                    {e.inputRef || "—"}
                  </TableCell>
                  <TableCell>
                    {e.fallbackUsed ? (
                      <Badge variant="outline" className="border-warn/40 text-warn" title={FALLBACK_REASON_LABEL[e.reason ?? ""] ?? e.error ?? ""}>
                        reguły awaryjne
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-ai/40 text-ai">
                        AI · {formatInt(e.latencyMs)} ms
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(e.inputTokens + e.outputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(e.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function DiagnosticsCard({ result }: { result: Diagnostics }) {
  const rows: [string, boolean, string][] = [
    ["Klucz API", result.hasKey, result.hasKey ? "jest" : "brak — dodaj ANTHROPIC_API_KEY do .env.local"],
    [
      "Obsługa obrazów (odczyt CMR)",
      Boolean(result.capabilities?.imageInput),
      result.capabilities ? (result.capabilities.imageInput ? "tak" : "nie — CMR przejdzie na Sonnet 5.5") : (result.capabilitiesError ?? "nie sprawdzono"),
    ],
    [
      "Odpowiedzi strukturalne",
      Boolean(result.capabilities?.structuredOutputs),
      result.capabilities ? (result.capabilities.structuredOutputs ? "tak" : "nie") : "nie sprawdzono",
    ],
    [
      "Próbne wywołanie („ok, jadę”)",
      result.sample.source === "ai",
      result.sample.source === "ai"
        ? `AI: ${result.sample.category}`
        : `reguły awaryjne: ${FALLBACK_REASON_LABEL[result.sample.reason ?? ""] ?? result.sample.reason}`,
    ],
  ];
  return (
    <div className="rounded-lg border bg-background p-4" data-testid="ai-diagnostics-result">
      <p className="mb-3 text-sm font-medium">Diagnostyka modelu {result.model}</p>
      <ul className="grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, good, detail]) => (
          <li key={label} className="flex items-start gap-2">
            {good ? <CheckCircle2 className="mt-0.5 size-4 text-ok" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 text-warn" aria-hidden />}
            <span>
              {label}: <span className="text-muted-foreground">{detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
