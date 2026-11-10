import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

const day = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test.describe("A4 — dokument serwisowy w kartotece floty", () => {
  // The e2e server runs without an AI key: the document is not read, the dispatcher types the entry in.
  test("bez AI formularz zostaje do ręcznego wpisu; zatwierdzony wpis zdejmuje pojazd z listy po terminie", async ({ page }) => {
    await page.goto("/flota");
    await resetWorld(page);
    await expect(page.getByTestId("fleet-overdue")).toContainText("2");

    await page.getByTestId("service-doc-open").click();
    const dialog = page.getByTestId("service-doc-dialog");
    await dialog.getByTestId("service-sample-tachograf-el9k41").click();
    await expect(dialog.getByTestId("service-doc-source")).toContainText("AI nie odczytało dokumentu");
    await expect(dialog.getByRole("img", { name: /Protokół legalizacji tachografu/ })).toBeVisible();
    await expect(dialog.getByTestId("service-doc-save")).toBeDisabled();

    await dialog.getByLabel("Pojazd lub naczepa").selectOption({ label: "EL 9K41 (ciągnik)" });
    await dialog.getByLabel("Rodzaj terminu").selectOption({ label: "legalizacja tachografu" });
    await expect(dialog).toContainText("Teraz w kartotece:");

    // A date that has already passed is refused with an explanation, not saved silently.
    await dialog.getByLabel("Ważne do").fill(day(-30));
    await dialog.getByTestId("service-doc-save").click();
    await expect(dialog.getByRole("alert")).toContainText("Ten termin już minął");

    await dialog.getByLabel("Data wykonania").fill(day(-1));
    await dialog.getByLabel("Ważne do").fill(day(730));
    await dialog.getByLabel("Numer dokumentu").fill("TS/2026/11/0457");
    await dialog.getByTestId("service-doc-save").click();

    await expect(page.getByText(/Zapisano w kartotece\. EL 9K41: legalizacja tachografu ważne do/)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("fleet-overdue")).toContainText("1");
  });
});
