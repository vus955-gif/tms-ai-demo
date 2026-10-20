import { expect, test } from "@playwright/test";

test.describe("etap 4b — nowi klienci i punkty", () => {
  test("nowy klient, punkt wskazany na mapie, wybór w formularzu zlecenia", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/klienci");
    await expect(page.getByTestId("client-list").getByRole("button").first()).toBeVisible({ timeout: 60_000 });

    // Client with a wrong NIP is refused in Polish, then saved with a valid one.
    await page.getByTestId("new-client").click();
    const form = page.getByTestId("client-form");
    await form.getByLabel("Nazwa firmy").fill("Piekarnia Testowa Sp. z o.o.");
    await form.getByLabel("NIP").fill("123-456-78-82");
    await form.getByLabel("Osoba kontaktowa").fill("Jan Testowy");
    await form.getByLabel("E-mail").fill("jan@piekarnia-testowa.example");
    await page.getByTestId("save-client").click();
    await expect(form.getByRole("alert")).toContainText("cyfrą kontrolną");
    await form.getByLabel("NIP").fill("123-456-78-83");
    await page.getByTestId("save-client").click();
    await expect(page.getByTestId("client-detail")).toContainText("Piekarnia Testowa Sp. z o.o.");
    await expect(page.getByTestId("client-detail")).toContainText("Brak punktów");

    // Point: address, then a click on the map sets its location.
    await page.getByTestId("add-point").click();
    const pf = page.getByTestId("point-form");
    await pf.getByLabel("Nazwa punktu").fill("Magazyn testowy");
    await pf.getByLabel("Adres").fill("ul. Testowa 1");
    await pf.getByLabel("Miejscowość").fill("Oleśnica");
    await page.getByTestId("save-point").click();
    await expect(pf.getByRole("alert")).toContainText("Wskaż punkt na mapie");
    const picker = page.getByTestId("point-picker");
    await expect(picker.locator("canvas")).toBeVisible();
    await picker.locator("canvas").click({ position: { x: 200, y: 110 } });
    await expect(pf).toContainText(/Lokalizacja: \d+\.\d{5}, \d+\.\d{5}/);
    await pf.getByLabel("Notatki dla kierowcy").fill("Wjazd od ul. Polnej");
    await page.getByTestId("save-point").click();
    const points = page.getByTestId("point-list");
    await expect(points).toContainText("Magazyn testowy");
    await expect(points).toContainText("trasy przybliżone");
    await expect(points).toContainText("Wjazd od ul. Polnej");

    // Keyboard path: coordinates typed in; a point in Germany switches the country from "Polska".
    await page.getByTestId("add-point").click();
    await pf.getByLabel("Nazwa punktu").fill("Hala w Kolonii");
    await pf.getByLabel("Adres").fill("Industriestraße 5");
    await pf.getByLabel("Miejscowość").fill("Köln");
    await pf.getByLabel("Szerokość geograficzna").fill("50.94");
    await pf.getByLabel("Długość geograficzna").fill("6.96");
    await expect(pf).toContainText("Kraj ustawiony według mapy: Niemcy");
    await page.getByTestId("save-point").click();
    await expect(points).toContainText("Hala w Kolonii");
    await expect(points).toContainText("Niemcy");

    // The new client and point show up in the order form.
    await page.goto("/zlecenia");
    await page.getByTestId("new-order").click();
    await page.getByLabel("Klient").selectOption({ label: "Piekarnia Testowa Sp. z o.o." });
    await expect(page.getByLabel("Załadunek", { exact: true }).locator("option", { hasText: "Magazyn testowy" })).toHaveCount(1);
  });
});
