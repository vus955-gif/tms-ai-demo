"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, MapPinned, Plus, Star, Trash2, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COUNTRY_NAMES, type Country } from "@/domain/countries";
import { useWorldReady } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ClientOverview } from "@/server/clients/clients";
import { ClientDialog } from "./client-dialog";
import { PointDialog } from "./point-dialog";

const PointMap = dynamic(() => import("./point-map").then((m) => m.PointMap), { ssr: false, loading: () => <div className="h-56 w-full rounded-lg border bg-muted/40" /> });

type Data = { clients: ClientOverview[]; geocoder: boolean };

/** The client book: who the clients are, how to reach them and where we load and unload for them. */
export function ClientsView() {
  const ready = useWorldReady();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingPoint, setEditingPoint] = useState<ClientOverview["points"][number] | "new" | null>(null);
  const q = useQuery({ queryKey: ["clients"], queryFn: () => getJson<Data>("/api/clients"), enabled: ready });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  };
  const list = (q.data?.clients ?? []).filter((c) => c.name.toLocaleLowerCase("pl").includes(query.trim().toLocaleLowerCase("pl")));
  const selected = q.data?.clients.find((c) => c.id === selectedId) ?? list[0] ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col border-r bg-background">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h1 className="text-sm font-semibold">Klienci</h1>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="new-client">
            <Plus /> Nowy klient
          </Button>
        </div>
        <div className="border-b p-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj klienta…" aria-label="Szukaj klienta" className="h-8" />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="client-list">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={cn("w-full border-b px-3 py-2 text-left hover:bg-muted/60", selected?.id === c.id && "bg-muted")}
                data-testid={`client-${c.id}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {c.name}
                  {c.isKey && <Star className="size-3 fill-current text-warn" aria-label="klient kluczowy" />}
                </span>
                <span className="text-xs text-muted-foreground">
                  punkty: {c.points.length} · zlecenia w toku: {c.openOrders} · zamknięte: {c.closedOrders}
                </span>
              </button>
            </li>
          ))}
          {q.data && list.length === 0 && <li className="p-4 text-sm text-muted-foreground">Brak klientów pasujących do wyszukiwania.</li>}
        </ul>
      </aside>

      <section className="min-h-0 overflow-y-auto p-4" data-testid="client-detail">
        {!selected ? (
          <p className="text-sm text-muted-foreground">{q.isPending ? "Wczytywanie klientów…" : "Wybierz klienta z listy."}</p>
        ) : (
          <ClientCard key={selected.id} client={selected} onChanged={refresh} onAddPoint={() => setEditingPoint("new")} onEditPoint={setEditingPoint} />
        )}
      </section>

      {creating && (
        <ClientDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setSelectedId(id);
            setQuery("");
            refresh();
          }}
        />
      )}
      {editingPoint && selected && (
        <PointDialog
          key={editingPoint === "new" ? "new" : editingPoint.id}
          client={selected}
          point={editingPoint === "new" ? null : editingPoint}
          geocoder={q.data?.geocoder ?? false}
          onClose={() => setEditingPoint(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function ClientCard({
  client,
  onChanged,
  onAddPoint,
  onEditPoint,
}: {
  client: ClientOverview;
  onChanged: () => void;
  onAddPoint: () => void;
  onEditPoint: (p: ClientOverview["points"][number]) => void;
}) {
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [addingContact, setAddingContact] = useState(false);
  const toggleKey = useMutation({
    mutationFn: () => postJson(`/api/clients/${client.id}`, { action: "update", values: { isKey: !client.isKey } }),
    onSuccess: onChanged,
    onError: (e) => toast.error(e.message),
  });
  const addContact = useMutation({
    mutationFn: () => postJson(`/api/clients/${client.id}`, { action: "addContact", contact }),
    onSuccess: () => {
      toast.success("Osoba dodana — może pisać przez „Pocztę klienta”.");
      setContact({ name: "", email: "", phone: "" });
      setAddingContact(false);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const removePoint = useMutation({
    mutationFn: (id: string) => postJson(`/api/points/${id}`, { action: "delete" }),
    onSuccess: () => {
      toast.success("Punkt usunięty.");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const pins = useMemo(() => client.points.map((p) => ({ id: p.id, lng: p.lng, lat: p.lat, label: p.name })), [client.points]);
  const submitContact = (e: FormEvent) => {
    e.preventDefault();
    addContact.mutate();
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="size-5 text-muted-foreground" />
            {client.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {client.taxId ? `NIP/VAT: ${client.taxId}` : "bez NIP"} · {client.manual ? "dodany w aplikacji" : "klient ze scenariusza demo"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={client.isKey} onChange={() => toggleKey.mutate()} className="size-4" /> Klient kluczowy
        </label>
      </header>

      <section className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-sm font-semibold">Osoby kontaktowe</h3>
          <Button size="sm" variant="ghost" onClick={() => setAddingContact((v) => !v)} data-testid="add-contact">
            <UserPlus /> Dodaj osobę
          </Button>
        </div>
        <ul className="divide-y text-sm">
          {client.contacts.map((k) => (
            <li key={k.id} className="flex flex-wrap gap-x-4 px-3 py-1.5">
              <span className="font-medium">{k.name}</span>
              <span className="text-muted-foreground">{k.email}</span>
              {k.phone && <a href={`tel:${k.phone.replace(/\s/g, "")}`} className="text-muted-foreground hover:underline">{k.phone}</a>}
            </li>
          ))}
        </ul>
        {addingContact && (
          <form onSubmit={submitContact} className="grid gap-2 border-t p-3 sm:grid-cols-[1fr_1fr_160px_auto]" data-testid="contact-form">
            <Input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Imię i nazwisko" aria-label="Imię i nazwisko" />
            <Input value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} placeholder="e-mail" type="email" aria-label="E-mail osoby" />
            <Input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="telefon" aria-label="Telefon osoby" />
            <Button type="submit" size="sm" disabled={addContact.isPending}>
              Zapisz
            </Button>
          </form>
        )}
      </section>

      <section className="rounded-lg border bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPinned className="size-4" /> Książka punktów
          </h3>
          <Button size="sm" variant="outline" onClick={onAddPoint} data-testid="add-point">
            <Plus /> Dodaj punkt
          </Button>
        </div>
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul className="grid content-start gap-2" data-testid="point-list">
            {client.points.map((p) => (
              <li key={p.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" className="text-left font-medium hover:underline" onClick={() => onEditPoint(p)}>
                    {p.name}
                  </button>
                  {p.manual && (
                    <button type="button" onClick={() => removePoint.mutate(p.id)} className="text-muted-foreground hover:text-bad" aria-label={`Usuń punkt ${p.name}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.address}, {p.city} · {COUNTRY_NAMES[p.country as Country] ?? p.country}
                </div>
                <div className="text-xs">
                  {p.openingHours || "godziny nieustalone"} · obsługa {p.handlingMinutes} min
                </div>
                {p.requirements && <div className="text-xs">Wymagania: {p.requirements}</div>}
                {p.notes && <div className="text-xs italic">„{p.notes}”</div>}
                {p.manual && <div className="mt-1 text-[11px] text-warn">dodany w aplikacji · trasy przybliżone</div>}
              </li>
            ))}
            {client.points.length === 0 && <li className="text-sm text-muted-foreground">Brak punktów — dodaj pierwszy, żeby zakładać zlecenia dla tego klienta.</li>}
          </ul>
          {client.points.length > 0 && <PointMap pins={pins} className="h-72 w-full overflow-hidden rounded-lg border" />}
        </div>
      </section>
    </div>
  );
}
