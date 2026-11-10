"use client";

import { ErrorScreen } from "@/components/shell/error-screen";

/** Pages outside the panel (login, client tracking link). */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-xl rounded-xl border bg-background shadow-sm">
        <ErrorScreen error={error} retry={retry} description="Nie udało się wczytać tej strony. Spróbuj ponownie za chwilę." />
      </div>
    </div>
  );
}
