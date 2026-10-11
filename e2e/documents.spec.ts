import path from "node:path";
import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 3 — dokumenty CMR", () => {
  test("zdjęcie CMR z telefonu trafia do Dokumentów, spedytor je odrzuca", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/dokumenty");
    await resetWorld(page);

    await page.getByTestId("phone-toggle").click();
    await page.getByTestId("phone-driver").selectOption("d-zielinski");
    await page.getByTestId("phone-camera").click();
    await page.getByTestId("sample-zl-1033-ostry").click();
    await expect(page.getByTestId("phone-thread").locator("img")).toBeVisible({ timeout: 30_000 });

    // ZL-1033 is still on the road, so nothing can be matched: the paper waits for a human.
    await page.getByTestId("phone-toggle").click();
    await page.getByTestId("queue-weryfikacja").click();
    await expect(page.getByTestId("document-zl-1033-ostry")).toBeVisible({ timeout: 20_000 });
    const detail = page.getByTestId("document-detail");
    await expect(detail).toContainText("Marek Zieliński");
    await detail.getByTestId("reject-document").click();
    await expect(page.getByText("Dokument odrzucony.")).toBeVisible();
    await page.getByTestId("queue-archiwum").click();
    await expect(page.getByTestId("document-list")).toContainText("odrzucony");
  });

  test("własne zdjęcie jest odczytywane bez zapisywania", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/dokumenty?q=weryfikacja");
    await page.getByTestId("phone-toggle").click();
    await page.getByTestId("phone-driver").selectOption("d-wozniak");
    await page.getByTestId("phone-camera").click();
    await page.getByTestId("phone-upload").setInputFiles(path.join(process.cwd(), "public", "cmr-samples", "zl-1038-ostry.jpg"));
    await expect(page.getByTestId("phone-thread")).toContainText("nie jest przechowywane", { timeout: 30_000 });
    await page.getByTestId("phone-toggle").click();
    const list = page.getByTestId("document-list");
    await expect(list).toContainText("Michał Woźniak", { timeout: 20_000 });
  });
});
