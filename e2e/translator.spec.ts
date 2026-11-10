import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("B1 — tłumacz dla kierowców", () => {
  test("język kierowcy w komunikatorze; bez AI wiadomość idzie po polsku i spedytor o tym wie", async ({ page }) => {
    await page.goto("/komunikator?d=d-petrenko");
    await resetWorld(page);

    // Oksana Petrenko reads Ukrainian: the composer says the message will be translated.
    const language = page.getByTestId("driver-language");
    await expect(language).toHaveValue("uk");
    await expect(page.getByText(/przetłumaczona: kierowca czyta po ukraińsku/)).toBeVisible();

    // The e2e server has no AI: nothing is translated, and the dispatcher is told instead of guessing.
    await page.getByLabel("Treść wiadomości").fill("Proszę o telefon przed wyjazdem z bazy.");
    await page.getByRole("button", { name: "Wyślij" }).click();
    await expect(page.getByText(/Wiadomość poszła po polsku/)).toBeVisible();
    await expect(page.getByTestId("msg-out").last()).toContainText("Proszę o telefon przed wyjazdem z bazy.");
    await expect(page.getByTestId("msg-translation")).toHaveCount(0);

    // Switching the driver to Polish removes the translation note; switching back restores it.
    await language.selectOption("pl");
    await expect(page.getByText(/Kierowca dostaje SMS-y po polsku/)).toBeVisible();
    await expect(page.getByText(/przetłumaczona: kierowca czyta/)).toHaveCount(0);
    await language.selectOption("ru");
    await expect(page.getByText(/przetłumaczona: kierowca czyta po rosyjsku/)).toBeVisible();
  });
});
