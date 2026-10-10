"use client";

import { Truck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Wpisz hasło do demo.");
      return;
    }
    setPending(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Nieprawidłowe hasło.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/monitoring";
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <Truck className="size-4" aria-hidden />
          </span>
          TMS demo
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Hasło do demo</Label>
          <Input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <Button type="submit" disabled={pending}>
          Wejdź
        </Button>
      </form>
    </div>
  );
}
