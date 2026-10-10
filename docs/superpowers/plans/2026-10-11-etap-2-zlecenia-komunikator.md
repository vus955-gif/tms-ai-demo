# Etap 2 — Zlecenia i komunikator: plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przydział zleceń przeciąganiem z „klockami” dopasowania, SMS ze zleceniem z szablonu, klasyfikacja odpowiedzi kierowców przez AI z eskalacją, komunikator z kierowcami i narzędzie demo „Telefon kierowcy”.

**Architecture:** Moduły domenowe (`domain/matching`, `domain/escalation`, `domain/sms-templates`, reguły awaryjne klasyfikacji) są czyste i testowane. Wiadomości to tabela `messages`; bramka `MessageGateway` w MVP tylko zapisuje do bazy. Odpowiedzi botów to zdarzenia harmonogramu. Klasyfikacja AI wiadomości przychodzącej działa po zatwierdzeniu transakcji (lub od razu w żądaniu API), a jej skutki (status, alert) idą przez `transitionOrder` i `raiseAlert`.

**Tech Stack:** jak etap 0–1 + `@dnd-kit/core`.

**Spec:** `docs/superpowers/specs/2026-10-10-tms-mvp-design.html` (§7.4, §7.5, §8, §9.2 `classifyDriverMessage`, `draftMessage`, §10.2–10.3, §11 Zlecenia/Komunikator/Telefon kierowcy, §15.2 etap 2).

> **Tryb realizacji:** jak w etapie 0 (noc, praca autonomiczna, TDD, „żywa lista”).

## Global Constraints

- Treść SMS-a ze zleceniem wyłącznie z szablonu (adresy, godziny, referencje 1:1), nigdy od AI.
- AI zmienia status tylko `WYSLANE → POTWIERDZONE` (pewność ≥ 0,8). Odmowa z pewnością ≥ 0,8: `WYSLANE → NOWE` (autor `system`) + alert; niższa pewność: tylko alert.
- Kategorie: `potwierdzenie | odmowa | warunek_pytanie | operacyjne | dokument | luzne | niejasne`; „ok, ale …” nigdy nie jest potwierdzeniem.
- Eskalacja: X = 20, Y = 20 min symulacji; gdy początek okna załadunku < 2 h — X = 10, Y = 10.
- Boty: odpowiedź po 2–15 min; brak odpowiedzi 0,15; odmowa = `refusal_propensity` (bus 0,5, ciągnik 0,1) dla zleceń od użytkownika; bot milknie, gdy użytkownik wciela się w tego kierowcę.
- Długość wiadomości kierowcy do 500 znaków (licznik + blokada).

## Review Focus

1. Odpowiedź „ok, ale będę 2 h później” — oczekiwanie: alert „warunek”, status bez zmian (test reguł awaryjnych i ścieżki AI z atrapą).
2. Odpowiedź kierowcy, który nie ma zlecenia do potwierdzenia — oczekiwanie: wiadomość w komunikatorze, bez zmian statusów.
3. Przeciągnięcie zlecenia na pojazd, który „odpada” — oczekiwanie: upuszczenie zablokowane, API zwraca 409 z powodem.
4. Cofnięcie przydziału po wysłaniu SMS-a — oczekiwanie: SMS o odwołaniu, zaplanowana eskalacja nic nie robi.
5. Dwa zlecenia w kolejce jednego kierowcy — oczekiwanie: pojazd jedzie po kolei, klocki liczą dojazd od końca kolejki.

---

### Task 1: Schemat — wiadomości i telefon demo
**Files:** `src/db/schema.ts`, `drizzle/0002_*.sql`
- [ ] Tabela `messages` (spec §6) + kolumna `sandboxes.phone_driver_id`.
- [ ] Migracja; testy schematu zielone; commit.

### Task 2: Szablony SMS i numeracja zleceń
**Files:** `src/domain/sms-templates.ts` (+ test), `src/server/orders/numbering.ts`
**Produces:** `orderSms(order, pickup, delivery, client): string`, `cancellationSms`, `reminderSms`, `nextOrderNumber(db, sandboxId)`.
- [ ] Test: SMS zawiera numer, okna w czasie warszawskim, adresy, wymagania i notatki punktów, ładunek, referencje i prośbę „Potwierdź odpisując OK”.

### Task 3: Dopasowanie kierowcy („klocki”)
**Files:** `src/domain/matching.ts` (+ test), `src/server/orders/matching.ts`
**Produces:** `matchCandidates(order, candidates, deps): MatchResult[]` z `tier: 'high'|'medium'|'low'|'excluded'`, `reasons: string[]`, `score`, `pickupEta`.
- [ ] Testy: za mała pojemność/ładowność → `excluded` z powodem; brak ADR; chłodnia wymagana; nie zdąży na okno → `excluded`; bliżej + zna klienta → wyżej; chłodnia na suchy towar → powód informacyjny.

### Task 4: Przydział, cofnięcie, ręczne potwierdzenie, nowe zlecenie
**Files:** `src/server/orders/assign.ts`, `src/server/orders/create.ts`, API `/api/orders`, `/api/orders/[id]/assign|unassign|confirm|cancel`, `/api/orders/[id]/matching`, testy
- [ ] Przydział: walidacja dopasowania, `NOWE→PRZYPISANE→WYSLANE`, SMS z szablonu, eskalacja i odpowiedź bota w harmonogramie.
- [ ] Cofnięcie: SMS o odwołaniu, `→NOWE`. Anulowanie wg tabeli. Ręczne potwierdzenie spedytora.
- [ ] Nowe zlecenie: walidacja Zod (klient, punkty klienta, okna, ładunek).

### Task 5: Klasyfikacja wiadomości kierowcy i skutki
**Files:** `src/ai/functions/classify-driver-message.ts` (+ reguły awaryjne + testy), `src/server/messages/inbound.ts`
- [ ] Reguły awaryjne: słowa kluczowe dla potwierdzenia, odmowy, pytań/warunków, operacyjnych, dokumentów, luźnych.
- [ ] Skutki: potwierdzenie → `POTWIERDZONE` (ai) + alert info; odmowa → `NOWE` + alert warning; warunek/pytanie/niejasne → alert warning; operacyjne → alert, gdy brak alertu incydentu; luźne → nic.
- [ ] Gotowe odpowiedzi (≤ 3) zapisane przy wiadomości.

### Task 6: Eskalacja i boty kierowców
**Files:** `src/domain/escalation.ts` (+ test), `src/server/messages/escalation.ts`, `src/simulation/bots/driver-replies.ts` (+ test), zdarzenia scenariusza
- [ ] `escalationDelays(sentAt, pickupFrom)`; zdarzenia `escalation.reminder`, `escalation.alert`.
- [ ] Bot: wybór odpowiedzi deterministycznym generatorem; milczy przy `phone_driver_id`.
- [ ] Scenariusz: T+35 nowe zlecenie ZL-1042 (Hanza), T+40 ZL-1043 (Wisła, docelowo z maila w 3b), T+50 przydział ZL-1042 kierowcy busa (odmowa po 6 min), T+60 luźna wiadomość Wójcika, wiadomości przy awarii i kontroli.

### Task 7: API komunikatora i telefonu
**Files:** `/api/messages` (GET wątki, GET wątek, POST odpowiedź spedytora, POST przeczytane), `/api/phone` (POST wybór kierowcy, POST wysłanie jako kierowca)

### Task 8: Interfejs — Zlecenia
**Files:** `src/components/orders/*`, `src/app/(panel)/zlecenia/page.tsx`, e2e
- [ ] Kolumna „Nowe zlecenia”, wiersze kierowców (bieżące + kolejka / puste pole), przeciąganie z klockami, formularz nowego zlecenia, akcje na kartach.

### Task 9: Interfejs — Komunikator i Telefon kierowcy
**Files:** `src/components/messenger/*`, `src/components/phone/*`, `src/app/(panel)/komunikator/page.tsx`, e2e
- [ ] Wątki z licznikami i priorytetem, rozmowa, gotowe odpowiedzi, panel zlecenia kierowcy; wysuwany Telefon kierowcy.

### Task 10: Raport i pełny zestaw testów
- [ ] Sekcja etapu 2 w `docs/raport/index.html`; `lint`, `typecheck`, `test`, `test:e2e`, `build` (przy zatrzymanym serwerze dev); commit.
