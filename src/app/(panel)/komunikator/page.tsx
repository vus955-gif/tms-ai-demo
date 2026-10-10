import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { MessengerView } from "@/components/messenger/messenger-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie wiadomości…</div>;

export default function MessengerPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <MessengerView />
      </Suspense>
    </ClientOnly>
  );
}
