import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 1 — monitoring", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/monitoring");
    await resetWorld(page);
  });

  test("lista pokazuje 14 pojazdów z kolorami i czasem jazdy", async ({ page }) => {
    const rows = page.locator('[data-testid^="vehicle-row-"]');
    await expect(rows).toHaveCount(14);
    await expect(page.getByTestId("vehicle-row-EL 3B12")).toContainText("nie dotyczy");
    await page.getByRole("button", { name: /^Busy/ }).click();
    await expect(rows).toHaveCount(5);
    await page.getByRole("button", { name: /^Zagrożone/ }).click();
    await expect(rows.first()).toBeVisible();
  });

  test("szczegóły pojazdu pokazują zlecenie, prognozę i czas pracy", async ({ page }) => {
    await page.getByTestId("vehicle-row-PO 2C19").click();
    const detail = page.getByTestId("vehicle-detail");
    await expect(detail).toContainText("ZL-1035");
    await expect(detail).toContainText("Prognoza dojazdu");
    await expect(detail).toContainText("Jazda ciągła");
    await expect(page).toHaveURL(/v=v-po2c19/);
  });

  test("wypadek na A2: alert, czerwony stan i objazd, który ratuje termin", async ({ page }) => {
    await page.getByRole("button", { name: "60×" }).click();
    await expect(page.getByTestId("vehicle-row-PO 4K21")).toBeVisible();
    // 20 simulated minutes at 60x ≈ 20 real seconds; the panel polls every 15 s.
    await expect(page.getByTestId("alerts-toggle")).toHaveAccessibleName(/Powiadomienia \([1-9]/, { timeout: 45_000 });
    await page.getByRole("button", { name: "10×" }).click();
    await page.getByTestId("alerts-toggle").click();
    const accident = page.getByTestId("alert-card").filter({ hasText: "Wypadek na A2" });
    await expect(accident).toBeVisible();
    await accident.getByRole("button", { name: "Zastosuj objazd" }).click();
    await expect(page.getByText("Objazd zastosowany")).toBeVisible();
    await page.getByTestId("alerts-toggle").click();
    await page.getByTestId("vehicle-row-PO 4K21").click();
    await expect(page.getByTestId("vehicle-detail")).toContainText("jedzie objazdem");
  });
});
