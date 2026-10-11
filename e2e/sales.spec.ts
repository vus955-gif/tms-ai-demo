import { expect, test } from "@playwright/test";

test.describe("sprzedaż — wyceny", () => {
  test("handlowiec: wycena drogowa z Poczty klienta, kalkulacja, szkic oferty i wysyłka", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/skrzynka");
    await page.getByTestId("reset-open").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("sim-clock")).toContainText(/08:3\d/);

    await page.getByTestId("client-mail-toggle").click();
    const panel = page.getByTestId("client-mail-panel");
    await panel.getByTestId("client-mail-client").selectOption({ label: "Meble Wielkopolska Sp. z o.o." });
    await panel.getByTestId("client-mail-subject").fill("Prośba o wycenę transportu");
    await panel.getByTestId("client-mail-body").fill("Dzień dobry, prosimy o wycenę: 10 palet, 4 t, Poznań – Lyon, termin 20.10.");
    await panel.getByTestId("client-mail-send").click();
    await expect(page.getByText(/kategoria: zapytanie ofertowe/)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("client-mail-toggle").click();

    // The salesperson's menu shows Sales.
    await page.getByTestId("role-handlowiec").click();
    await page.getByRole("navigation", { name: "Menu główne" }).getByRole("link", { name: /Sprzedaż/ }).click();
    await page.getByTestId("quote-list").getByRole("button", { name: /WY-1001/ }).click();
    const calc = page.getByTestId("road-calc");
    await expect(calc).toContainText("Solówka");
    await expect(calc).toContainText("szacunek");
    await expect(page.getByTestId("road-price")).toContainText("EUR");

    await calc.getByLabel("Kilometry ręcznie").fill("1250");
    await calc.getByTestId("recalc-road").click();
    await expect(calc).toContainText("wpisane ręcznie");
    const price = (await page.getByTestId("road-price").textContent())!.trim();

    await page.getByTestId("draft-offer").click();
    const draft = page.getByTestId("offer-section").getByTestId("sales-draft");
    await expect(draft).toBeVisible({ timeout: 20_000 });
    await expect(draft.getByRole("textbox", { name: "Treść szkicu" })).toHaveValue(new RegExp(price.replace(/\s/g, "\\s?")));
    await draft.getByTestId("send-sales-draft").click();
    await expect(page.getByTestId("quote-status")).toHaveText("oferta wysłana", { timeout: 20_000 });
    await page.getByTestId("role-spedytor").click();
  });

  test("zapytanie morskie: potwierdzenie dla klienta i zapytania do agentów bez danych klienta", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/skrzynka");
    await page.getByTestId("client-mail-toggle").click();
    const panel = page.getByTestId("client-mail-panel");
    await panel.getByTestId("client-mail-client").selectOption({ label: "Sudety Papier Sp. z o.o." });
    await panel.getByTestId("client-mail-subject").fill("Wycena — kontener do Chin");
    await panel.getByTestId("client-mail-body").fill("Prosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t, gotowe od 25.10.");
    await panel.getByTestId("client-mail-send").click();
    await expect(page.getByText(/kategoria: zapytanie ofertowe/)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("client-mail-toggle").click();
    await page.getByTestId("inbox-list").getByRole("button", { name: /Wycena — kontener do Chin/ }).first().click();
    await page.getByTestId("sales-link").getByRole("link", { name: "Otwórz wycenę" }).click();

    await expect(page.getByTestId("quote-status")).toHaveText("zbieranie stawek");
    const agents = page.getByTestId("agents-table");
    for (const company of ["Baltic Ocean Lines Agency", "North Star Shipping GmbH", "Gdańsk Cargo Partners", "MultiModal Partners"]) {
      await expect(agents).toContainText(company);
    }
    await agents.getByRole("button", { name: "Baltic Ocean Lines Agency" }).click();
    const rfq = page.getByTestId("agent-ag-baltic-sea").locator("xpath=following-sibling::tr[1]");
    await expect(rfq).toContainText("Gdańsk → Shanghai");
    await expect(rfq).not.toContainText("Sudety");
  });
});
