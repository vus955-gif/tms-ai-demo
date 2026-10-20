"use client";

import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SNAPSHOT_KEY, useSnapshot } from "@/hooks/use-snapshot";
import { getJson, postJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DriverLane, MatchView, OrderCard as OrderCardData, OrdersBoard as BoardData } from "@/server/orders/board";
import { MatchBlock, TIER_LABEL } from "./match-block";
import { NewOrderDialog } from "./new-order-dialog";
import Link from "next/link";
import { DraftOrderCard, DraggableOrderCard, OrderCardBody } from "./order-card";

export const ORDERS_KEY = ["orders"] as const;

function useBoardMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
  };
  const assign = useMutation({
    mutationFn: ({ orderId, driverId }: { orderId: string; driverId: string; label: string }) => postJson(`/api/orders/${orderId}/assign`, { driverId }),
    onSuccess: (_d, v) => {
      toast.success(v.label);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const action = useMutation({
    mutationFn: ({ orderId, kind }: { orderId: string; kind: "unassign" | "confirm" | "cancel"; label: string }) => postJson(`/api/orders/${orderId}/${kind}`),
    onSuccess: (_d, v) => {
      toast.success(v.label);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const approve = useMutation({
    mutationFn: (order: OrderCardData) => postJson(`/api/orders/${order.id}/draft`, { action: "approve" }),
    onSuccess: (_d, order) => {
      toast.success(`${order.number} zatwierdzone — przydziel je kierowcy`);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  return { assign, action, approve };
}

export function OrdersBoard() {
  const { data: snapshot } = useSnapshot();
  const ready = Boolean(snapshot);
  const board = useQuery({
    queryKey: [...ORDERS_KEY, snapshot?.simNow],
    queryFn: () => getJson<BoardData>("/api/orders"),
    enabled: ready,
    placeholderData: (prev) => prev,
  });
  const [dragging, setDragging] = useState<OrderCardData | null>(null);
  const [picking, setPicking] = useState<OrderCardData | null>(null);
  const [creating, setCreating] = useState(false);
  const matchFor = dragging ?? picking;
  const matching = useQuery({
    queryKey: ["matching", matchFor?.id, snapshot?.simNow],
    queryFn: () => getJson<{ results: MatchView[] }>(`/api/orders/${matchFor!.id}/matching`),
    enabled: Boolean(matchFor),
    staleTime: 10_000,
  });
  const matchByDriver = new Map((matching.data?.results ?? []).map((m) => [m.driverId, m]));
  const { assign, action, approve } = useBoardMutations();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.order as OrderCardData) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    const order = e.active.data.current?.order as OrderCardData | undefined;
    setDragging(null);
    if (!order || !e.over) return;
    const driverId = String(e.over.id);
    const match = matchByDriver.get(driverId);
    if (match?.tier === "excluded") {
      toast.error(`${order.number} nie pasuje: ${match.reasons[0]}`);
      return;
    }
    const lane = board.data?.lanes.find((l) => l.driverId === driverId);
    assign.mutate({ orderId: order.id, driverId, label: `${order.number} wysłane do: ${lane?.driverName ?? "kierowca"}` });
  };

  const data = board.data;
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div className="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-background">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <h1 className="text-sm font-semibold">Nowe zlecenia</h1>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)} data-testid="new-order">
              <Plus /> Nowe zlecenie
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {data?.drafts.map((o) => (
              <DraftOrderCard
                key={o.id}
                order={o}
                actions={
                  <>
                    <Button size="xs" onClick={() => approve.mutate(o)} disabled={approve.isPending} data-testid={`approve-${o.number}`}>
                      Zatwierdź
                    </Button>
                    {o.sourceMessageId && (
                      <Button size="xs" variant="ghost" asChild>
                        <Link href={`/skrzynka?m=${o.sourceMessageId}`}>Mail i poprawki</Link>
                      </Button>
                    )}
                  </>
                }
              />
            ))}
            {data?.newOrders.map((o) => (
              <DraggableOrderCard
                key={o.id}
                order={o}
                actions={
                  <>
                    <Button size="xs" variant="outline" onClick={() => setPicking(o)} data-testid={`pick-${o.number}`}>
                      Przydziel…
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => action.mutate({ orderId: o.id, kind: "cancel", label: `${o.number} anulowane` })}>
                      Anuluj
                    </Button>
                  </>
                }
              />
            ))}
            {data && data.newOrders.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Brak zleceń do przydzielenia.</p>
            )}
            {!data && <p className="text-sm text-muted-foreground">Wczytywanie…</p>}
          </div>
          <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Przeciągnij zlecenie na kierowcę albo użyj „Przydziel…”.</p>
        </aside>

        <section className="min-h-0 overflow-y-auto">
          <div className="sticky top-0 z-10 grid grid-cols-[220px_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 border-b bg-muted/80 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
            <span>Kierowca · pojazd</span>
            <span>Teraz</span>
            <span>Kolejka</span>
          </div>
          <ul className="divide-y">
            {data?.lanes.map((lane) => (
              <Lane
                key={lane.driverId}
                lane={lane}
                match={matchFor ? matchByDriver.get(lane.driverId) : undefined}
                dragging={Boolean(dragging)}
                onAction={(orderId, kind, label) => action.mutate({ orderId, kind, label })}
              />
            ))}
          </ul>
        </section>
      </div>

      <PickDriverDialog
        order={picking}
        results={matching.data?.results}
        loading={matching.isFetching}
        onClose={() => setPicking(null)}
        onPick={(m) => {
          const order = picking!;
          setPicking(null);
          assign.mutate({ orderId: order.id, driverId: m.driverId, label: `${order.number} wysłane do: ${m.driverName}` });
        }}
      />
      <NewOrderDialog open={creating} onOpenChange={setCreating} />
    </DndContext>
  );
}

function Lane({
  lane,
  match,
  dragging,
  onAction,
}: {
  lane: DriverLane;
  match: MatchView | undefined;
  dragging: boolean;
  onAction: (orderId: string, kind: "unassign" | "confirm" | "cancel", label: string) => void;
}) {
  const excluded = match?.tier === "excluded";
  const { setNodeRef, isOver } = useDroppable({ id: lane.driverId, disabled: excluded });
  return (
    <li
      ref={setNodeRef}
      data-testid={`lane-${lane.plates}`}
      className={cn(
        "grid grid-cols-[220px_minmax(0,1fr)_minmax(0,1.4fr)] gap-3 px-4 py-3 transition-colors",
        dragging && excluded && "opacity-50",
        isOver && !excluded && "bg-ok-soft/60",
      )}
    >
      <div className="space-y-1.5">
        <div className="text-sm font-medium">{lane.driverName}</div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Truck className="size-3" aria-hidden />
          {lane.plates}
          {lane.trailerPlates ? ` + ${lane.trailerPlates}` : ""} · {lane.kind === "bus" ? `bus ${lane.capacityPallets} pal.` : `${lane.capacityPallets} pal.`}
        </div>
        {match && <MatchBlock match={match} />}
      </div>
      <div>
        {lane.current ? (
          <div className="rounded-lg border bg-background p-2.5 text-sm">
            <OrderCardBody order={lane.current} compact />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">wolny</div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {lane.queue.map((o) => (
          <div key={o.id} className="w-56 rounded-lg border bg-background p-2.5 text-sm" data-testid={`queue-${o.number}`}>
            <OrderCardBody order={o} compact />
            <div className="mt-2 flex flex-wrap gap-1">
              {o.status === "WYSLANE" && (
                <Button size="xs" variant="outline" onClick={() => onAction(o.id, "confirm", `${o.number} potwierdzone ręcznie`)}>
                  Potwierdź ręcznie
                </Button>
              )}
              {(o.status === "WYSLANE" || o.status === "PRZYPISANE") && (
                <Button size="xs" variant="ghost" onClick={() => onAction(o.id, "unassign", `${o.number} wróciło do puli, kierowca dostał SMS o odwołaniu`)}>
                  Cofnij przydział
                </Button>
              )}
              {o.status === "POTWIERDZONE" && (
                <Button size="xs" variant="ghost" onClick={() => onAction(o.id, "cancel", `${o.number} anulowane, kierowca dostał SMS`)}>
                  Anuluj
                </Button>
              )}
            </div>
          </div>
        ))}
        {lane.queue.length === 0 && <div className="self-center text-xs text-muted-foreground">brak kolejnych zleceń</div>}
      </div>
    </li>
  );
}

function PickDriverDialog({
  order,
  results,
  loading,
  onClose,
  onPick,
}: {
  order: OrderCardData | null;
  results: MatchView[] | undefined;
  loading: boolean;
  onClose: () => void;
  onPick: (m: MatchView) => void;
}) {
  return (
    <Dialog open={Boolean(order)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Przydziel {order?.number}</DialogTitle>
          <DialogDescription>
            {order?.routeLabel} · {order?.cargoPallets} palet. Kolejność wynika z odległości, czasu jazdy, okien i znajomości klienta.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto" data-testid="pick-list">
          {loading && !results && <li className="text-sm text-muted-foreground">Liczę dopasowanie…</li>}
          {results?.map((m) => (
            <li key={m.driverId} className="flex items-start justify-between gap-3 rounded-lg border p-2.5">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">
                  {m.driverName} <span className="font-normal text-muted-foreground">· {m.plates}</span>
                </div>
                <MatchBlock match={m} />
              </div>
              <Button size="sm" disabled={m.tier === "excluded"} onClick={() => onPick(m)} aria-label={`Przydziel: ${m.driverName} (${TIER_LABEL[m.tier]})`}>
                Przydziel
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
