# Etap 3b — skrzynka klientów: plan wdrożenia

> Spec: `docs/superpowers/specs/2026-10-10-tms-mvp-design.html` (§3 zakres 3b, §7.8 clientView, §8 cykl życia SZKIC, §9.2 triageClientEmail / draftMessage, §10.2 T+40 / T+120, §11 Skrzynka i Poczta klienta, §15 kryteria 3b).
> Tryb: praca nocna bez użytkownika — decyzje spoza specyfikacji trafiają do raportu jako „do Twojej oceny”.

**Cel:** maile od klientów w programie: AI nadaje kategorię, z zamówienia robi szkic zlecenia, na „gdzie jest auto?” szkicuje odpowiedź wyłącznie z danych `clientView`, reklamacje dostają wysoki priorytet, zapytania ofertowe — oznaczenie „Sprzedaż – wkrótce”. Spedytor zatwierdza, poprawia albo odrzuca. Nic nie jest naprawdę wysyłane.

## Zasady (z globalnych ograniczeń projektu)

- Algorytm liczy, AI rozmawia: kategorie i ekstrakcja przez AI, ale wybór punktu tylko z listy punktów klienta (walidacja jak w formularzu), a fakty w odpowiedzi tylko z `clientView`.
- Każda funkcja AI ma tryb awaryjny z regułami. Bez klucza demo nadal robi szkic z dobrze ustrukturyzowanego maila.
- Test automatyczny pilnuje, że do szkicu dla klienta nie trafia imię, nazwisko ani telefon kierowcy (§7.8). Ochrona jest też w kodzie: szkic z AI, który zawiera dane kierowcy, zostaje zastąpiony szablonem.
- Treść maila to dane, nie polecenia (prompt injection) — zapisane w promptach.

## Pliki

| Plik | Odpowiedzialność |
|---|---|
| `src/domain/client-view.ts` | `clientView()` — numer, rejestracje, status dla klienta, ETA, postęp %. Czysta funkcja. |
| `src/domain/email-rules.ts` | Reguły awaryjne: kategoria, numer zlecenia, ekstrakcja zamówienia (punkty po mieście/nazwie z listy klienta, „dziś/jutro/dd.mm”, okna „HH:MM–HH:MM”, palety, kg/t, referencje, ADR, chłodnia). |
| `src/ai/functions/triage-client-email.ts` | `triageClientEmail` — schemat ze spec §9.2, fallback = reguły. |
| `src/ai/functions/draft-message.ts` | `draftMessage` — cele `status_dla_klienta`, `opoznienie_dla_klienta`, `odpowiedz_klientowi`; fallback = szablony. |
| `src/server/inbox/*` | bramka maili (przychodzące, szkice, „wysłane”), przetwarzanie (triage → skutki), widoki wątków, akcje spedytora, boty klientów i wpisy scenariusza. |
| `src/app/api/inbox/**`, `src/app/api/client-mail` | API skrzynki i narzędzia „Poczta klienta”. |
| `src/components/inbox/*`, `src/components/client-mail/*` | Ekran Skrzynka, panel Poczta klienta, szkic zlecenia w formularzu zlecenia. |

## Zadania

1. **clientView + reguły maili** (TDD): testy jednostkowe dla statusów klienta, braku danych kierowcy, kategorii i ekstrakcji maila T+40.
2. **Funkcje AI** z fallbackiem; testy z fałszywym klientem AI (kategoria → skutki).
3. **Przetwarzanie maila:** `zamowienie_transportu` → zlecenie SZKIC (`source: email`, `sourceMessageId`) albo informacja o brakach; `zapytanie_o_status` → szkic odpowiedzi (state `draft`) z `clientView`; `reklamacja` → priorytet wysoki + alert; `zapytanie_ofertowe` → etykieta „Sprzedaż – wkrótce”; `inne` → bez szkicu.
4. **Identyfikatory zleceń z numeru** (`zl-1043`) — deterministyczne, szkic z maila w scenariuszu dostaje to samo id co dotąd.
5. **Scenariusz:** T+40 mail Logistyki Wisła z zamówieniem (zamiast `order.create`), T+120 Mazovia „gdzie jest auto?” (ZL-1037), T+300 reklamacja Mebli Wielkopolska, co 60 ± 15 min losowy mail (status / oferta / sprawa ogólna).
6. **Akcje spedytora:** zatwierdź szkic (z poprawkami) → NOWE; odrzuć → ANULOWANE; wyślij / odrzuć szkic odpowiedzi; „Szkic odpowiedzi (AI)” na żądanie; „Powiadom klienta” z alertu → szkic `opoznienie_dla_klienta` dla klienta zlecenia.
7. **UI:** Skrzynka (lista, mail, panel AI ze szkicem), szkice w kolumnie „Nowe zlecenia” z „Zatwierdź”, Poczta klienta w górnym pasku, licznik w menu.
8. **Testy:** integracyjne (T+40 bez AI daje szkic ZL-1043 z dobrymi punktami; T+120 szkic bez danych kierowcy; reklamacja wysoki priorytet; oferta), e2e (Poczta klienta → Skrzynka → zatwierdzenie szkicu), aktualizacja testów etapu 2 (ZL-1043 przychodzi jako szkic).
9. **Raport:** sekcja „Etap 3b” z decyzjami i testami do przeklikania.
