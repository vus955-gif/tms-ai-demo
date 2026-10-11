import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { SalesView } from "@/components/sales/sales-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie wycen…</div>;

export default function SalesPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <SalesView />
      </Suspense>
    </ClientOnly>
  );
}
