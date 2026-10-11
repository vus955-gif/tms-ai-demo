"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { formatHm, formatSimClock, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrderCard as OrderCardData } from "@/server/orders/board";

const STATUS_TONE: Record<string, string> = {
  NOWE: "bg-muted text-foreground",
  SZKIC: "bg-ai-soft text-ai",
  PRZYPISANE: "bg-warn-soft text-warn",
  WYSLANE: "bg-warn-soft text-warn",
  POTWIERDZONE: "bg-ok-soft text-ok",
  ZALADUNEK: "bg-ok-soft text-ok",
  W_DRODZE: "bg-ok-soft text-ok",
  ROZLADUNEK: "bg-ok-soft text-ok",
  DO_ZAMKNIECIA: "bg-accent text-foreground",
};

export function windowShort(fromIso: string, toIso: string) {
  return `${formatSimClock(fromIso).replace(" · ", " ")}–${formatTime(toIso)}`;
}

export function OrderCardBody({ order, compact = false }: { order: OrderCardData; compact?: boolean }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{order.number}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", STATUS_TONE[order.status] ?? "bg-muted")}>{order.statusLabel}</span>
      </div>
      <div className="truncate text-xs text-muted-foreground">{order.clientName}</div>
      <div className="text-xs">{order.routeLabel}</div>
      {!compact && (
        <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
          <div>załadunek {windowShort(order.pickupFrom, order.pickupTo)}</div>
          <div>rozładunek {windowShort(order.deliveryFrom, order.deliveryTo)}</div>
          <div>
            {order.cargoPallets} palet · {Math.round(order.cargoKg).toLocaleString("pl-PL")} kg
            {order.bodyRequired === "chlodnia" ? " · chłodnia" : ""}
            {order.adrRequired ? " · ADR" : ""}
          </div>
        </div>
      )}
      {order.source === "email" && (
        <div className="mt-1 flex items-center gap-1 text-[11px] text-ai">
          <Mail className="size-3" aria-hidden /> z maila klienta{order.status === "SZKIC" ? " · szkic do zatwierdzenia" : ""}
        </div>
      )}
      {compact && order.eta && <div className="text-[11px] text-muted-foreground">ETA {formatTime(order.eta)}</div>}
    </>
  );
}

/** An e-mail draft: not draggable until the dispatcher approves it. */
export function DraftOrderCard({ order, actions }: { order: OrderCardData; actions?: ReactNode }) {
  return (
    <div data-testid={`order-card-${order.number}`} className="rounded-lg border border-ai/40 bg-ai-soft/40 p-2.5 text-sm shadow-xs">
      <OrderCardBody order={order} />
      {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}

export function DraggableOrderCard({ order, actions }: { order: OrderCardData; actions?: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: order.id, data: { order } });
  return (
    <div
      ref={setNodeRef}
      data-testid={`order-card-${order.number}`}
      className={cn("rounded-lg border border-dashed border-brand/50 bg-background p-2.5 text-sm shadow-xs", isDragging && "opacity-40")}
    >
      <div className="flex gap-1.5">
        <button
          type="button"
          className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label={`Przeciągnij ${order.number} na kierowcę`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <OrderCardBody order={order} />
          {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function minutesLabel(min: number) {
  return min >= 60 ? formatHm(min) : `${Math.round(min)} min`;
}
