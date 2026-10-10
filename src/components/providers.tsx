"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
