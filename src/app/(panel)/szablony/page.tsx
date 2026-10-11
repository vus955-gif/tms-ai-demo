import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { TemplatesView } from "@/components/templates/templates-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie szablonów…</div>;

export default function TemplatesPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <TemplatesView />
      </Suspense>
    </ClientOnly>
  );
}
