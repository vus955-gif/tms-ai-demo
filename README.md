# TMS z AI — demo

**PL** · Demo prostego systemu zarządzania transportem drogowym (TMS) z monitoringiem floty, komunikacją z kierowcami i klientami oraz AI (Claude Haiku 5.5), które wspiera spedytora. Decyzje zawsze podejmuje człowiek. Wszystkie dane są fikcyjne.

**EN** · Demo of a simple road-transport management system (TMS) with fleet monitoring, driver and customer messaging, and AI (Claude Haiku 5.5) assisting the dispatcher. A human always makes the decisions. All data is fictional.

---

## Co jest w demo / What's inside

- **Monitoring** — mapa floty (14 pojazdów), czas pracy kierowców według 561/2006, ETA, alerty, objazdy.
- **Zlecenia** — „klocki” (dopasowanie kierowcy z powodami), przydział, SMS do kierowcy, komunikator.
- **Dokumenty CMR** — zdjęcie z telefonu kierowcy, odczyt AI, dopasowanie do zlecenia, kolejki.
- **Skrzynka klientów** — kategorie maili, szkice zleceń i odpowiedzi.
- **Sprzedaż** — wyceny drogowe ze stawek i przez agentów (morskie, lotnicze, kolejowe), rola Handlowiec.
- **Panel klienta** — link śledzenia jednego transportu, bez danych kierowcy.
- **Flota i terminarz** — terminy pojazdów, naczep i kierowców, nieobecności; blokują przydział.
- **Zlecenia stałe** — szablony i paczka na tydzień z prognozą terminowości.

## Uruchomienie lokalne / Running locally

Wymagania / Requirements: **Node.js 24+**. Docker nie jest potrzebny / Docker is not needed.

```bash
npm install
npm run dev
```

Otwórz / open <http://localhost:3000>.

Lokalnie aplikacja używa wbudowanej bazy Postgres (PGlite) w katalogu `.pglite/` — nic nie trzeba instalować.
Locally the app uses an embedded Postgres (PGlite) in `.pglite/` — nothing to install.

### Klucz API (opcjonalnie) / API key (optional)

Skopiuj `.env.example` do `.env.local` i wpisz klucz:
Copy `.env.example` to `.env.local` and set your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Bez klucza AI działa w **trybie awaryjnym** (proste reguły) — demo nadal działa.
Without a key the AI runs in **fallback mode** (simple rules) — the demo still works.

Limity chroniące koszty / cost guards: `AI_DAILY_BUDGET_USD` (domyślnie 2), `AI_CALLS_PER_SANDBOX_PER_HOUR` (60).

## Testy / Tests

```bash
npm test          # Vitest: logika, baza (PGlite), API
npm run test:e2e  # Playwright: przepływy w przeglądarce
npm run lint && npm run typecheck
```

## Wdrożenie na Vercel / Deploying to Vercel

1. Zaimportuj repozytorium w Vercel (Add New → Project). Next.js jest wykrywany automatycznie.
   Import the repository in Vercel (Add New → Project). Next.js is detected automatically.
2. Podłącz bazę: zakładka **Storage → Create Database → Neon**, połącz z projektem — integracja ustawia `DATABASE_URL`.
   Connect a database: **Storage → Create Database → Neon**, link it to the project — the integration sets `DATABASE_URL`.
3. Ustaw zmienne / set environment variables (Settings → Environment Variables):

   | Zmienna / variable | Wartość / value |
   |---|---|
   | `ANTHROPIC_API_KEY` | klucz z / key from console.anthropic.com (bez niego tryb awaryjny / fallback mode without it) |
   | `APP_URL` | `https://<projekt>.vercel.app` — adres w linkach śledzenia / address used in tracking links |
   | `SANDBOX_IP_SALT` | długi losowy ciąg / long random string |
   | `AI_DAILY_BUDGET_USD` | dzienny limit kosztu AI całego demo / daily AI cost cap for the whole demo (domyślnie / default 2) |
   | `DEMO_PASSWORD` | opcjonalne hasło do demo / optional demo password |

4. Deploy. Polecenie budowania z `vercel.json` (`npm run db:migrate && npm run build`) samo tworzy i aktualizuje tabele w Neon.
   Deploy. The build command in `vercel.json` (`npm run db:migrate && npm run build`) creates and updates the Neon tables.

Bez `DATABASE_URL` aplikacja na Vercelu zatrzyma się z czytelnym błędem (system plików jest tam tylko do odczytu).
Without `DATABASE_URL` the app on Vercel stops with a clear error (the file system there is read-only).

## Jak to działa / How it works

- **Światy demo / demo worlds:** każdy odwiedzający dostaje własny świat (ciasteczko), z resetem i wygasaniem po 24 h.
- **Czas symulacji / simulation time:** liczony z zegara (tempo 1× / 10× / 60×, pauza); pozycje i zdarzenia wynikają z czasu, więc demo działa także na serwerless (Vercel).
- **AI:** „algorytm liczy, AI rozmawia” — czas jazdy, ETA i dopasowanie liczy kod; AI czyta wiadomości i dokumenty, wyjaśnia i szkicuje. Każde wywołanie trafia do Dziennika AI.

Dokumentacja projektowa / design docs: `docs/superpowers/specs/`, plany / plans: `docs/superpowers/plans/`.

## Licencje / Licenses

- Kod / code: **MIT** (zob. / see `LICENSE`).
- Trasy w `data/routes/` / routes in `data/routes/`: dane © OpenStreetMap contributors, **ODbL**; trasy policzone przez OSRM (zob. / see `data/routes/LICENSE`).
- Kafelki mapy / map tiles: OpenFreeMap, © OpenMapTiles, dane © OpenStreetMap contributors.

Firmy, osoby, numery telefonów i rejestracyjne są zmyślone. Demo nie wysyła prawdziwych SMS-ów ani maili.
Companies, people, phone and plate numbers are made up. The demo never sends real SMS or e-mail.
