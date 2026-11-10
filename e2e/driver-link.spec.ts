import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("A6 — strona zlecenia dla kierowcy (link z SMS-a)", () => {
  test("kierowca otwiera link bez logowania, potwierdza jednym kliknięciem, spedytor widzi to w komunikatorze", async ({ page, browser }) => {
    test.setTimeout(150_000);
    await page.goto("/monitoring");
    await resetWorld(page);

    // Play the van driver (his bot goes quiet); ZL-1042 reaches him by SMS at 09:20, about 50 s at 60×.
    await page.getByTestId("phone-toggle").click();
    await page.getByTestId("phone-driver").selectOption("d-grabowski");
    await page.getByRole("button", { name: "60×" }).click();
    const link = page.getByTestId("phone-thread").getByTestId("driver-link");
    await expect(link).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "1×" }).click();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/k\/[A-Za-z0-9_-]{16}$/);

    // The driver's phone: another browser, no demo-world cookie, a phone-sized screen.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pl-PL", timezoneId: "Europe/Warsaw" });
    const driver = await phone.newPage();
    await driver.goto(href!);
    const card = driver.getByTestId("driver-order");
    await expect(card).toContainText("ZL-1042");
    await expect(driver.getByTestId("driver-state")).toHaveText("Czeka na Twoje potwierdzenie");
    await expect(driver.getByText("Załadunek", { exact: true })).toBeVisible();
    await expect(driver.getByRole("link", { name: "Nawiguj" })).toHaveCount(2);
    expect(await driver.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await driver.getByTestId("driver-confirm").click();
    await expect(driver.getByTestId("driver-state")).toHaveText("Potwierdzone. Jedź na załadunek.");
    await expect(driver.getByTestId("driver-confirm")).toBeHidden();

    // A wrong address tells the driver so instead of showing someone else's order.
    await driver.goto("/k/nie-ma-takiego-linku-0000");
    await expect(driver.getByText("Nie ma takiego linku.")).toBeVisible();
    await expect(driver.getByTestId("driver-order")).toHaveCount(0);
    await phone.close();

    // The dispatcher sees the confirmation in the driver's thread, marked as coming from the order page.
    await page.getByTestId("phone-toggle").click();
    await page.goto("/komunikator?d=d-grabowski");
    await expect(page.getByTestId("conversation")).toContainText("Potwierdzam zlecenie ZL-1042. (ze strony zlecenia)");
  });
});
