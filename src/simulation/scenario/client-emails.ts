/**
 * Scripted and bot e-mails from clients (spec §10.2). All companies and people
 * are fictional; `.example` addresses never resolve.
 */

export type ScriptedEmail = { contactId: string; subject: string; body: string };

/** T+40: Logistyka Wisła orders the transport that becomes ZL-1043. */
export const ORDER_EMAIL_WISLA: ScriptedEmail = {
  contactId: "ct-wisla-1",
  subject: "Zlecenie transportu Gądki → Leipzig na jutro",
  body: `Dzień dobry,

prosimy o transport na jutro.
Załadunek: nasz magazyn Gądki, jutro 07:00–09:00.
Rozładunek: Leipzig GVZ, jutro 13:00–15:00.
12 palet EUR, 4800 kg, towar neutralny. Nr ref.: LW-5501.

Proszę o potwierdzenie przyjęcia zlecenia.

Pozdrawiam
Marta Sobczak
Logistyka Wisła Sp. z o.o.`,
};

/** T+120: Mazovia asks where the truck with ZL-1037 is. */
export const STATUS_EMAIL_MAZOVIA: ScriptedEmail = {
  contactId: "ct-mazovia-1",
  subject: "Gdzie jest auto z naszym towarem?",
  body: `Dzień dobry,

odbiorca w Pradze dopytuje o dostawę zamówienia ME-PO-33190. Gdzie jest teraz auto i o której będzie na miejscu?

Robert Pawlak
Mazovia Electronics`,
};

/** T+300: Meble Wielkopolska files a complaint about an earlier delivery. */
export const COMPLAINT_EMAIL_MEBLE: ScriptedEmail = {
  contactId: "ct-meble-2",
  subject: "Reklamacja — uszkodzone meble w dostawie MW-2209",
  body: `Dzień dobry,

zgłaszamy reklamację dostawy z 07.10 do salonu w Berlinie (ref. MW-2209). Przy rozładunku stwierdzono uszkodzone 3 sofy — rozdarta folia i pęknięte nogi. Odbiorca wpisał uwagi na CMR, zdjęcia w załączeniu u nas.

Prosimy o pilny kontakt i informację o dalszym postępowaniu.

Joanna Duda
Dział reklamacji, Meble Wielkopolska`,
};

/**
 * Rotating pool for the periodic client bot (every 60 ± 15 simulated minutes).
 * `{order}` / `{ref}` are filled with one of the client's active orders when it has one.
 */
export type BotEmail = ScriptedEmail & { needsOrder?: boolean };

export const BOT_EMAILS: BotEmail[] = [
  {
    contactId: "ct-agropol-1",
    subject: "Transport paszy Kutno → Gdynia",
    body: `Dzień dobry,
zlecamy transport na jutro.
Załadunek: Kutno, jutro 08:00–10:00.
Rozładunek: Gdynia, port, jutro 15:00–18:00.
20 palet, 9600 kg, pasza w workach. Ref.: AP-7781.
Halina Wróbel, Agro-Pol`,
  },
  {
    contactId: "ct-sudety-1",
    subject: "Wycena — kontener do Chin",
    body: `Dzień dobry,
prosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t, gotowe do wysyłki od 25.10.
Leszek Michalak, Sudety Papier`,
  },
  {
    contactId: "ct-baltic-2",
    subject: "Kiedy dojedzie nasza dostawa?",
    needsOrder: true,
    body: `Dzień dobry,
magazyn pyta o godzinę przyjazdu auta ze zleceniem {ref}. Czy wszystko idzie zgodnie z planem?
Natalia Jasińska, Baltic Foods`,
  },
  {
    contactId: "ct-odra-1",
    subject: "Korekta faktury 118/10/2026",
    body: `Dzień dobry,
na fakturze 118/10/2026 jest błędny numer zamówienia. Prosimy o korektę na PO-ODR-5521.
Beata Sikora, Odra Chem`,
  },
  {
    contactId: "ct-hanza-1",
    subject: "Zapytanie o stawkę: transport lotniczy próbek",
    body: `Dzień dobry,
ile kosztowałby transport lotniczy 2 palet próbek (180 kg) z Poznania do Toronto? Termin elastyczny.
Olga Zawadzka, Hanza Retail`,
  },
  {
    contactId: "ct-wisla-2",
    subject: "Status zlecenia",
    needsOrder: true,
    body: `Dzień dobry,
proszę o informację, na jakim etapie jest zlecenie {ref}.
Tomasz Kubiak, Logistyka Wisła`,
  },
];
