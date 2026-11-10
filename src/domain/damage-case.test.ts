import { describe, expect, it } from "vitest";
import { admitsLiability, damageChecklist, damageKindByRules, damageMailTemplate } from "./damage-case";

describe("damage case rules", () => {
  it("reads the kind of reservation from the consignee's remark", () => {
    expect(damageKindByRules("2 palety uszkodzone, folia rozerwana")).toBe("uszkodzenie");
    expect(damageKindByRules("Kartony zamoczone na dolnej warstwie")).toBe("uszkodzenie");
    expect(damageKindByRules("Brak 3 kartonów względem WZ")).toBe("brak");
    expect(damageKindByRules("Dostawa po terminie, 4 h opóźnienia")).toBe("opoznienie");
    expect(damageKindByRules("Przyjęto z zastrzeżeniem")).toBe("inne");
  });

  it("quotes the CMR deadlines only for international carriage", () => {
    const international = damageChecklist("uszkodzenie", true);
    expect(international.notes.join(" ")).toContain("7 dni");
    expect(international.notes.join(" ")).toContain("art. 32 CMR");
    const domestic = damageChecklist("uszkodzenie", false);
    expect(domestic.notes.join(" ")).toContain("Prawo przewozowe");
    expect(domestic.notes.join(" ")).not.toContain("art. 30");
    for (const list of [international, domestic]) {
      expect(list.steps.map((s) => s.id)).toEqual(["zdjecia", "dokumenty", "klient", "ubezpieczyciel", "bez_uznania"]);
      expect(list.notes.at(-1)).toContain("nie porada prawna");
    }
    expect(damageChecklist("opoznienie", true).steps[0].text).toContain("przyczyn opóźnienia");
  });

  it("writes a template e-mail with the facts and without any admission", () => {
    const mail = damageMailTemplate({ orderNumber: "ZL-1035", references: ["LW-2026-3390"], route: "Gądki → Leipzig", deliveredOn: "10.11.2026", remark: "2 palety uszkodzone", stamp: true, signature: true });
    expect(mail.subject).toBe("Zlecenie ZL-1035: zastrzeżenie odbiorcy przy dostawie");
    expect(mail.body).toContain("zlecenia ZL-1035 (ref. LW-2026-3390), Gądki → Leipzig, 10.11.2026");
    expect(mail.body).toContain("„2 palety uszkodzone”");
    expect(mail.body.startsWith("Dzień dobry,")).toBe(true);
    expect(admitsLiability(mail.body)).toBe(false);
  });

  it("catches drafts that accept liability or promise money", () => {
    expect(admitsLiability("Przyjmujemy odpowiedzialność za uszkodzenie i pokryjemy koszty.")).toBe(true);
    expect(admitsLiability("Uznajemy reklamację w całości.")).toBe(true);
    expect(admitsLiability("Zaproponujemy rekompensatę po weryfikacji.")).toBe(true);
    expect(admitsLiability("Wyjaśniamy okoliczności i wrócimy z informacją o dalszych krokach.")).toBe(false);
  });
});
