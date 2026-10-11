import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 6 — kartoteka floty i terminarz", () => {
  test("przeterminowany tachograf i urlop wykluczają z klocków; odnotowanie przywraca pojazd", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/flota");
    await resetWorld(page);

    const card = page.getByTestId("fleet-EL 9K41");
    await expect(card).toContainText("legalizacja tachografu");
    await expect(page.getByTestId("fleet-overdue")).toContainText("2");

    // ZL-1043 arrives by e-mail at 09:10 (≈40 s at 60×): approve it and open the "klocki".
    await page.getByRole("button", { name: "60×" }).click();
    await page.goto("/zlecenia");
    await expect(page.getByTestId("approve-ZL-1043")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "1×" }).click();
    await page.getByTestId("approve-ZL-1043").click();
    await page.getByTestId("pick-ZL-1043").click();
    const list = page.getByTestId("pick-list");
    await expect(list).toContainText("legalizacja tachografu ważne tylko do");
    await expect(list).toContainText("urlop");
    await page.keyboard.press("Escape");

    await page.goto("/flota");
    await page.getByTestId("renew-v-el9k41:tachograf").click();
    await expect(page.getByText("Odnotowano")).toBeVisible();
    await expect(page.getByTestId("fleet-overdue")).toContainText("1");

    await page.goto("/zlecenia");
    await page.getByTestId("pick-ZL-1043").click();
    await expect(page.getByTestId("pick-list")).not.toContainText("legalizacja tachografu");
  });

  test("terminarz: dodanie i usunięcie nieobecności", async ({ page }) => {
    await page.goto("/terminarz");
    const form = page.getByTestId("absence-form");
    await form.getByLabel("Kierowca").selectOption({ label: "Adam Dąbrowski" });
    await form.getByLabel("Rodzaj nieobecności").selectOption("l4");
    await form.getByTestId("add-absence").click();
    const row = page.getByTestId("calendar-d-dabrowski");
    await expect(row).toContainText("zwolnienie lekarskie");
    await row.getByRole("button", { name: /zwolnienie lekarskie/ }).first().click();
    await expect(row).not.toContainText("zwolnienie lekarskie");
  });
});
