"use client";

import { useMutation } from "@tanstack/react-query";
import { MapPin, Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COUNTRY_CODES, COUNTRY_NAMES, countriesAt, inCountry, type Country } from "@/domain/countries";
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
  const [focus, setFocus] = useState<{ lng: number; lat: number } | null>(null);
  const [countryHint, setCountryHint] = useState<string | null>(null);

  // Text of the coordinate fields, kept apart from the numbers so "51." can be typed on the way to "51.21".
  const [coordText, setCoordText] = useState({ lat: point ? String(point.lat) : "", lng: point ? String(point.lng) : "" });

  /** A pin set by click, search or typing; the country follows the map when it clearly lies elsewhere. */
  const place = (lng: number, lat: number, opts: { fly?: boolean; typed?: boolean } = {}) => {
    setLocation({ lng, lat });
    if (opts.fly) setFocus({ lng, lat });
    if (!opts.typed) setCoordText({ lat: String(lat), lng: String(lng) });
    // Rough country boxes overlap near borders: switch only when the chosen country is clearly wrong, and always ask to check near a border.
    const found = countriesAt(lng, lat);
    if (point || found.length === 0) return setCountryHint(null);
    if (!inCountry(country, lng, lat)) {
      setCountry(found[0]);
      const others = found.slice(1).map((c) => COUNTRY_NAMES[c]);
      setCountryHint(`Kraj ustawiony według mapy: ${COUNTRY_NAMES[found[0]]}.${others.length ? ` Blisko granicy — sprawdź (może też: ${others.join(", ")}).` : ""}`);
    } else if (found.length > 1) {
      const others = found.filter((c) => c !== country).map((c) => COUNTRY_NAMES[c]);
      setCountryHint(`Punkt blisko granicy — sprawdź, czy kraj „${COUNTRY_NAMES[country]}” jest właściwy (może też: ${others.join(", ")}).`);
    } else setCountryHint(null);
  };
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: () => getJson<{ hits: GeoHit[] }>(`/api/geocode?q=${encodeURIComponent([address, city].filter(Boolean).join(", "))}&country=${country}`),
    onSuccess: (r) => {
      setHits(r.hits);
      if (r.hits.length === 1) place(r.hits[0].lng, r.hits[0].lat, { fly: true });
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

  const pins = useMemo(
    () => [
      ...client.points.filter((p) => p.id !== point?.id).map((p) => ({ id: p.id, lng: p.lng, lat: p.lat, label: p.name, muted: true })),
      ...(location ? [{ id: "edited", lng: location.lng, lat: location.lat, label: name || "Nowy punkt" }] : []),
    ],
    [client.points, point?.id, location, name],
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{point ? `Punkt: ${point.name}` : `Nowy punkt — ${client.name}`}</DialogTitle>
          <DialogDescription>Godziny, wymagania i notatki trafiają do SMS-a dla kierowcy. Dane w demo są fikcyjne — nie wpisuj prawdziwych danych osobowych.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 text-sm" data-testid="point-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              Nazwa punktu
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Magazyn centralny" />
            </label>
            <label className="grid gap-1">
              Kraj
              <select className={select} value={country} onChange={(e) => (setCountry(e.target.value as Country), setCountryHint(null))} disabled={Boolean(point)}>
                {COUNTRY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {COUNTRY_NAMES[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              Adres
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="ul. Przemysłowa 12" />
            </label>
            <label className="grid gap-1">
              Miejscowość
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Oleśnica" />
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
                      <button type="button" className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted" onClick={() => place(h.lng, h.lat, { fly: true })}>
                        {h.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <PointMap pins={pins} onPick={(lng, lat) => place(lng, lat)} focus={focus} />
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["lat", "Szerokość geograficzna", "np. 51.21"],
                    ["lng", "Długość geograficzna", "np. 17.38"],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label key={key} className="grid gap-1 text-xs">
                    {label}
                    <Input
                      inputMode="decimal"
                      value={coordText[key]}
                      placeholder={hint}
                      onChange={(e) => {
                        const next = { ...coordText, [key]: e.target.value };
                        setCoordText(next);
                        const [lat, lng] = [Number(next.lat.replace(",", ".")), Number(next.lng.replace(",", "."))];
                        if (next.lat.trim() && next.lng.trim() && Number.isFinite(lat) && Number.isFinite(lng)) place(lng, lat, { typed: true });
                      }}
                    />
                  </label>
                ))}
              </div>
              {countryHint && <p className="text-xs text-warn">{countryHint}</p>}
              <p className="text-[11px] text-muted-foreground">
                Kliknij w mapę albo wpisz współrzędne, żeby ustawić lub poprawić punkt. Lokalizacji nie zmienisz po zapisaniu. Trasy do nowego punktu system szacuje (linia prosta × 1,26, prędkość zależna od odległości — średnie z naszych tras OSRM) i oznacza jako przybliżone.
                {geocoder && " Wyszukiwanie: Nominatim, © OpenStreetMap contributors."}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px]">
            <label className="grid gap-1">
              Godziny pracy
              <Input value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
            <label className="grid gap-1">
              Wymagania
              <Input value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="awizacja 24 h, rampa" />
            </label>
            <label className="grid gap-1">
              Obsługa (min)
              <Input value={handling} onChange={(e) => setHandling(e.target.value)} inputMode="numeric" />
            </label>
          </div>
          <label className="grid gap-1">
            Notatki dla kierowcy
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="np. wjazd od ul. Polnej, ochrona prosi o dowód" />
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
