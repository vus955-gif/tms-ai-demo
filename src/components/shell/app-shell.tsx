"use client";

import { Bot, ClipboardList, FileText, Mail, Map, MessageSquare, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSnapshot } from "@/hooks/use-snapshot";
import { cn } from "@/lib/utils";
import { AlertsButton } from "@/components/alerts/alerts-panel";
import { AiBadge } from "./ai-badge";
import { ClockControls } from "./clock-controls";
import { ResetDialog } from "./reset-dialog";
import { SimClock } from "./sim-clock";

export const NAV = [
  { href: "/monitoring", label: "Monitoring", icon: Map },
  { href: "/zlecenia", label: "Zlecenia", icon: ClipboardList },
  { href: "/komunikator", label: "Komunikator", icon: MessageSquare },
  { href: "/skrzynka", label: "Skrzynka", icon: Mail },
  { href: "/dokumenty", label: "Dokumenty", icon: FileText },
  { href: "/dziennik-ai", label: "Dziennik AI", icon: Bot },
] as const;

export function AppShell({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  const pathname = usePathname();
  const { data: snapshot, isError, error } = useSnapshot();

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-muted/30">
      <header className="relative flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
        <Link href="/monitoring" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <Truck className="size-4" aria-hidden />
          </span>
          <span className="hidden sm:inline">TMS demo</span>
        </Link>
        <SimClock snapshot={snapshot} />
        <ClockControls snapshot={snapshot} />
        <ResetDialog snapshot={snapshot} />
        <div className="flex-1" />
        {toolbar}
        <AlertsButton />
        <AiBadge status={snapshot?.ai} />
      </header>
      {isError && (
        <div role="alert" className="border-b bg-bad-soft px-4 py-2 text-sm text-bad">
          {error.message} Kolejna próba za chwilę.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-background p-2" aria-label="Menu główne">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            );
          })}
          <div className="mt-auto px-2.5 pb-1 text-[11px] leading-snug text-muted-foreground">
            Dane fikcyjne. Mapa © OpenStreetMap contributors.
          </div>
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
