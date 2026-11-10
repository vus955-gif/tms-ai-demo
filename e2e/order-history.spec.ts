import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("Historia zlecenia", () => {
  test("zamknięte zlecenie pokazuje cały przebieg, a zlecenie w trasie swój stan początkowy", async ({ page }) => {
    await page.goto("/zlecenia");
    await resetWorld(page);

    // A run closed before the demo starts: its whole life, oldest change first.
    await page.getByTestId("closed-open").click();
    await page.getByTestId("closed-orders").getByTestId("history-ZL-1022").click();
    const history = page.getByTestId("order-history");
    await expect(history).toContainText("Historia zlecenia ZL-1022");
    await expect(history).toContainText("Meble Wielkopolska Sp. z o.o. · Swarzędz → Berlin · Zamknięte · Jan Nowak");
    const items = history.getByTestId("order-history-list").getByRole("listitem");
    await expect(items).toHaveCount(9);
    await expect(items.first()).toContainText("Start: Nowe");
    await expect(items.nth(2)).toContainText("Przypisane → Wysłane do kierowcy");
    await expect(items.last()).toContainText("Do zamknięcia → Zamknięte");
    await expect(items.last()).toContainText("Zamknięte po sprawdzeniu dokumentów");
    await expect(history.getByTestId("order-history-summary")).toContainText("Zmian: 9");
    await page.keyboard.press("Escape");
    await expect(history).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("closed-orders")).toBeHidden();

    // A run on the board: it starts with the state the scenario put it in.
    await page.locator('[data-testid^="lane-"]').getByRole("button", { name: /^Historia zlecenia ZL-/ }).first().click();
    await expect(history.getByTestId("order-history-list").getByRole("listitem").first()).toContainText("Start:");
    await expect(history.getByTestId("order-history-list").getByRole("listitem").first()).toContainText("Stan początkowy scenariusza");
    await page.keyboard.press("Escape");
    await expect(history).toBeHidden();
  });
});
