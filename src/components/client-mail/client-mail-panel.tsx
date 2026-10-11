"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AtSign, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CATEGORY } from "@/components/inbox/inbox-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SNAPSHOT_KEY } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import type { MailClient } from "@/app/api/client-mail/route";

const EXAMPLES = [
  { label: "Zamówienie", subject: "Zlecenie transportu", body: "Dzień dobry,\nprosimy o transport.\nZaładunek: jutro 08:00–10:00.\nRozładunek: jutro 14:00–16:00.\n10 palet, 4000 kg.\nPozdrawiam" },
  { label: "Gdzie jest auto?", subject: "Gdzie jest nasze auto?", body: "Dzień dobry,\ngdzie jest teraz auto z naszym towarem i o której będzie u odbiorcy?" },
  { label: "Reklamacja", subject: "Reklamacja dostawy", body: "Dzień dobry,\nprzy ostatniej dostawie dwie palety były uszkodzone. Prosimy o kontakt." },
  { label: "Wycena", subject: "Prośba o wycenę", body: "Dzień dobry,\nprosimy o ofertę na kontener 40' z Gdańska do Szanghaju, FOB, ok. 20 t." },
];

/** Demo tool: the visitor writes an e-mail as one of the fictional clients. */
export function ClientMailButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="client-mail-toggle">
        <AtSign /> Poczta klienta
      </Button>
      {open && <ClientMailPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function ClientMailPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["client-mail"], queryFn: () => getJson<{ clients: MailClient[] }>("/api/client-mail") });
  const [clientId, setClientId] = useState("");
  const [contactId, setContactId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const client = list.data?.clients.find((c) => c.id === clientId);
  const send = useMutation({
    mutationFn: () => postJson<{ rootId: string; category: string }>("/api/client-mail", { contactId, subject, body }),
    onSuccess: (r) => {
      setSubject("");
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["inbox"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
      toast.success(`Mail w Skrzynce — kategoria: ${CATEGORY[r.category]?.label ?? r.category}`, {
        action: { label: "Otwórz", onClick: () => router.push(`/skrzynka?m=${r.rootId}`) },
      });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="absolute right-[356px] top-12 z-50 flex w-[380px] flex-col gap-2 rounded-xl border bg-background p-3 shadow-2xl" data-testid="client-mail-panel">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Poczta klienta</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Zamknij pocztę klienta">
          <X />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Napisz jako klient — mail trafi do Skrzynki spedytora i przejdzie przez tę samą ocenę AI co maile ze scenariusza.</p>
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={clientId}
        onChange={(e) => {
          setClientId(e.target.value);
          setContactId(list.data?.clients.find((c) => c.id === e.target.value)?.contacts[0]?.id ?? "");
        }}
        aria-label="Klient"
        data-testid="client-mail-client"
      >
        <option value="">Wybierz klienta…</option>
        {list.data?.clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {client && (
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Osoba kontaktowa">
          {client.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} &lt;{c.email}&gt;
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-wrap gap-1">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => {
              setSubject(ex.subject);
              setBody(ex.body);
            }}
            className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-accent"
          >
            {ex.label}
          </button>
        ))}
      </div>
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Temat" maxLength={200} aria-label="Temat maila" data-testid="client-mail-subject" />
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} placeholder="Treść maila" maxLength={4000} aria-label="Treść maila" data-testid="client-mail-body" />
      <Button onClick={() => send.mutate()} disabled={!contactId || !subject.trim() || !body.trim() || send.isPending} data-testid="client-mail-send">
        <Send /> {send.isPending ? "AI czyta mail…" : "Wyślij do spedycji"}
      </Button>
    </div>
  );
}
