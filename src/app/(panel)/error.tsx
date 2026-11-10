"use client";

import { ErrorScreen } from "@/components/shell/error-screen";

/** A failing module must not take the menu and the clock down with it: the shell (layout above) stays. */
export default function PanelError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} description="Ten ekran nie wczytał się poprawnie. Reszta programu działa — spróbuj ponownie albo wybierz inny moduł z menu." />;
}
