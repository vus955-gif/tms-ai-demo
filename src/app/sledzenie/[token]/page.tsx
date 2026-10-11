import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { TrackingView } from "@/components/tracking/tracking-view";

export const metadata: Metadata = { title: "Śledzenie przesyłki", robots: { index: false, follow: false } };

async function Tracking({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <TrackingView token={token} />;
}

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie śledzenia…</div>;

export default function TrackingPage(props: PageProps<"/sledzenie/[token]">) {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <Tracking params={props.params} />
      </Suspense>
    </ClientOnly>
  );
}
