"use client";

import { useMutation } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COUNTRY_CODES, COUNTRY_NAMES, type Country } from "@/domain/countries";
import { getJson, postJson } from "@/lib/api";
import type { ClientOverview } from "@/server/clients/clients";
import type { GeoHit } from "@/server/clients/geocode";

const PointMap = dynamic(() => import("./point-map").then((m) => m.PointMap), { ssr: false, loading: () => <div className="h-56 w-full rounded-lg border bg-muted/40" /> });

type ExistingPoint = ClientOverview["points"][number];
const select = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/**
 * New point: address, then location from "Znajdź na mapie" or a click on the map.
 * Existing point: text fields only — its location is fixed (routes and orders use it).
 */
export function PointDialog({ client, point, geocoder, onClose, onSaved }: { client: ClientOverview; point: ExistingPoint | null; geocoder: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(point?.name ?? "");
  const [address, setAddress] = useState(point?.address ?? "");
  const [city, setCity] = useState(point?.city ?? "");
  const [country, setCountry] = useState<Country>((point?.country as Country) ?? "PL");
  const [hours, setHours] = useState(point?.openingHours ?? "pn–pt 7:00–15:00");
  const [requirements, setRequirements] = useState(point?.requirements ?? "");
  const [notes, setNotes] = useState(point?.notes ?? "");
  const [handling, setHandling] = useState(String(point?.handlingMinutes ?? 45));
  const [location, setLocation] = useState<{ lng: number; lat: number } | null>(point ? { lng: point.lng, lat: point.lat } : null);
  const [hits, setHits] = useState<GeoHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: () => getJson<{ hits: GeoHit[] }>(`/api/geocode?q=${encodeURIComponent([address, city].filter(Boolean).join(", "))}&country=${country}`),
    onSuccess: (r) => {
      setHits(r.hits);
      if (r.hits.length === 1) setLocation({ lng: r.hits[0].lng, lat: r.hits[0].lat });
      if (r.hits.length === 0) setError("Nie znaleziono adresu — wskaż punkt, klikając w mapę.");
    },
    onError: (e) => setError(e.message),
  });

  const save = useMutation({
    mutationFn: () => {
      const values = { name, address, city, openingHours: hours, requirements, notes, handlingMinutes: /^\d+$/.test(handling.trim()) ? Number(handling) : NaN };
      if (point) return postJson(`/api/points/${point.id}`, { action: "update", values });
      return postJson(`/api/clients/${client.id}`, { action: "addPoint", point: { ...values, country, lat: location?.lat, lng: location?.lng } });
    },
    onSuccess: () => {
      toast.success(point ? "Punkt zapisany." : "Punkt dodany — można go wybierać w zleceniach i szablonach.");
      onSaved();
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!point && !location) return setError("Wskaż punkt na mapie: „Znajdź na mapie” albo kliknij w mapę.");
    save.mutate();
  };

  const pins = [
    ...client.points.filter((p) => p.id !== point?.id).map((p) => ({ id: p.id, lng: p.lng, lat: p.lat, label: p.name, muted: true })),
    ...(location ? [{ id: "edited", lng: location.lng, lat: location.lat, label: name || "Nowy punkt" }] : []),
  ];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{point ? `Punkt: ${point.name}` : `Nowy punkt — ${client.name}`}</DialogTitle>
          <DialogDescription>Godziny, wymagania i notatki trafiają do SMS-a dla kierowcy. Dane w demo są fikcyjne — nie wpisuj prawdziwych danych osobowych.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 text-sm" data-testid="point-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              Nazwa punktu
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Magazyn centralny" aria-label="Nazwa punktu" />
            </label>
            <label className="grid gap-1">
              Kraj
              <select className={select} value={country} onChange={(e) => setCountry(e.target.value as Country)} disabled={Boolean(point)} aria-label="Kraj">
                {COUNTRY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_NAMES[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Adres
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ul. Przemysłowa 12" aria-label="Adres" />
            </label>
            <label className="grid gap-1">
              Miejscowość
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Oleśnica" aria-label="Miejscowość" />
            </label>
          </div>

          {point ? (
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">Lokalizacja (stała — używają jej trasy i zlecenia)</span>
              <PointMap pins={pins} />
            </div>
          ) : (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs">
                  <MapPin className="size-3.5" />
                  {location ? `Lokalizacja: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : "Lokalizacja: nie wskazano"}
                </span>
                {geocoder && (
                  <Button type="button" size="sm" variant="outline" onClick={() => (setError(null), search.mutate())} disabled={search.isPending || (address + city).trim().length < 3} data-testid="geocode">
                    <Search /> Znajdź na mapie
                  </Button>
                )}
              </div>
              {hits && hits.length > 1 && (
                <ul className="grid gap-1" aria-label="Znalezione miejsca">
                  {hits.map((h) => (
                    <li key={`${h.lat},${h.lng}`}>
                      <button type="button" className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => setLocation({ lng: h.lng, lat: h.lat })}>
                        {h.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <PointMap pins={pins} onPick={(lng, lat) => setLocation({ lng, lat })} focus={location} />
              <p className="text-[11px] text-muted-foreground">
                Kliknij w mapę, żeby ustawić lub poprawić punkt. Lokalizacji nie zmienisz po zapisaniu. Trasy do nowego punktu system szacuje (linia prosta × 1,26, ok. 94 km/h) i oznacza jako przybliżone.
                {geocoder && " Wyszukiwanie: Nominatim, © OpenStreetMap contributors."}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
            <label className="grid gap-1">
              Godziny pracy
              <Input value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Godziny pracy" />
            </label>
            <label className="grid gap-1">
              Wymagania
              <Input value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="awizacja 24 h, rampa" aria-label="Wymagania" />
            </label>
            <label className="grid gap-1">
              Obsługa (min)
              <Input value={handling} onChange={(e) => setHandling(e.target.value)} inputMode="numeric" aria-label="Czas obsługi w minutach" />
            </label>
          </div>
          <label className="grid gap-1">
            Notatki dla kierowcy
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. wjazd od ul. Polnej, ochrona prosi o dowód" aria-label="Notatki dla kierowcy" />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={save.isPending} data-testid="save-point">
              Zapisz punkt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
