import { expect, test, type Page } from "@playwright/test";

/** A visitor opening the demo link on a phone: nothing may spill off the screen, and every module stays reachable. */
test.describe("układ na telefonie", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const fitsScreen = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  test("żaden ekran panelu nie wystaje poza szerokość telefonu", async ({ page }) => {
    test.setTimeout(180_000);
    const routes = ["/monitoring", "/zlecenia", "/szablony", "/przesylki", "/komunikator", "/skrzynka", "/klienci", "/dokumenty", "/flota", "/terminarz", "/dziennik-ai", "/sprzedaz"];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByTestId("sim-clock")).toContainText(/\d{1,2}:\d{2}/, { timeout: 60_000 });
      expect(await fitsScreen(page), `${route} mieści się na ekranie`).toBe(true);
      // The menu is a drawer on a phone, so it must not take space next to the content.
      await expect(page.getByRole("navigation", { name: "Menu główne" })).toBeHidden();
    }
  });

  test("menu wysuwa się z nagłówka i zamyka po wyborze modułu", async ({ page }) => {
    await page.goto("/monitoring");
    await expect(page.getByTestId("sim-clock")).toContainText(/\d{1,2}:\d{2}/, { timeout: 60_000 });
    const menu = page.getByRole("navigation", { name: "Menu główne" });
    await expect(async () => {
      await page.getByTestId("menu-toggle").click();
      await expect(menu).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await menu.getByRole("link", { name: /Flota/ }).click();
    await expect(page).toHaveURL(/\/flota$/);
    await expect(menu).toBeHidden();
    await expect(page.getByTestId("fleet-view")).toBeVisible();

    // Escape closes the drawer without navigating.
    await page.getByTestId("menu-toggle").click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("narzędzia demo (telefon kierowcy, poczta klienta, powiadomienia) mieszczą się na ekranie", async ({ page }) => {
    await page.goto("/monitoring");
    await expect(page.getByTestId("sim-clock")).toContainText(/\d{1,2}:\d{2}/, { timeout: 60_000 });
    for (const [toggle, panel] of [
      ["phone-toggle", "phone-panel"],
      ["client-mail-toggle", "client-mail-panel"],
      ["client-view-toggle", "client-view-panel"],
      ["alerts-toggle", "alerts-panel"],
    ] as const) {
      await page.getByTestId(toggle).click();
      const box = await page.getByTestId(panel).boundingBox();
      expect(box, `${panel} jest widoczny`).not.toBeNull();
      expect(box!.x, `${panel} zaczyna się na ekranie`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${panel} kończy się na ekranie`).toBeLessThanOrEqual(375);
      expect(await fitsScreen(page)).toBe(true);
      await page.getByTestId(toggle).click();
      await expect(page.getByTestId(panel)).toBeHidden();
    }
  });
});
