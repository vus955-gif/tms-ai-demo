import type { Metadata } from "next";
import { Suspense } from "react";
import { ClientOnly } from "@/components/client-only";
import { DriverOrderPage } from "@/components/driver-link/driver-order-page";

export const metadata: Metadata = { title: "Zlecenie dla kierowcy", robots: { index: false, follow: false } };

async function Order({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DriverOrderPage token={token} />;
}

const Loading = () => <div className="p-6 text-sm text-muted-foreground">Wczytywanie zlecenia…</div>;

/** The driver's page for one order, opened from the link in the order SMS ("k" keeps the SMS link short). */
export default function DriverLinkPage(props: PageProps<"/k/[token]">) {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <Order params={props.params} />
      </Suspense>
    </ClientOnly>
  );
}
