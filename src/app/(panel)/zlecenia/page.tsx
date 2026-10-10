import { ClientOnly } from "@/components/client-only";
import { OrdersBoard } from "@/components/orders/orders-board";

export default function OrdersPage() {
  return (
    <ClientOnly fallback={<div className="p-6 text-sm text-muted-foreground">Wczytywanie zleceń…</div>}>
      <OrdersBoard />
    </ClientOnly>
  );
}
