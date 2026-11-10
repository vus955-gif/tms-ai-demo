import { MapPinOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Nie ma takiej strony — TMS z AI" };

/** Unknown address anywhere in the app. Kept as a Server Component: Next.js ships this file with every route. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div data-testid="not-found" className="flex w-full max-w-md flex-col items-start gap-4 rounded-xl border bg-background p-8 shadow-sm">
        <span className="flex size-10 items-center justify-center rounded-lg bg-accent">
          <MapPinOff className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Nie ma takiej strony</h1>
          <p className="text-sm text-muted-foreground">Adres jest błędny albo strona została przeniesiona. Sprawdź link lub wróć do programu.</p>
        </div>
        <Button asChild>
          <Link href="/monitoring">Wróć do monitoringu</Link>
        </Button>
      </div>
    </div>
  );
}
