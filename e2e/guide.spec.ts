import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("przewodnik po demo", () => {
  // A true first visit: no saved guide state (the other specs start with the guide closed).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("otwiera się przy pierwszej wizycie, odhacza wykonane kroki i pamięta zamknięcie", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/monitoring");
    await resetWorld(page);

    const guide = page.getByTestId("guide");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText("Krok 1 z 5");

    // Step 1 is done by doing it, not by clicking "next".
    await page.getByTestId("vehicle-row-PO 4K21").click();
    await expect(page.getByTestId("guide-step-pojazd")).toHaveAttribute("data-done", "true");
    await expect(guide).toContainText("Krok 2 z 5");

    // Step 2: the guide opens the driver's phone; sending an SMS completes the step.
    await page.getByTestId("guide-action").click();
    await expect(page.getByTestId("phone-panel")).toBeVisible();
    await page.getByTestId("phone-driver").selectOption("d-zielinski");
    await page.getByTestId("phone-input").fill("Stoję w korku, będę godzinę później");
    await page.getByTestId("phone-send").click();
    await expect(page.getByTestId("guide-step-sms")).toHaveAttribute("data-done", "true");
    await page.getByTestId("phone-toggle").click();

    // Closing is remembered across reloads; the header button brings the guide back with its progress.
    await page.getByTestId("guide-close").click();
    await expect(guide).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("sim-clock")).toContainText(/\d{1,2}:\d{2}/);
    await expect(guide).toBeHidden();
    await page.getByTestId("guide-toggle").click();
    await expect(guide).toContainText("Krok 3 z 5");

    // Visiting the AI log completes the last step even out of order.
    await page.goto("/dziennik-ai");
    await expect(page.getByTestId("guide-step-dziennik")).toHaveAttribute("data-done", "true");

    await page.getByTestId("guide-restart").click();
    await expect(guide).toContainText("Krok 1 z 5");
  });
});
