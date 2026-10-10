# Etap 0 — Fundament: plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Szkielet aplikacji TMS z bazą, światami demo, zegarem symulacji, silnikiem aktualizacji, danymi scenariusza, trasami i warstwą AI z limitami — gotowy fundament pod etapy 1–3b.

**Architecture:** Next.js 16 (App Router, cache components włączone). Strony są statycznymi powłokami renderującymi komponenty klienckie; cały stan idzie przez route handlery (`request.cookies`, ciasteczko świata demo). Logika domenowa i symulacja to czyste moduły TypeScript testowane Vitestem; baza przez Drizzle (PGlite lokalnie i w testach, Neon w produkcji).

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript 5 (strict), Tailwind 4 + shadcn/ui, Drizzle ORM 0.45 + drizzle-kit 0.31, @electric-sql/pglite 0.5, @neondatabase/serverless 1.2, @anthropic-ai/sdk 0.133, Zod 4, TanStack Query 5, date-fns 4 + @date-fns/tz, Vitest 5, Playwright 1.64, tsx.

**Spec:** `docs/superpowers/specs/2026-10-10-tms-mvp-design.html` (sekcje 3–6, 9, 12–15).

> **Uwaga o trybie realizacji (2026-10-10, noc):** użytkownik zlecił samodzielną pracę przez noc bez akceptacji planów. Plan jest „żywą listą”: zadania, pliki, interfejsy i przypadki testowe są wiążące; pełny kod powstaje w repozytorium metodą TDD (test → czerwony → implementacja → zielony → commit), zamiast być powielany w planie.

## Global Constraints

- Język interfejsu: polski; identyfikatory w kodzie po angielsku; komunikaty bez „proszę” i wykrzykników.
- Model AI: `claude-haiku-5-5`; AI odpowiada wyłącznie przez `output_config.format` (Zod), limit 10 s, jedno ponowienie, potem tryb awaryjny.
- Limity: `AI_CALLS_PER_SANDBOX_PER_HOUR` = 60, `AI_DAILY_BUDGET_USD` = 2, `SANDBOX_TTL_HOURS` = 24, 20 nowych światów / IP / dobę, ≤ 500 zdarzeń na jedną aktualizację.
- Czas: w bazie UTC (`timestamptz`), interfejs Europe/Warsaw; start symulacji 08:30 Europe/Warsaw w ostatni dzień roboczy ≤ data utworzenia świata; domyślne tempo 10×; dozwolone tempa 1, 10, 60.
- Wszystkie dane fikcyjne; demo nie wysyła prawdziwych SMS-ów ani maili.
- Pliki tras: `data/routes/`, licencja ODbL, atrybucja „© OpenStreetMap contributors”, źródło OSRM.
- Kod na licencji MIT.

## Review Focus

1. Dwie karty przeglądarki odpytujące `/api/tick` jednocześnie — oczekiwanie: brak zdublowanych zdarzeń, druga odpowiedź zwraca aktualną migawkę (test w Task 8).
2. Świat nieodwiedzany wiele godzin — oczekiwanie: nadrabianie bez przekroczenia 500 zdarzeń na aktualizację i bez lawiny wywołań AI (test w Task 8).
3. Brak `ANTHROPIC_API_KEY` — oczekiwanie: aplikacja działa, status AI „tryb awaryjny”, diagnostyka mówi wprost o braku klucza (test w Task 9).
4. Pauza i zmiana tempa w trakcie — oczekiwanie: czas symulacji ciągły, bez skoków wstecz (test w Task 3).
5. Uszkodzone lub obce ciasteczko świata — oczekiwanie: nowy świat zamiast błędu 500 (test w Task 7).

---

### Task 1: Szkielet projektu

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `.gitattributes`, `LICENSE`, `.env.example`, `src/app/*`, `AGENTS.md`

- [ ] Przenieść szkielet `create-next-app@16.4.0` (TS, Tailwind, ESLint, App Router, `src/`, alias `@/*`) do katalogu projektu; nazwa pakietu `tms-ai-demo`.
- [ ] Doinstalować zależności z sekcji Tech Stack; skrypty: `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `test:e2e`, `db:generate`, `db:migrate`, `routes:precompute`, `typecheck`.
- [ ] `vitest.config.ts` z aliasem `@` → `src`, środowisko `node`, wykluczenie `e2e/`.
- [ ] `.gitattributes`: `* text=auto eol=lf`, obrazy jako binarne.
- [ ] Test dymny `src/lib/smoke.test.ts` przechodzi; `npm run build` i `npm run lint` bez błędów.
- [ ] Commit.

### Task 2: Baza danych i schemat etapu 0

**Files:** `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `drizzle.config.ts`, `drizzle/*` (wygenerowane), `src/test/db.ts`, `src/db/schema.test.ts`

**Interfaces — Produces:**
- `getDb(): Promise<Db>` — singleton; PGlite w `./.pglite` gdy brak `DATABASE_URL`, inaczej Neon (`drizzle-orm/neon-serverless`, Pool). Dla PGlite migracje stosowane automatycznie przy pierwszym połączeniu.
- `type Db` — wspólny typ bazy (PgDatabase z naszym schematem).
- `createTestDb(): Promise<Db>` — PGlite w pamięci z zastosowanymi migracjami.
- Tabele etapu 0 (spec §6): `sandboxes`, `vehicles`, `trailers`, `couplings`, `drivers`, `driver_activities`, `clients`, `client_contacts`, `points`, `orders`, `order_status_changes`, `driver_client_history`, `scheduled_events`, `ai_log`, `ai_budget_daily`. Klucze złożone `(sandbox_id, id)` dla danych scenariusza; usuwanie kaskadowe po `sandbox_id`.

- [ ] Test: po `createTestDb()` wszystkie tabele istnieją (zapytanie do `information_schema.tables`).
- [ ] Test: usunięcie świata usuwa kaskadowo jego pojazdy.
- [ ] Implementacja schematu, `drizzle-kit generate`, klient, migrator; testy zielone; commit.

### Task 3: Zegar symulacji

**Files:** `src/simulation/clock.ts`, `src/simulation/clock.test.ts`

**Interfaces — Produces:**
- `type ClockState = { simOrigin: Date; simElapsedMs: number; running: boolean; speed: Speed; realResumedAt: Date }`, `type Speed = 1 | 10 | 60`.
- `simNow(state, realNow: Date): Date`
- `pauseClock(state, realNow): ClockState`, `resumeClock(state, realNow): ClockState`, `setSpeed(state, speed, realNow): ClockState`
- `simOriginFor(realNow: Date): Date` — 08:30 Europe/Warsaw w ostatni dzień roboczy ≤ `realNow` (w strefie Warszawy).

- [ ] Testy: tempo 10× (1 min realna = 10 min symulacji); pauza zamraża czas; wznowienie kontynuuje bez skoku; zmiana tempa 10→60 w trakcie jest ciągła; `simOriginFor` dla środy 14:00, soboty, niedzieli, poniedziałku 07:00 (→ poniedziałek 08:30 tego dnia, bo ≤ data), z poprawną obsługą czasu letniego/zimowego.
- [ ] Implementacja; testy zielone; commit.

### Task 4: Deterministyczna losowość

**Files:** `src/simulation/random.ts`, `src/simulation/random.test.ts`

**Interfaces — Produces:** `createRng(seed: number): Rng` z metodami `next(): number` (0–1), `int(min, max): number`, `pick<T>(items: readonly T[]): T`, `chance(p: number): boolean`; `seedFromString(s: string): number`.

- [ ] Testy: to samo ziarno → ta sama sekwencja; różne ziarna → różne; `int` w zakresie włącznie; `chance(0)` zawsze false, `chance(1)` zawsze true.
- [ ] Implementacja (mulberry32 + FNV-1a dla ciągów); commit.

### Task 5: Dane scenariusza

**Files:** `src/simulation/scenario/{points,clients,fleet,drivers,orders,history,index}.ts`, `src/simulation/scenario/scenario.test.ts`

**Interfaces — Produces:** `scenario: Scenario` z polami `points`, `clients`, `contacts`, `vehicles`, `trailers`, `couplings`, `drivers`, `driverActivities` (względem startu symulacji, w minutach), `orders` (aktywne na start, czasy względne), `history`. Identyfikatory tekstowe stałe (np. `pt-poznan-baza`).

- [ ] Testy spójności: 24 punkty (3 bazy: Poznań, Łódź, Wrocław), 8 klientów (3 kluczowi), 14 pojazdów (5 busów, w tym 2 międzynarodowe; 9 ciągników), 11 naczep (1 chłodnia, 1 ADR, 9 podpiętych), 14 kierowców (2 z ADR), wszystkie referencje istnieją, unikalne id i rejestracje, każdy pojazd ma kierowcę, 11 zleceń aktywnych na start i 3 pojazdy w bazach, kraje PL/DE/CZ.
- [ ] Implementacja danych; commit.

### Task 6: Trasy statyczne

**Files:** `scripts/precompute-routes.ts`, `src/simulation/route-geometry.ts`, `src/adapters/routing/static-routes.ts`, testy obok, `data/routes/*.json`, `data/routes/LICENSE`

**Interfaces — Produces:**
- `type StoredRoute = { key: string; from: string; to: string; distanceM: number; durationS: number; points: [lng: number, lat: number, cumDistM: number, cumDurS: number][] }`
- `downsampleRoute(coords, cumDist, cumDur, stepM): StoredRoute['points']` — zachowuje pierwszy i ostatni punkt.
- `routeKey(from, to): string` = `${from}__${to}`.
- `getRoute(from, to): StoredRoute` (rzuca błąd z kluczem, gdy brak), `listRouteKeys(): string[]`.
- Skrypt: dla wszystkich par punktów scenariusza pobiera trasę z serwera demo OSRM (`overview=full&annotations=distance,duration&geometries=geojson`), ≤ 1 zapytanie/s, nagłówek User-Agent z nazwą projektu, ponawia błędy, pomija istniejące pliki, zapisuje jeden plik na parę.

- [ ] Testy: downsampling (pierwszy/ostatni punkt, monotoniczność skumulowanych wartości, krok); loader na danych testowych; test pokrycia: każda para punktów scenariusza ma plik (pomijany z jasnym komunikatem, jeśli dane nie zostały jeszcze wygenerowane).
- [ ] Uruchomić skrypt (w tle), zatwierdzić dane z licencją; commit.

### Task 7: Światy demo

**Files:** `src/server/sandbox/{seed,repository,cookie}.ts`, testy obok

**Interfaces — Produces:**
- `createSandbox(db, { ipHash, realNow, seed? }): Promise<SandboxRow>` — zasiew scenariusza (czasy względne → bezwzględne od `simOriginFor`).
- `getOrCreateSandbox(db, { cookieValue, ipHash, realNow }): Promise<{ sandbox: SandboxRow; created: boolean }>` — nieznane lub uszkodzone ciasteczko → nowy świat; limit 20 nowych / IP / dobę → najstarszy świat tego IP po resecie; aktualizuje `last_seen_at`, `expires_at`.
- `resetSandbox(db, id, realNow): Promise<SandboxRow>` — usuwa dane świata i zasiewa ponownie z tym samym id.
- `cleanupExpired(db, realNow, limit = 5): Promise<number>`.
- `hashIp(ip: string): string` (SHA-256 z solą `SANDBOX_IP_SALT` lub stałą demo).
- Nazwa ciasteczka `tms_sandbox`; opcje `HttpOnly`, `SameSite=Lax`, `Secure` w produkcji, `Max-Age` = TTL.

- [ ] Testy: utworzenie zasiewa 14 pojazdów; drugie wywołanie z tym samym ciasteczkiem zwraca ten sam świat; uszkodzone ciasteczko → nowy świat; 21. świat z tego samego IP → reset najstarszego; reset przywraca stan; sprzątanie usuwa wygasłe (≤ limit).
- [ ] Implementacja; commit.

### Task 8: Silnik aktualizacji

**Files:** `src/server/tick/{engine,handlers,snapshot}.ts`, testy obok

**Interfaces — Produces:**
- `type EventHandler = (ctx: TickContext, event: ScheduledEventRow) => Promise<void>`; rejestr `registerHandler(type, handler)`; nieznany typ → zdarzenie oznaczone jako przetworzone z ostrzeżeniem w logu.
- `runTick(db, sandboxId, realNow, deps): Promise<TickResult>` — oblicza `simNow`, przetwarza ≤ 500 zdarzeń w kolejności `(due_sim, id)`, zapis z warunkiem wersji; `TickResult = { snapshot: Snapshot; processed: number; conflict: boolean; remaining: number }`.
- `TickContext` udostępnia `db` (transakcja), `sandbox`, `simNow`, `catchingUp: boolean` (true, gdy zdarzenie starsze niż 15 min symulacji od `simNow`), `ai`.
- `Snapshot` (etap 0): `{ sandboxId, simNow, speed, running, ai: { mode: 'live' | 'fallback'; reason?: string }, counts: { vehicles, activeOrders } }`.

- [ ] Testy: kolejność obsługi; limit 500 i `remaining`; ponowne wywołanie nie przetwarza zdarzeń drugi raz; konflikt wersji (symulowana równoległa aktualizacja) → `conflict: true` i brak zmian; flaga `catchingUp`.
- [ ] Implementacja; commit.

### Task 9: Warstwa AI

**Files:** `src/ai/{pricing,budget,log,run-structured,anthropic-client,diagnostics}.ts`, `src/ports/ai-assistant.ts`, testy obok

**Interfaces — Produces:**
- `runStructured<T>(opts: { fn: AiFunctionName; schema: ZodType<T>; system: string; content: ContentBlockParam[]; effort?: 'low' | 'medium'; maxTokens?: number; fallback: () => T; ctx: { db, sandboxId, simNow } }): Promise<{ value: T; source: 'ai' | 'fallback'; reason?: string }>`
- Kolejność: brak klucza → fallback (`reason: 'no_api_key'`); limit świata → fallback (`'sandbox_limit'`); budżet dzienny → fallback (`'daily_budget'`); wywołanie z limitem 10 s; błąd/odmowa (`stop_reason: 'refusal'`)/`parsed_output === null` → jedno ponowienie → fallback (`'ai_error'`). Każda ścieżka zapisuje wpis `ai_log` z kosztem.
- `costUsd(model, inputTokens, outputTokens): number` — Haiku 5.5: 0,10 / 0,50 USD za mln (prompt ≤ 100k), 0,50 / 2,50 powyżej.
- `aiStatus(db, sandboxId, now): Promise<{ mode, reason? }>`.
- `runDiagnostics(db, sandboxId, simNow): Promise<Diagnostics>` — klucz obecny?, `models.retrieve('claude-haiku-5-5')` → `image_input`, `structured_outputs`; próbne wywołanie strukturalne.
- Klient Anthropic wstrzykiwany (interfejs `AnthropicLike`) — w testach atrapa.

- [ ] Testy: każda ścieżka awaryjna z właściwym `reason` i wpisem w dzienniku; sukces liczy koszt; ponowienie po `parsed_output === null`; budżet sumuje się w `ai_budget_daily`.
- [ ] Implementacja; commit.

### Task 10: API i proxy

**Files:** `src/app/api/{tick,sandbox/reset,sandbox/clock,ai/log,ai/diagnostics}/route.ts`, `src/server/http.ts`, `src/proxy.ts`, testy handlerów

**Interfaces — Produces:**
- `POST /api/tick` → `Snapshot` (+ ustawia ciasteczko przy nowym świecie).
- `POST /api/sandbox/reset` → `Snapshot`.
- `POST /api/sandbox/clock` body `{ action: 'pause' | 'resume' | 'speed', speed?: 1 | 10 | 60 }` → `Snapshot`; walidacja Zod, 400 przy błędzie.
- `GET /api/ai/log?limit=50` → lista wpisów świata; `POST /api/ai/diagnostics` → `Diagnostics`.
- `withSandbox(request, fn)` — wspólna obsługa ciasteczka, IP (`x-forwarded-for`), sprzątania i odpowiedzi.
- `proxy.ts`: gdy ustawione `DEMO_PASSWORD`, wymaga ciasteczka `tms_auth` (strona `/login` z formularzem, `POST /api/login`).

- [ ] Testy handlerów (bez serwera, wywołanie funkcji z `NextRequest`): nowy świat ustawia ciasteczko; błędne `action` → 400; zmiana tempa odbija się w migawce.
- [ ] Implementacja; commit.

### Task 11: Powłoka interfejsu

**Files:** `src/app/layout.tsx`, `src/app/(panel)/*`, `src/components/{top-bar,nav,providers,sim-clock}.tsx`, `src/components/ui/*` (shadcn), `src/app/(panel)/dziennik-ai/page.tsx`, `e2e/shell.spec.ts`, `playwright.config.ts`

- [ ] shadcn/ui (button, badge, table, card, tooltip, separator).
- [ ] Górny pasek: zegar symulacji (płynne odliczanie między odpytaniami), tempo 1×/10×/60×, pauza/wznów, reset (z potwierdzeniem), znacznik AI.
- [ ] Menu: Monitoring, Zlecenia, Komunikator, Skrzynka, Dokumenty, Dziennik AI; strony etapów 1–3b jako „Wkrótce (etap N)”.
- [ ] Dziennik AI: tabela wpisów + przycisk „Sprawdź AI” (diagnostyka).
- [ ] TanStack Query: odpytywanie `/api/tick` co 15 s.
- [ ] E2E: otwarcie → zegar widoczny; pauza zatrzymuje zegar; reset przywraca godzinę startu; Dziennik AI pokazuje wpis po diagnostyce (tryb awaryjny bez klucza).
- [ ] Commit.

### Task 12: Dokumentacja etapu

**Files:** `README.md` (EN + PL), `.env.example`, `docs/raport/index.html` (sekcja etapu 0 z testami ręcznymi)

- [ ] README: opis, wymagania (Node 24), `npm install`, `npm run dev`, klucz API w `.env.local`, licencje (MIT, ODbL), fikcyjność danych.
- [ ] Raport: co działa, uproszczenia, lista testów ręcznych etapu 0.
- [ ] Pełny zestaw: `npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build`; commit.
