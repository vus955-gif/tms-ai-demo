import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { ShipmentsView } from "@/components/shipments/shipments-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie przesyłek…</div>;

export default function ShipmentsPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <ShipmentsView />
      </Suspense>
    </ClientOnly>
  );
}
