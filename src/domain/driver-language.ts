/**
 * Languages a driver can read ("Tłumacz dla kierowców"). System SMS and the driver's order page use
 * ready-made translations kept here — fixed texts checked once, never written by AI on the fly.
 * Free-text chat is translated by AI in both directions (see translate-for-driver.ts).
 *
 * The Ukrainian and Russian texts were written with the product, not by a sworn translator:
 * have a native speaker read them before using them with real drivers.
 */

export const DRIVER_LANGUAGES = ["pl", "uk", "ru"] as const;
export type DriverLanguage = (typeof DRIVER_LANGUAGES)[number];
export type ForeignLanguage = Exclude<DriverLanguage, "pl">;

export const LANGUAGE_LABEL: Record<DriverLanguage, string> = { pl: "polski", uk: "ukraiński", ru: "rosyjski" };
/** "po ukraińsku", for sentences like "kierowca czyta po ukraińsku". */
export const LANGUAGE_ADVERB: Record<DriverLanguage, string> = { pl: "po polsku", uk: "po ukraińsku", ru: "po rosyjsku" };

export function isDriverLanguage(value: unknown): value is DriverLanguage {
  return typeof value === "string" && (DRIVER_LANGUAGES as readonly string[]).includes(value);
}

/** Fixed pieces of the system SMS. Order data (addresses, names, references, notes) is never translated. */
export const SMS_TEXT: Record<
  DriverLanguage,
  {
    order: string;
    pickup: string;
    delivery: string;
    remarks: string;
    cargo: string;
    pallets: string;
    kg: string;
    reefer: string;
    orderNotes: string;
    link: string;
    confirm: string;
    reminder: (number: string, when: string) => string;
    cancellation: (number: string) => string;
    cmrResend: string;
    cmrMissing: (number: string) => string;
  }
> = {
  pl: {
    order: "ZLECENIE",
    pickup: "ZAŁADUNEK",
    delivery: "ROZŁADUNEK",
    remarks: "Uwagi",
    cargo: "Ładunek",
    pallets: "palet",
    kg: "kg",
    reefer: "chłodnia",
    orderNotes: "Uwagi do zlecenia",
    link: "Szczegóły i potwierdzenie jednym kliknięciem",
    confirm: "Potwierdź odpisując OK.",
    reminder: (number, when) => `Przypomnienie: potwierdź zlecenie ${number} (załadunek ${when}). Odpisz OK albo zadzwoń do spedycji.`,
    cancellation: (number) => `Zlecenie ${number} zostało odwołane. Nie jedź na załadunek. W razie pytań zadzwoń do spedycji.`,
    cmrResend: "Zdjęcie CMR jest nieczytelne. Zrób wyraźne zdjęcie całego dokumentu (ostre, bez cienia, z polem 24) i wyślij jeszcze raz.",
    cmrMissing: (number) => `Brakuje zdjęcia CMR dla zlecenia ${number}. Wyślij je MMS-em albo mailem, póki dokument masz pod ręką.`,
  },
  uk: {
    order: "ЗАМОВЛЕННЯ",
    pickup: "ЗАВАНТАЖЕННЯ",
    delivery: "РОЗВАНТАЖЕННЯ",
    remarks: "Примітки (польською)",
    cargo: "Вантаж",
    pallets: "палет",
    kg: "кг",
    reefer: "рефрижератор",
    orderNotes: "Примітки до замовлення (польською)",
    link: "Деталі та підтвердження одним натисканням",
    confirm: "Підтвердіть, відповівши OK.",
    reminder: (number, when) => `Нагадування: підтвердіть замовлення ${number} (завантаження ${when}). Відповідайте OK або зателефонуйте диспетчеру.`,
    cancellation: (number) => `Замовлення ${number} скасовано. Не їдьте на завантаження. Якщо є питання, зателефонуйте диспетчеру.`,
    cmrResend: "Фото CMR нечитабельне. Зробіть чітке фото всього документа (різке, без тіні, з полем 24) і надішліть ще раз.",
    cmrMissing: (number) => `Немає фото CMR для замовлення ${number}. Надішліть його MMS або електронною поштою, поки документ у вас під рукою.`,
  },
  ru: {
    order: "ЗАКАЗ",
    pickup: "ЗАГРУЗКА",
    delivery: "ВЫГРУЗКА",
    remarks: "Примечания (по-польски)",
    cargo: "Груз",
    pallets: "паллет",
    kg: "кг",
    reefer: "рефрижератор",
    orderNotes: "Примечания к заказу (по-польски)",
    link: "Детали и подтверждение одним нажатием",
    confirm: "Подтвердите, ответив OK.",
    reminder: (number, when) => `Напоминание: подтвердите заказ ${number} (загрузка ${when}). Ответьте OK или позвоните диспетчеру.`,
    cancellation: (number) => `Заказ ${number} отменён. Не выезжайте на загрузку. Если есть вопросы, позвоните диспетчеру.`,
    cmrResend: "Фото CMR нечитаемо. Сделайте чёткое фото всего документа (резкое, без тени, с полем 24) и отправьте ещё раз.",
    cmrMissing: (number) => `Нет фото CMR по заказу ${number}. Отправьте его MMS или по электронной почте, пока документ у вас под рукой.`,
  },
};

/** Texts of the driver's order page (link from the order SMS). */
export const PAGE_TEXT: Record<
  DriverLanguage,
  {
    subtitle: string;
    loading: string;
    state: Record<"do_potwierdzenia" | "potwierdzone" | "zaladunek" | "w_drodze" | "rozladunek" | "zakonczone" | "odwolane", string>;
    pickup: string;
    delivery: string;
    cargo: string;
    navigate: string;
    confirm: string;
    confirming: string;
    refuse: string;
    refuseTitle: string;
    refuseSend: string;
    sending: string;
    back: string;
    reasons: Record<string, string>;
    cmrTitle: string;
    cmrReceived: string;
    cmrRetake: string;
    cmrHint: string;
    cmrButton: string;
    cmrSending: string;
    sampleHint: string;
    call: string;
    demoNote: string;
    inPolish: string;
  }
> = {
  pl: {
    subtitle: "Zlecenie dla kierowcy",
    loading: "Wczytywanie zlecenia…",
    state: {
      do_potwierdzenia: "Czeka na Twoje potwierdzenie",
      potwierdzone: "Potwierdzone. Jedź na załadunek.",
      zaladunek: "Załadunek",
      w_drodze: "W drodze na rozładunek",
      rozladunek: "Rozładunek",
      zakonczone: "Zlecenie zakończone. Dziękujemy.",
      odwolane: "Zlecenie odwołane. Nie jedź na załadunek.",
    },
    pickup: "Załadunek",
    delivery: "Rozładunek",
    cargo: "Ładunek",
    navigate: "Nawiguj",
    confirm: "Potwierdzam zlecenie",
    confirming: "Potwierdzam…",
    refuse: "Nie mogę jechać",
    refuseTitle: "Dlaczego nie możesz jechać?",
    refuseSend: "Wyślij odmowę do spedycji",
    sending: "Wysyłam…",
    back: "Wróć",
    reasons: { "Auto niesprawne": "Auto niesprawne", "Brak czasu pracy": "Brak czasu pracy", "Choroba lub sprawa osobista": "Choroba lub sprawa osobista", "Inny powód": "Inny powód" },
    cmrTitle: "Zdjęcie CMR",
    cmrReceived: "Zdjęcie CMR dotarło. Dziękujemy.",
    cmrRetake: "Zdjęcie jest nieczytelne. Zrób jeszcze raz: cały dokument, ostro, bez cienia, z pieczątką odbiorcy.",
    cmrHint: "Po rozładunku zrób zdjęcie podpisanego CMR: cały dokument, ostro, z pieczątką odbiorcy.",
    cmrButton: "Zrób zdjęcie CMR",
    cmrSending: "Wysyłam zdjęcie…",
    sampleHint: "Demo: nie masz dokumentu pod ręką? Wyślij przykładowe zdjęcie.",
    call: "Zadzwoń do spedycji",
    demoNote: "Demo: firma i numer są fikcyjne.",
    inPolish: "",
  },
  uk: {
    subtitle: "Замовлення для водія",
    loading: "Завантаження замовлення…",
    state: {
      do_potwierdzenia: "Очікує вашого підтвердження",
      potwierdzone: "Підтверджено. Їдьте на завантаження.",
      zaladunek: "Завантаження",
      w_drodze: "У дорозі на розвантаження",
      rozladunek: "Розвантаження",
      zakonczone: "Замовлення завершено. Дякуємо.",
      odwolane: "Замовлення скасовано. Не їдьте на завантаження.",
    },
    pickup: "Завантаження",
    delivery: "Розвантаження",
    cargo: "Вантаж",
    navigate: "Навігація",
    confirm: "Підтверджую замовлення",
    confirming: "Підтверджую…",
    refuse: "Не можу їхати",
    refuseTitle: "Чому ви не можете їхати?",
    refuseSend: "Надіслати відмову диспетчеру",
    sending: "Надсилаю…",
    back: "Назад",
    reasons: { "Auto niesprawne": "Автомобіль несправний", "Brak czasu pracy": "Немає робочого часу", "Choroba lub sprawa osobista": "Хвороба або особиста справа", "Inny powód": "Інша причина" },
    cmrTitle: "Фото CMR",
    cmrReceived: "Фото CMR отримано. Дякуємо.",
    cmrRetake: "Фото нечитабельне. Зробіть ще раз: весь документ, різко, без тіні, з печаткою одержувача.",
    cmrHint: "Після розвантаження сфотографуйте підписаний CMR: весь документ, різко, з печаткою одержувача.",
    cmrButton: "Сфотографувати CMR",
    cmrSending: "Надсилаю фото…",
    sampleHint: "Демо: немає документа під рукою? Надішліть зразок фото.",
    call: "Зателефонувати диспетчеру",
    demoNote: "Демо: компанія і номер вигадані.",
    inPolish: "Адреси та примітки подано польською, як у документах.",
  },
  ru: {
    subtitle: "Заказ для водителя",
    loading: "Загрузка заказа…",
    state: {
      do_potwierdzenia: "Ожидает вашего подтверждения",
      potwierdzone: "Подтверждено. Езжайте на загрузку.",
      zaladunek: "Загрузка",
      w_drodze: "В пути на выгрузку",
      rozladunek: "Выгрузка",
      zakonczone: "Заказ завершён. Спасибо.",
      odwolane: "Заказ отменён. Не выезжайте на загрузку.",
    },
    pickup: "Загрузка",
    delivery: "Выгрузка",
    cargo: "Груз",
    navigate: "Навигация",
    confirm: "Подтверждаю заказ",
    confirming: "Подтверждаю…",
    refuse: "Не могу ехать",
    refuseTitle: "Почему вы не можете ехать?",
    refuseSend: "Отправить отказ диспетчеру",
    sending: "Отправляю…",
    back: "Назад",
    reasons: { "Auto niesprawne": "Автомобиль неисправен", "Brak czasu pracy": "Нет рабочего времени", "Choroba lub sprawa osobista": "Болезнь или личное дело", "Inny powód": "Другая причина" },
    cmrTitle: "Фото CMR",
    cmrReceived: "Фото CMR получено. Спасибо.",
    cmrRetake: "Фото нечитаемо. Сделайте ещё раз: весь документ, резко, без тени, с печатью получателя.",
    cmrHint: "После выгрузки сфотографируйте подписанный CMR: весь документ, резко, с печатью получателя.",
    cmrButton: "Сфотографировать CMR",
    cmrSending: "Отправляю фото…",
    sampleHint: "Демо: нет документа под рукой? Отправьте образец фото.",
    call: "Позвонить диспетчеру",
    demoNote: "Демо: компания и номер вымышлены.",
    inPolish: "Адреса и примечания указаны по-польски, как в документах.",
  },
};
