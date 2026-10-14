import { expect, test } from "@playwright/test";

test.describe("tryb ciemny", () => {
  test.use({ colorScheme: "dark" });

  test("idzie za systemem, ręczny wybór przetrwa przeładowanie, mapa ma własny przełącznik", async ({ page }) => {
    await page.goto("/monitoring");
    const html = page.locator("html");
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Motyw: jak system");

    // Manual choice: light, kept after a reload (set by the inline script before React runs).
    await page.getByTestId("theme-toggle").click();
    await page.getByRole("menuitemradio", { name: "Jasny" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(html).not.toHaveClass(/\bdark\b/);
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Motyw: jasny");

    // The map follows the theme until its own switch is used: auto → light → dark → auto.
    const map = page.getByTestId("fleet-map");
    const mapToggle = page.getByTestId("map-style-toggle");
    await expect(map).toHaveAttribute("data-map-theme", "light");
    await mapToggle.click();
    await expect(mapToggle).toHaveText("Mapa: jasna");
    await mapToggle.click();
    await expect(mapToggle).toHaveText("Mapa: ciemna");
    await expect(map).toHaveAttribute("data-map-theme", "dark");
    await expect(html).not.toHaveClass(/\bdark\b/);
    await mapToggle.click();
    await expect(mapToggle).toHaveText("Mapa: jak motyw");
    await expect(map).toHaveAttribute("data-map-theme", "light");

    // Back to following the device.
    await page.getByTestId("theme-toggle").click();
    await page.getByRole("menuitemradio", { name: "Jak system" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(map).toHaveAttribute("data-map-theme", "dark");
  });
});
