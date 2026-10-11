import { expect, type Page } from "@playwright/test";

/**
 * Starts the demo world from scratch. Waits until the page is live (the clock
 * shows a time) and retries opening the dialog: on a cold dev server the first
 * click can land before React has hydrated the button.
 */
export async function resetWorld(page: Page) {
  await expect(page.getByTestId("sim-clock")).toContainText(/\d{1,2}:\d{2}/, { timeout: 60_000 });
  await expect(async () => {
    await page.getByTestId("reset-open").click();
    await expect(page.getByTestId("reset-confirm")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("sim-clock")).toContainText(/08:3\d/);
}
