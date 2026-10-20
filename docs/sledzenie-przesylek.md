# Śledzenie przesyłek morskich, lotniczych i kolejowych

Jak demo śledzi przesyłki, czego **świadomie nie wdrożono** i jak podłączyć prawdziwych dostawców danych.

> **Krótko:** pozycja na żywo (AIS statków, trackery lotów, GPS kontenerów) nie jest podłączona w demo, bo każda sensowna usługa jest płatna, a demo utrzymuję z własnych środków. Moduł opiera się na tym, co w spedycji i tak jest podstawą: na **statusach od agentów**, o które system prosi automatycznie.

## Jak działa w demo

1. **Plan etapów.** Każda przesyłka dostaje plan: booking, przyjęcie w terminalu, wyjazd, przeładunek lub granica, przybycie, odprawa, dostawa. Terminy wynikają z ETD i ETA.
2. **Automatyczne prośby o status.** System sam pisze do agenta w stałym rytmie: lotnicze co 12 h, kolejowe co 24 h, morskie co 48 h. Rytm można zmienić dla każdej przesyłki. System pisze wcześniej, gdy planowany etap minie bez wieści. Jeśli agent milczy, wysyła przypomnienie. Gdy agent nie odpowie także na przypomnienie, spedytor dostaje alert „agent nie odpowiada”.
3. **Odczyt odpowiedzi.** AI (Claude Haiku 5.5) czyta mail agenta po polsku lub angielsku i wyciąga z niego:
   - zdarzenia z datami,
   - aktualne ETA,
   - przyczynę opóźnienia.

   Bez AI działają reguły awaryjne. Etapu potwierdzonego przez spedytora (np. po telefonie) odczyt z maila nie nadpisuje.
4. **Zmiana ETA.** Przesunięcie o co najmniej 12 h daje jeden alert i przyspiesza najbliższy status dla klienta.
5. **Statusy dla klienta.** System przypomina 2 h przed terminem i ostrzega po terminie. Spedytor klika „Przygotuj status”, a AI pisze szkic wyłącznie z potwierdzonych faktów. Można też włączyć wysyłkę automatyczną dla przesyłki. Strażnik blokuje w wiadomości do klienta nazwę i dane agenta oraz kwoty. W drugą stronę działa tak samo: zapytania do agentów nie zawierają danych klienta.
6. **Mapa.** Pokazuje orientacyjną trasę (linia przerywana) i ostatnie miejsce potwierdzone przez agenta lub spedytora. Nie pokazuje pozycji na żywo.

W demo agenci to boty: znają „prawdziwy” przebieg przesyłki (np. 52 h kongestii w Rotterdamie) i odpisują tak, jak piszą ludzie. System dowiaduje się o opóźnieniu wyłącznie z ich maili. Demo nie wysyła prawdziwych maili.

## Dlaczego bez pozycji na żywo

Rozpoznanie dostawców z 20.10.2026. **Ceny i warunki się zmieniają — sprawdź je przed wdrożeniem.**

| Gałąź | Dostawca / źródło | Co oferuje | Bariera dla demo |
| --- | --- | --- | --- |
| Lotnicza | Flightradar24 API | Pozycje i dane lotów | Brak darmowego planu (klucz sandbox tylko do testów); najtańszy plan „Explorer” ok. 9 USD/mies.; użycie komercyjne dozwolone |
| Lotnicza | OpenSky Network | Pozycje ADS-B | Użycie w produkcie na żywo wymaga pisemnej licencji; od 18.03.2026 logowanie OAuth2 |
| Lotnicza | AviationStack, AirLabs, AeroDataBox, FlightAware AeroAPI | Statusy i pozycje lotów | Darmowe progi tylko do użytku niekomercyjnego |
| Morska | aisstream.io | Strumień AIS | Tylko WebSocket — wymaga stale działającego procesu, którego nie ma na serverless |
| Morska | VesselFinder API | Pozycje statków | ok. 330 EUR za 10 tys. kredytów |
| Morska | Datalastic | Pozycje statków | od ok. 199 EUR/mies. |
| Morska (kontenery) | API armatorów w standardzie DCSA Track & Trace | Zdarzenia kontenera (załadunek, wyładunek, ETA) | Dostęp zwykle dla klientów danego armatora |
| Morska (kontenery) | Agregatory, np. ShipsGo | Śledzenie kontenera u wielu armatorów | ok. 2 USD za przesyłkę |
| Kolejowa | Portale operatorów, np. DB Cargo link2rail | Statusy pociągów i wagonów | Tylko dla klientów operatora; publicznego śledzenia na żywo nie ma |
| Kolejowa | Trackery GPS na kontenerze | Pozycja kontenera | Płatna usługa dodatkowa, często nie zamawiana |

Do tego dochodzi hosting. Plan Vercel Hobby, na którym działa demo, pozwala na zadania cron raz na dobę, funkcje do 300 s i tylko użytek niekomercyjny. Regularne odpytywanie dostawców wymagałoby planu płatnego albo osobnego workera.

Ważne zastrzeżenie domenowe: pozycja samolotu czy statku to nie zawsze pozycja ładunku. Ładunek może zostać zdjęty z lotu albo przerzucony na inny statek. Dlatego nawet z płatnymi danymi status od agenta lub przewoźnika (AWB, B/L, zdarzenia kontenera) pozostaje źródłem, które się potwierdza.

## Jak podłączyć dostawców

Kod jest przygotowany tak, żeby dostawca uzupełniał statusy od agentów, a nie je zastępował.

### 1. Identyfikatory

Przesyłka ma pole `refs` (`src/db/schema.ts`, tabela `shipments`), z którego dostawca bierze identyfikatory:

| Gałąź | Identyfikator | Pole w `refs` |
| --- | --- | --- |
| Lotnicza | numer lotu i data | `flight` |
| Lotnicza | numer AWB (status ładunku u przewoźnika) | `awb` |
| Morska | numer kontenera i B/L u armatora | `container`, `bl` |
| Morska | statek / rejs; pozycję statku wiąże się przez IMO/MMSI, którego demo jeszcze nie przechowuje | `vessel` |
| Kolejowa | numer kontenera albo identyfikator trackera GPS | `container` |

### 2. Adapter

Dodaj adapter obok istniejących (`src/adapters/`), np.:

```ts
export interface TrackingProvider {
  /** Ostatnia znana pozycja (jeśli dostawca ją podaje). */
  position(shipment: ShipmentRow): Promise<{ lng: number; lat: number; at: Date; source: string } | null>;
  /** Zdarzenia przewoźnika: wyjazd, przeładunek, przybycie… z datami. */
  events(shipment: ShipmentRow): Promise<{ kind: MilestoneKind; at: Date }[]>;
}
```

### 3. Odpytywanie

Odpytuj w fazie ticka `shipments` (`src/server/shipments/handlers.ts`) albo w osobnym zadaniu cyklicznym. Sensowne rytmy:

- samolot w powietrzu: co 15–60 min,
- statek: co kilka godzin.

Tam, gdzie dostawca ma webhooki (część API armatorów i agregatorów), lepiej przyjmować zdarzenia, niż odpytywać.

### 4. Zapis

Zdarzenia zapisuj jak odczyt z maila agenta: `shipment_milestones` ze źródłem np. `carrier_api` (nowa wartość). Pozycję zapisz w nowej tabeli (ostatni punkt + czas + źródło). Obowiązuje ta sama zasada co dziś: potwierdzenia spedytora nie są nadpisywane.

### 5. Mapa

`src/components/shipments/shipment-map.tsx` dostaje dziś trasę i ostatni potwierdzony punkt. Pozycja na żywo to jeden dodatkowy znacznik z czasem i źródłem („AIS, 12 min temu”).

### 6. Klucze i koszty

- Klucze API trzymaj wyłącznie w zmiennych środowiskowych (lokalnie `.env.local`, na Vercel jako Secret), nigdy w repozytorium.
- Odpowiedzi buforuj.
- Pilnuj limitów: przy rozliczeniu „za kredyt” lub „za przesyłkę” koszt rośnie z liczbą przesyłek i częstotliwością odpytywania. Dlatego rytm warto uzależnić od etapu (częściej przy przybyciu, rzadko w środku rejsu).

## Pliki modułu

- Logika czysta: `src/domain/shipments.ts` (plan etapów, rytm zapytań, terminy statusów), `src/domain/shipment-texts.ts` (teksty, odczyt regułami, strażnik danych agenta).
- AI: `src/ai/functions/shipments.ts` (odczyt maila agenta, szkic statusu dla klienta).
- Serwer: `src/server/shipments/` (tworzenie, akcje, harmonogram, odczyt odpowiedzi, dane demo).
- Interfejs: `src/components/shipments/`, strona `/przesylki`.
- Trasy orientacyjne i miejsca: `src/simulation/scenario/shipment-places.ts`.
