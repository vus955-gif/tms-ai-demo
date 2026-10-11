import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 0 — powłoka", () => {
  test("otwiera demo, pokazuje zegar symulacji i status AI", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/monitoring$/);
    await expect(page.getByTestId("sim-clock")).toContainText(/\d{1,2}\.\d{2} · \d{2}:\d{2}/);
    await expect(page.getByTestId("ai-badge")).toContainText("AI");
    await expect(page.getByRole("navigation", { name: "Menu główne" }).getByRole("link")).toHaveCount(9);
  });

  test("pauza zatrzymuje zegar, wznowienie go puszcza", async ({ page }) => {
    await page.goto("/monitoring");
    const clock = page.getByTestId("sim-clock");
    await expect(clock).toContainText(/\d{2}:\d{2}/);
    await page.getByTestId("pause-toggle").click();
    await expect(page.getByTestId("pause-toggle")).toHaveAttribute("aria-label", "Wznów symulację");
    const frozen = await clock.textContent();
    await page.waitForTimeout(7_000);
    await expect(clock).toHaveText(frozen!);
    await page.getByTestId("pause-toggle").click();
    await expect(page.getByTestId("pause-toggle")).toHaveAttribute("aria-label", "Zatrzymaj symulację");
  });

  test("zmiana tempa na 60× przyspiesza zegar", async ({ page }) => {
    await page.goto("/monitoring");
    await page.getByRole("button", { name: "60×" }).click();
    await expect(page.getByRole("button", { name: "60×" })).toHaveAttribute("aria-pressed", "true");
    const before = await page.getByTestId("sim-clock").textContent();
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId("sim-clock")).not.toHaveText(before!);
    await page.getByRole("button", { name: "10×" }).click();
  });

  test("reset wraca do 08:30", async ({ page }) => {
    await page.goto("/monitoring");
    await page.getByRole("button", { name: "60×" }).click();
    await page.waitForTimeout(3_000);
    await resetWorld(page);
    await expect(page.getByRole("button", { name: "10×" })).toHaveAttribute("aria-pressed", "true");
  });

  test("dziennik AI pokazuje wynik diagnostyki", async ({ page }) => {
    await page.goto("/dziennik-ai");
    await page.getByTestId("ai-diagnostics").click();
    await expect(page.getByTestId("ai-diagnostics-result")).toBeVisible();
    await expect(page.getByTestId("ai-log-table")).toContainText("Diagnostyka");
  });
});
