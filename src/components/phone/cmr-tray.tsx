"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, getJson, postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

type Sample = { id: string; label: string; file: string; orderNumber: string | null; unloaded: boolean };

const MAX_BYTES = 4 * 1024 * 1024;

async function uploadPhoto(driverId: string, file: File) {
  const form = new FormData();
  form.set("driverId", driverId);
  form.set("body", "Zdjęcie CMR");
  form.set("file", file);
  const res = await fetch("/api/phone/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Błąd serwera (${res.status})`);
  return body;
}

/** "Camera roll" of the played driver: send a scenario CMR photo or your own picture. */
export function CmrTray({ driverId, onSent }: { driverId: string; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const samples = useQuery({
    queryKey: ["phone-samples", driverId],
    queryFn: () => getJson<{ samples: Sample[] }>(`/api/phone?driverId=${encodeURIComponent(driverId)}`),
    enabled: open,
  });
  const sendSample = useMutation({
    mutationFn: (sampleId: string) => postJson("/api/phone/send", { driverId, body: "CMR w załączniku", sampleId }),
    onSuccess: () => {
      setOpen(false);
      onSent();
    },
    onError: (e) => toast.error(e.message),
  });
  const sendOwn = useMutation({
    mutationFn: (file: File) => uploadPhoto(driverId, file),
    onSuccess: () => {
      setOpen(false);
      onSent();
      toast.info("Zdjęcie odczytane i odrzucone — demo go nie przechowuje.");
    },
    onError: (e) => toast.error(e.message),
  });
  const busy = sendSample.isPending || sendOwn.isPending;

  return (
    <div className="border-t bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        data-testid="phone-camera"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
        {busy ? "AI czyta zdjęcie…" : open ? "Schowaj zdjęcia" : "Wyślij zdjęcie CMR (MMS)"}
      </button>
      {open && !busy && (
        <div className="space-y-2 px-3 pb-2">
          <div className="grid max-h-44 grid-cols-3 gap-1.5 overflow-y-auto" data-testid="phone-samples">
            {samples.data?.samples.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.label}
                onClick={() => sendSample.mutate(s.id)}
                className={cn("group overflow-hidden rounded-md border text-left", s.unloaded && "border-brand")}
                data-testid={`sample-${s.id}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static demo photos, no optimisation needed */}
                <img src={s.file} alt={s.label} className="h-16 w-full object-cover transition-opacity group-hover:opacity-80" loading="lazy" />
                <span className="block truncate px-1 py-0.5 text-[10px] leading-tight">{s.label}</span>
              </button>
            ))}
            {samples.isLoading && <p className="col-span-3 text-xs text-muted-foreground">Wczytywanie…</p>}
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">Obramowane — zlecenia po rozładunku. „Dokument obcy” sprawdza, czy AI nie przypisze cudzego CMR.</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            data-testid="phone-upload"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > MAX_BYTES) return void toast.error("Zdjęcie jest za duże (najwyżej 4 MB).");
              sendOwn.mutate(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-xs hover:bg-accent/60"
          >
            <ImagePlus className="size-3.5" /> Własne zdjęcie (nie jest zapisywane)
          </button>
        </div>
      )}
    </div>
  );
}
