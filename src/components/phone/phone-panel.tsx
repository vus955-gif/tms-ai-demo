"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Smartphone, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ThreadDetail, ThreadMessage } from "@/server/messages/threads";
import { CmrTray } from "./cmr-tray";

const MAX = 500;

/** Demo tool: the visitor plays a driver; that driver's bot stays silent meanwhile. */
export function PhoneButton() {
  const [open, setOpen] = useState(false);
  const { data: snapshot } = useSnapshot();
  const queryClient = useQueryClient();
  const select = useMutation({
    mutationFn: (driverId: string | null) => postJson("/api/phone", { driverId }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY }),
  });
  const close = () => {
    setOpen(false);
    select.mutate(null);
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        data-testid="phone-toggle"
        className={cn(snapshot?.phoneDriverId && "border-brand text-brand")}
      >
        <Smartphone /> Telefon kierowcy
      </Button>
      {open && <PhonePanel driverId={snapshot?.phoneDriverId ?? null} onSelect={(id) => select.mutate(id)} onClose={close} />}
    </>
  );
}

function PhonePanel({ driverId, onSelect, onClose }: { driverId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const { data: snapshot } = useSnapshot();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const drivers = [...(snapshot?.fleet ?? [])].sort((a, b) => a.driverName.localeCompare(b.driverName, "pl"));
  const thread = useQuery({
    queryKey: ["thread", driverId, snapshot?.simNow],
    queryFn: () => getJson<ThreadDetail>(`/api/messages/${driverId}`),
    enabled: Boolean(driverId && snapshot),
    placeholderData: (prev) => (prev?.driverId === driverId ? prev : undefined),
  });
  // Call notes are the forwarder's own record, not SMS on the driver's phone.
  const sms = (thread.data?.messages ?? []).filter((m) => m.channel !== "phone");
  const count = sms.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["thread"] });
    void queryClient.invalidateQueries({ queryKey: ["threads"] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };
  const send = useMutation({
    mutationFn: (body: string) => postJson("/api/phone/send", { driverId, body }),
    onSuccess: (_data, body) => {
      // Keep anything typed while the message was on its way.
      setText((current) => (current.trim() === body ? "" : current));
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const tooLong = text.length > MAX;

  return (
    <div className="absolute right-2 top-12 z-50 flex h-[min(640px,calc(100dvh-4rem))] w-[340px] flex-col overflow-hidden rounded-[28px] border-[6px] border-foreground/85 bg-background shadow-2xl" data-testid="phone-panel">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <select
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
          value={driverId ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Kierowca, w którego się wcielasz"
          data-testid="phone-driver"
        >
          <option value="">Wybierz kierowcę…</option>
          {drivers.map((v) => (
            <option key={v.driverId} value={v.driverId}>
              {v.driverName} ({v.plates})
            </option>
          ))}
        </select>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Zamknij telefon">
          <X />
        </Button>
      </div>
      {!driverId ? (
        <p className="p-4 text-sm text-muted-foreground">
          Wybierz kierowcę — zobaczysz SMS-y, które dostaje od spedycji, i odpiszesz jako on. Bot tego kierowcy w tym czasie milczy.
        </p>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-3" data-testid="phone-thread">
            {sms.map((m) => (
              <div key={m.id} className={cn("flex", m.direction === "in" ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-2xl px-3 py-1.5 text-[13px]", m.direction === "in" ? "rounded-br-sm bg-ok text-white" : "rounded-bl-sm border bg-background")}>
                  <Attachments message={m} />
                  {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
                  <p className={cn("text-right text-[10px]", m.direction === "in" ? "text-white/80" : "text-muted-foreground")}>{formatTime(m.atSim)}</p>
                </div>
              </div>
            ))}
            {thread.data && sms.length === 0 && <p className="text-center text-xs text-muted-foreground">Brak SMS-ów.</p>}
            <div ref={bottom} />
          </div>
          <CmrTray driverId={driverId} onSent={refresh} />
          <form
            className="flex items-end gap-2 border-t p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim() || tooLong) return;
              send.mutate(text.trim());
            }}
          >
            <div className="flex-1">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-xl border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                placeholder="SMS do spedycji"
                aria-label="Treść SMS-a jako kierowca"
                data-testid="phone-input"
              />
              <div className={cn("text-right text-[10px]", tooLong ? "text-destructive" : "text-muted-foreground")}>
                {text.length}/{MAX}
              </div>
            </div>
            <Button type="submit" size="icon" disabled={!text.trim() || tooLong || send.isPending} aria-label="Wyślij SMS" data-testid="phone-send">
              <Send />
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export function Attachments({ message }: { message: Pick<ThreadMessage, "attachments"> }) {
  if (message.attachments.length === 0) return null;
  return (
    <div className="mb-1 space-y-1">
      {message.attachments.map((a, i) =>
        a.sampleId ? (
          // eslint-disable-next-line @next/next/no-img-element -- static demo photo
          <img key={i} src={`/cmr-samples/${a.sampleId}.jpg`} alt="Zdjęcie CMR" className="max-h-32 rounded-md border bg-white object-cover" />
        ) : (
          <p key={i} className="text-xs italic opacity-90">
            📎 {a.name ?? "zdjęcie"} (nie jest przechowywane)
          </p>
        ),
      )}
    </div>
  );
}
