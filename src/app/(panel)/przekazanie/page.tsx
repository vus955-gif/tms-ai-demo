import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { HandoverView } from "@/components/handover/handover-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie przekazania zmiany…</div>;

export default function HandoverPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <HandoverView />
      </Suspense>
    </ClientOnly>
  );
}
