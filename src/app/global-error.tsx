"use client";

import { useEffect } from "react";

/**
 * Last resort: the root layout itself failed. This replaces the whole document, so it brings its own
 * <html>/<body> and plain inline styles (the app stylesheet and theme are not available here).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pl">
      <body style={{ margin: 0, minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", colorScheme: "light dark" }}>
        <title>Błąd — TMS z AI</title>
        <main role="alert" style={{ maxWidth: "28rem", padding: "2rem" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.5rem" }}>Coś poszło nie tak</h1>
          <p style={{ margin: "0 0 1.25rem", opacity: 0.75, lineHeight: 1.5 }}>Program nie wczytał się poprawnie. Spróbuj ponownie za chwilę.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "0.5rem 1rem", fontSize: "0.875rem", borderRadius: "0.375rem", border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}>
            Spróbuj ponownie
          </button>
        </main>
      </body>
    </html>
  );
}
