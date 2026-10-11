import { expect, test } from "@playwright/test";

test.describe("etap 5 — panel klienta", () => {
  test("spedytor tworzy link, klient widzi jeden transport bez danych kierowcy", async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.goto("/monitoring");
    await page.getByTestId("reset-open").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("sim-clock")).toContainText(/08:3\d/);

    await page.getByTestId("vehicle-row-WB 6P77").click();
    const box = page.getByTestId("client-link");
    await box.getByTestId("create-client-link").click();
    await expect(box).toContainText("aktywny");
    const url = (await box.getByTestId("client-link-url").textContent())!.trim();
    expect(url).toMatch(/\/sledzenie\/[A-Za-z0-9_-]{20,}$/);

    // The client opens the link in a fresh context (no demo world cookie).
    const client = await context.browser()!.newContext();
    const tab = await client.newPage();
    await tab.goto(url);
    const card = tab.getByTestId("tracking-card");
    await expect(card).toContainText("ZL-1037");
    await expect(card).toContainText("WB 6P77");
    await expect(tab.getByTestId("tracking-state")).toHaveText("Śledzenie aktywne");
    await expect(tab.getByTestId("tracking-map")).toBeVisible();
    await expect(tab.locator("body")).not.toContainText("Szymański");
    await client.close();

    await box.getByTestId("extend-client-link").click();
    await expect(box).toContainText("przedłużony o 2 h");

    // "Widok klienta" lists only the transports shared with that client.
    await page.getByTestId("client-view-toggle").click();
    await page.getByTestId("client-view-client").selectOption({ label: "Mazovia Electronics Sp. z o.o." });
    await expect(page.getByTestId("client-view-panel")).toContainText("ZL-1037");
    await page.getByTestId("client-view-client").selectOption({ label: "Logistyka Wisła Sp. z o.o." });
    await expect(page.getByTestId("client-view-panel")).toContainText("Brak udostępnionych transportów");
  });
});
