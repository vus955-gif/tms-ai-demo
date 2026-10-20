import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { ClientsView } from "@/components/clients/clients-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie klientów…</div>;

export default function ClientsPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <ClientsView />
      </Suspense>
    </ClientOnly>
  );
}
