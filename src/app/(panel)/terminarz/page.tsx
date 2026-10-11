import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { CalendarView } from "@/components/fleet/calendar-view";

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie terminarza…</div>;

export default function CalendarPage() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <CalendarView />
      </Suspense>
    </ClientOnly>
  );
}
