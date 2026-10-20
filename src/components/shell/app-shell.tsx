"use client";

import { Bot, BriefcaseBusiness, Building2, CalendarDays, ClipboardList, FileText, Mail, Map, MessageSquare, Repeat, Truck, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSnapshot } from "@/hooks/use-snapshot";
import { cn } from "@/lib/utils";
import { AlertsButton } from "@/components/alerts/alerts-panel";
import { ClientMailButton } from "@/components/client-mail/client-mail-panel";
import { ClientViewButton } from "@/components/tracking/client-view-panel";
import { PhoneButton } from "@/components/phone/phone-panel";
import { AiBadge } from "./ai-badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ClockControls } from "./clock-controls";
import { ResetDialog } from "./reset-dialog";
import { useRole } from "./role";
import { SimClock } from "./sim-clock";

export const NAV = [
  { href: "/sprzedaz", label: "Sprzedaż", icon: BriefcaseBusiness, roles: ["handlowiec"] },
  { href: "/monitoring", label: "Monitoring", icon: Map, roles: ["spedytor"] },
  { href: "/zlecenia", label: "Zlecenia", icon: ClipboardList, roles: ["spedytor", "handlowiec"] },
  { href: "/szablony", label: "Zlecenia stałe", icon: Repeat, roles: ["spedytor"] },
  { href: "/komunikator", label: "Komunikator", icon: MessageSquare, roles: ["spedytor"] },
  { href: "/skrzynka", label: "Skrzynka", icon: Mail, roles: ["spedytor", "handlowiec"] },
  { href: "/klienci", label: "Klienci", icon: Building2, roles: ["spedytor", "handlowiec"] },
  { href: "/dokumenty", label: "Dokumenty", icon: FileText, roles: ["spedytor"] },
  { href: "/flota", label: "Flota", icon: Wrench, roles: ["spedytor"] },
  { href: "/terminarz", label: "Terminarz", icon: CalendarDays, roles: ["spedytor"] },
  { href: "/dziennik-ai", label: "Dziennik AI", icon: Bot, roles: ["spedytor", "handlowiec"] },
] as const;

export function AppShell({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  const pathname = usePathname();
  const { data: snapshot, isError, error } = useSnapshot();
  const [role, setRole] = useRole();

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
        <ClientViewButton />
        <ClientMailButton />
        <PhoneButton />
        <AlertsButton />
        <ThemeToggle />
        <AiBadge status={snapshot?.ai} />
      </header>
      {isError && (
        <div role="alert" className="border-b bg-bad-soft px-4 py-2 text-sm text-bad">
          {error.message} Kolejna próba za chwilę.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-background p-2" aria-label="Menu główne">
          <div className="mb-1.5 grid grid-cols-2 rounded-md bg-muted p-0.5 text-[11px]" role="group" aria-label="Rola">
            {(["spedytor", "handlowiec"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                data-testid={`role-${r}`}
                className={cn("rounded px-1.5 py-1 capitalize", role === r ? "bg-background font-medium shadow-xs" : "text-muted-foreground")}
              >
                {r}
              </button>
            ))}
          </div>
          {NAV.filter((item) => (item.roles as readonly string[]).includes(role)).map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const badges: Record<string, number | undefined> = {
              "/komunikator": snapshot?.badges.komunikator,
              "/skrzynka": snapshot?.badges.skrzynka,
              "/dokumenty": snapshot?.badges.dokumenty,
              "/sprzedaz": snapshot?.badges.sprzedaz,
              "/flota": snapshot?.badges.flota,
            };
            const badge = badges[href] ?? 0;
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
                {badge ? (
                  <span className="ml-auto rounded-full bg-brand px-1.5 text-[10px] font-semibold leading-4 text-brand-foreground" aria-label={`${badge} nowych`}>
                    {badge}
                  </span>
                ) : null}
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
