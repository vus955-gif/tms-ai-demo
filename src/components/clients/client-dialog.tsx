"use client";

import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api";

/** New client with the first contact person; points are added next, on the client's card. */
export function ClientDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [isKey, setIsKey] = useState(false);
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => postJson<{ id: string }>("/api/clients", { name, taxId, isKey, contact }),
    onSuccess: (r) => {
      toast.success("Klient dodany — dodaj teraz jego punkty załadunku i rozładunku.");
      onSaved(r.id);
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nowy klient</DialogTitle>
          <DialogDescription>Dane w demo są fikcyjne — nie wpisuj prawdziwych danych osobowych.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 text-sm" data-testid="client-form">
          <label className="grid gap-1">
            Nazwa firmy
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Brioche Polska Sp. z o.o." />
          </label>
          <label className="grid gap-1">
            NIP lub numer VAT UE (opcjonalnie)
            <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="np. 123-456-78-83 albo DE123456789" />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={isKey} onChange={(e) => setIsKey(e.target.checked)} className="size-4" /> Klient kluczowy
          </label>
          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-xs text-muted-foreground">Osoba kontaktowa</legend>
            <Input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Imię i nazwisko" aria-label="Osoba kontaktowa" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} placeholder="e-mail" type="email" aria-label="E-mail" />
              <Input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="telefon (opcjonalnie)" aria-label="Telefon" />
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={save.isPending} data-testid="save-client">
              Dodaj klienta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
