import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { InboxView } from "@/components/inbox/inbox-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie skrzynki…</div>;

export default function InboxPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <InboxView />
      </Suspense>
    </ClientOnly>
  );
}
