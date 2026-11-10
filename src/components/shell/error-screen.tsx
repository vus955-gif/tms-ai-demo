"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Fallback shown by the error boundaries (error.tsx files) when a screen fails to render. */
export function ErrorScreen({ error, retry, description }: { error: unknown; retry: () => void; description: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // Server-side errors arrive with a digest that matches the entry in the server logs.
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;

  return (
    <div role="alert" data-testid="error-screen" className="mx-auto flex max-w-xl flex-col items-start gap-4 p-10">
      <span className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
        <TriangleAlert className="size-5 text-destructive" aria-hidden />
      </span>
      <div>
        <h1 className="text-xl font-semibold">Coś poszło nie tak</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button onClick={() => retry()}>
        <RotateCw aria-hidden />
        Spróbuj ponownie
      </Button>
      {digest && <p className="font-mono text-xs text-muted-foreground">Kod błędu: {digest}</p>}
    </div>
  );
}
