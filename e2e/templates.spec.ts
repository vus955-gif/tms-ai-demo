import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 4a — zlecenia stałe z szablonów", () => {
  test("paczka na tydzień: prognoza, wybór i utworzenie zlecenia jednym kliknięciem", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/szablony");
    await resetWorld(page);

    const list = page.getByTestId("template-list");
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list).toContainText("Kutno");

    const plan = page.getByTestId("week-plan");
    await expect(plan.getByRole("row").nth(1)).toBeVisible({ timeout: 30_000 });
    await expect(plan).toContainText(/zdąży|ryzyko|brak kierowcy/);

    // Leave only the first row selected, then create it.
    const boxes = plan.getByRole("checkbox");
    const n = await boxes.count();
    expect(n).toBeGreaterThan(1);
    for (let i = 1; i < n; i++) await boxes.nth(i).uncheck();
    await expect(page.getByTestId("create-planned")).toHaveText("Utwórz zaznaczone (1)");
    await page.getByTestId("create-planned").click();
    await expect(page.getByText(/Utworzono 1: ZL-\d+/)).toBeVisible();
    await expect(plan).toContainText(/ZL-\d+ utworzone/);
    await expect(plan.getByRole("checkbox")).toHaveCount(n - 1);

    // Pausing a template takes its days out of the plan.
    const before = await plan.getByRole("row").count();
    const toggle = list.getByRole("listitem").nth(2).getByLabel("aktywny");
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => plan.getByRole("row").count()).toBeLessThan(before);
  });

  test("nowy szablon: walidacja i zapis", async ({ page }) => {
    await page.goto("/szablony");
    await expect(page.getByTestId("template-list").getByRole("listitem").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("new-template").click();
    const form = page.getByTestId("template-form");
    await form.getByLabel("Nazwa szablonu").fill("Test: stała trasa");
    await form.getByLabel("Klient").selectOption({ index: 1 });
    await form.getByLabel("Załadunek", { exact: true }).selectOption({ index: 1 });
    await form.getByLabel("Rozładunek", { exact: true }).selectOption({ index: 1 });
    await page.getByTestId("save-template").click();
    await expect(form.getByRole("alert")).toContainText("różnych punktach");

    await form.getByLabel("Rozładunek", { exact: true }).selectOption({ index: 2 });
    await page.getByTestId("save-template").click();
    await expect(page.getByText("Szablon dodany")).toBeVisible();
    await expect(page.getByTestId("template-list")).toContainText("Test: stała trasa");
  });
});
