"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Check, MapPin, Navigation, Phone, Truck } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, getJson, postJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DriverLinkState, DriverOrderView } from "@/server/driver-link/links";

const REASONS = ["Auto niesprawne", "Brak czasu pracy", "Choroba lub sprawa osobista", "Inny powód"] as const;

const STATE: Record<DriverLinkState, { text: string; tone: "wait" | "ok" | "off" }> = {
  do_potwierdzenia: { text: "Czeka na Twoje potwierdzenie", tone: "wait" },
  potwierdzone: { text: "Potwierdzone. Jedź na załadunek.", tone: "ok" },
  zaladunek: { text: "Załadunek", tone: "ok" },
  w_drodze: { text: "W drodze na rozładunek", tone: "ok" },
  rozladunek: { text: "Rozładunek", tone: "ok" },
  zakonczone: { text: "Zlecenie zakończone. Dziękujemy.", tone: "ok" },
  odwolane: { text: "Zlecenie odwołane. Nie jedź na załadunek.", tone: "off" },
};

async function sendPhoto(token: string, file: File): Promise<DriverOrderView> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`/api/driver-link/${encodeURIComponent(token)}/cmr`, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as DriverOrderView & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Błąd serwera (${res.status})`);
  return body;
}

/**
 * The driver's page for one order, opened from the SMS link. Built for a phone held in one hand:
 * large text, one main action at a time, plain words, no login and no app to install.
 */
export function DriverOrderPage({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const key = ["driver-link", token];
  const url = `/api/driver-link/${encodeURIComponent(token)}`;
  const q = useQuery({
    queryKey: key,
    queryFn: () => getJson<DriverOrderView>(url),
    refetchInterval: 20_000,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const done = (view: DriverOrderView) => {
    queryClient.setQueryData(key, view);
    setRefusing(false);
    setReason(null);
  };
  const act = useMutation({ mutationFn: (body: { action: "confirm" } | { action: "refuse"; reason: string }) => postJson<DriverOrderView>(url, body), onSuccess: done });
  const photo = useMutation({ mutationFn: (file: File) => sendPhoto(token, file), onSuccess: done });
  const sample = useMutation({ mutationFn: (sampleId: string) => postJson<DriverOrderView>(`${url}/cmr`, { sampleId }), onSuccess: done });
  const busy = act.isPending || photo.isPending || sample.isPending;
  const failure = act.error ?? photo.error ?? sample.error;

  const o = q.data;
  const state = o ? STATE[o.state] : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-3 bg-background p-4 text-base">
      <header className="flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-md bg-brand text-brand-foreground">
          <Truck className="size-5" aria-hidden />
        </span>
        <div>
          <div className="font-semibold leading-tight">{o?.carrier ?? "Zlecenie dla kierowcy"}</div>
          <div className="text-sm text-muted-foreground">Zlecenie dla kierowcy</div>
        </div>
      </header>

      {q.isError && (
        <p className="rounded-xl border p-4" role="alert">
          {q.error.message}
        </p>
      )}
      {!o && !q.isError && <p className="text-muted-foreground">Wczytywanie zlecenia…</p>}

      {o && state && (
        <>
          <section className="rounded-xl border p-4" data-testid="driver-order">
            <h1 className="text-2xl font-bold tabular-nums">{o.number}</h1>
            {o.clientName && <p className="text-muted-foreground">{o.clientName}</p>}
            <p
              data-testid="driver-state"
              className={cn(
                "mt-3 rounded-lg px-3 py-2 font-semibold",
                state.tone === "wait" && "bg-warn-soft text-warn",
                state.tone === "ok" && "bg-ok-soft text-ok",
                state.tone === "off" && "bg-bad-soft text-bad",
              )}
            >
              {state.text}
            </p>
          </section>

          {o.state !== "odwolane" && (
            <>
              <StopCard title="Załadunek" stop={o.pickup} />
              <StopCard title="Rozładunek" stop={o.delivery} />
              <section className="rounded-xl border p-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ładunek</h2>
                <p className="mt-1 font-medium">{o.cargo}</p>
                {o.references.length > 0 && <p className="text-sm text-muted-foreground">Ref: {o.references.join(", ")}</p>}
                {o.notes && <p className="mt-2 rounded-md bg-muted p-2 text-sm">{o.notes}</p>}
              </section>
            </>
          )}

          {failure && (
            <p role="alert" className="rounded-xl border border-bad/40 bg-bad-soft p-3 text-bad">
              {failure.message}
            </p>
          )}

          {o.state === "do_potwierdzenia" && !refusing && (
            <div className="grid gap-2">
              <Button className="h-14 text-lg" onClick={() => act.mutate({ action: "confirm" })} disabled={busy} data-testid="driver-confirm">
                <Check /> {act.isPending ? "Potwierdzam…" : "Potwierdzam zlecenie"}
              </Button>
              <Button variant="outline" className="h-12" onClick={() => setRefusing(true)} disabled={busy} data-testid="driver-refuse-open">
                Nie mogę jechać
              </Button>
            </div>
          )}

          {o.state === "do_potwierdzenia" && refusing && (
            <section className="grid gap-2 rounded-xl border p-4" data-testid="driver-refuse">
              <h2 className="font-semibold">Dlaczego nie możesz jechać?</h2>
              <div className="grid gap-2" role="radiogroup" aria-label="Powód odmowy">
                {REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={reason === r}
                    onClick={() => setReason(r)}
                    className={cn("h-12 rounded-lg border px-3 text-left", reason === r ? "border-brand bg-accent font-semibold" : "hover:bg-accent/50")}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Button variant="destructive" className="h-12" onClick={() => reason && act.mutate({ action: "refuse", reason })} disabled={!reason || busy} data-testid="driver-refuse-send">
                {act.isPending ? "Wysyłam…" : "Wyślij odmowę do spedycji"}
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setRefusing(false)} disabled={busy}>
                Wróć
              </Button>
            </section>
          )}

          {(o.state === "rozladunek" || (o.state === "zakonczone" && o.cmr === "przyjete")) && (
            <section className="grid gap-2 rounded-xl border p-4" data-testid="driver-cmr">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Zdjęcie CMR</h2>
              {o.cmr === "przyjete" ? (
                <p className="flex items-center gap-2 font-semibold text-ok">
                  <Check className="size-5" aria-hidden /> Zdjęcie CMR dotarło. Dziękujemy.
                </p>
              ) : (
                <>
                  {o.cmr === "do_poprawy" ? (
                    <p className="rounded-lg bg-warn-soft p-2 font-medium text-warn">Zdjęcie jest nieczytelne. Zrób jeszcze raz: cały dokument, ostro, bez cienia, z pieczątką odbiorcy.</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Po rozładunku zrób zdjęcie podpisanego CMR: cały dokument, ostro, z pieczątką odbiorcy.</p>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    aria-label="Zdjęcie CMR"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) photo.mutate(file);
                    }}
                  />
                  <Button className="h-14 text-lg" onClick={() => fileInput.current?.click()} disabled={busy}>
                    <Camera /> {photo.isPending ? "Wysyłam zdjęcie…" : "Zrób zdjęcie CMR"}
                  </Button>
                  {o.samples.length > 0 && (
                    <div className="grid gap-1.5 rounded-lg bg-muted p-2">
                      <p className="text-xs text-muted-foreground">Demo: nie masz dokumentu pod ręką? Wyślij przykładowe zdjęcie.</p>
                      {o.samples.map((s) => (
                        <Button key={s.id} variant="outline" className="h-11 justify-start" onClick={() => sample.mutate(s.id)} disabled={busy} data-testid={`driver-sample-${s.id}`}>
                          {s.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          <footer className="mt-auto grid gap-1 pt-2">
            <Button asChild variant="outline" className="h-12">
              <a href={`tel:${o.dispatchPhone.replace(/\s/g, "")}`}>
                <Phone /> Zadzwoń do spedycji: {o.dispatchPhone}
              </a>
            </Button>
            <p className="text-center text-xs text-muted-foreground">Demo: firma i numer są fikcyjne.</p>
          </footer>
        </>
      )}
    </div>
  );
}

function StopCard({ title, stop }: { title: string; stop: DriverOrderView["pickup"] }) {
  return (
    <section className="rounded-xl border p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <p className="mt-1 text-lg font-bold">{stop.window}</p>
      <p className="mt-1 flex items-start gap-1.5">
        <MapPin className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          <span className="font-medium">{stop.name}</span>
          <br />
          {stop.address}, {stop.city} ({stop.country})
        </span>
      </p>
      {stop.remarks && <p className="mt-2 rounded-md bg-muted p-2 text-sm">{stop.remarks}</p>}
      <Button asChild variant="outline" className="mt-3 h-11 w-full">
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`} target="_blank" rel="noreferrer">
          <Navigation /> Nawiguj
        </a>
      </Button>
    </section>
  );
}
