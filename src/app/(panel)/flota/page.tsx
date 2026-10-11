import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { FleetView } from "@/components/fleet/fleet-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie kartoteki…</div>;

export default function FleetPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <FleetView />
      </Suspense>
    </ClientOnly>
  );
}
