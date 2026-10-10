import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { MonitoringView } from "@/components/monitoring/monitoring-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie floty…</div>;

export default function MonitoringPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <MonitoringView />
      </Suspense>
    </ClientOnly>
  );
}
