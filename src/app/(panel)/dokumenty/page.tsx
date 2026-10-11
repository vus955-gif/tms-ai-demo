import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { DocumentsView } from "@/components/documents/documents-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie dokumentów…</div>;

export default function DocumentsPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <DocumentsView />
      </Suspense>
    </ClientOnly>
  );
}
