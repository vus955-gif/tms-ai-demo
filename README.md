# TMS z AI — demo

**PL** · Demo prostego systemu zarządzania transportem drogowym (TMS) z monitoringiem floty, komunikacją z kierowcami i klientami oraz AI (Claude Haiku 5.5), które wspiera spedytora. Decyzje zawsze podejmuje człowiek. Wszystkie dane są fikcyjne.

**EN** · Demo of a simple road-transport management system (TMS) with fleet monitoring, driver and customer messaging, and AI (Claude Haiku 5.5) assisting the dispatcher. A human always makes the decisions. All data is fictional.

---

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
