import { describe, expect, it } from "vitest";
import { classifyByRules } from "./driver-message-rules";

describe("driver message rules", () => {
  it.each([
    ["ok", "potwierdzenie", 0.8],
    ["OK jadę", "potwierdzenie", 0.8],
    ["Przyjmuję", "potwierdzenie", 0.8],
    ["👍", "potwierdzenie", 0.8],
    ["nie dam rady, jutro mam wolne", "odmowa", 0.8],
    ["auto w serwisie", "odmowa", 0.8],
  ] as const)("%s → %s", (text, category, confidence) => {
    const r = classifyByRules(text);
    expect(r.category).toBe(category);
    expect(r.confidence).toBeGreaterThanOrEqual(confidence);
  });

  it("never treats a conditional yes as a confirmation", () => {
    expect(classifyByRules("ok, ale będę 2 h później").category).toBe("warunek_pytanie");
    expect(classifyByRules("ok tylko jaki numer rampy?").category).toBe("warunek_pytanie");
    expect(classifyByRules("Ok, ale dopiero po 14").category).toBe("warunek_pytanie");
  });

  it("recognises questions, road problems, documents and small talk", () => {
    expect(classifyByRules("jaki numer rampy?").category).toBe("warunek_pytanie");
    expect(classifyByRules("Złapałem gumę, stoję na poboczu")).toMatchObject({ category: "operacyjne", subtype: "awaria", priority: "wysoki" });
    expect(classifyByRules("Kontrola ITD, sprawdzają tachograf")).toMatchObject({ category: "operacyjne", subtype: "kontrola" });
    expect(classifyByRules("wysyłam CMR").category).toBe("dokument");
    expect(classifyByRules("", true).category).toBe("dokument");
    expect(classifyByRules("Dzień dobry, jestem na MOP-ie, robię przerwę")).toMatchObject({ category: "luzne", priority: "niski" });
    expect(classifyByRules("hmm").category).toBe("niejasne");
  });

  it("suggests short replies", () => {
    expect(classifyByRules("ok").suggested_replies.length).toBeGreaterThan(0);
  });
});
