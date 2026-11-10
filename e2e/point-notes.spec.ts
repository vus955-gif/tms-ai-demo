import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("B3 — wiedza o punktach z wiadomości kierowców", () => {
  test("uwaga kierowcy o miejscu rozładunku trafia jako propozycja do punktu; spedytor ją przyjmuje", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/klienci");
    await resetWorld(page);

    // At 09:45 the driver heading to Berlin writes how to get to the ramp (about 75 s at 60×).
    await page.getByRole("button", { name: "60×" }).click();
    await page.getByTestId("client-list").getByRole("button", { name: /Meble Wielkopolska/ }).click();
    const suggestion = page.getByTestId("point-suggestion");
    await expect(suggestion).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "1×" }).click();
    await expect(suggestion).toContainText("Uwaga od kierowcy: Jan Nowak");
    await expect(page.getByRole("navigation", { name: "Menu główne" }).getByRole("link", { name: /Klienci/ })).toContainText("1");

    // The dispatcher shortens the driver's message before it becomes a note for everyone.
    await suggestion.getByLabel("Treść uwagi o punkcie").fill("Rozładunek od tyłu hali, rampa 4. Wjazd od Industriestrasse");
    await suggestion.getByTestId("suggestion-accept").click();
    await expect(page.getByText(/Dodano do uwag punktu/)).toBeVisible();
    await expect(suggestion).toBeHidden();
    await expect(page.getByTestId("point-list")).toContainText("Rozładunek od tyłu hali, rampa 4. Wjazd od Industriestrasse.");
  });
});
