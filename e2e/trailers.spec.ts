import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("A2 — przepinanie naczep i „Zadzwoń”", () => {
  test("ciągnik w bazie bierze stojącą tam chłodnię; historia zostaje w kartotece", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/flota");
    await resetWorld(page);

    const line = page.getByTestId("coupling-EL 9K41");
    await expect(line).toContainText("naczepa EL 66SS");
    await page.getByTestId("swap-EL 9K41").click();
    const dialog = page.getByTestId("swap-dialog");
    await expect(dialog).toContainText("Ciągnik stoi: Baza Łódź.");
    // A trailer at another base cannot be taken from here.
    await expect(dialog.getByText("Naczepa PO 11RS stoi w: Baza Poznań, a ciągnik w: Baza Łódź.")).toBeVisible();
    await dialog.getByText("EL 40CZ").click();
    await page.getByTestId("swap-confirm").click();
    await expect(line).toContainText("naczepa EL 40CZ");
    await line.getByText("Historia przepięć").click();
    await expect(line).toContainText("EL 66SS:");

    await page.getByTestId("fleet-tab-trailers").click();
    await expect(page.getByTestId("coupling-EL 66SS")).toContainText("stoi: Baza Łódź");
    await expect(page.getByTestId("coupling-EL 40CZ")).toContainText("pod EL 9K41");
  });

  test("notatka z rozmowy trafia do wątku kierowcy, ale nie na jego telefon", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/komunikator?d=d-wisniewska");
    await resetWorld(page);
    await page.goto("/komunikator?d=d-wisniewska");
    await page.getByTestId("messenger-call").click();
    const call = page.getByTestId("call-dialog");
    await expect(call).toContainText("+48 999 100");
    await expect(call.getByRole("link", { name: /Zadzwoń z telefonu/ })).toHaveAttribute("href", /^tel:\+48999100/);
    await call.getByLabel("Notatka z rozmowy").fill("Rampa zajęta, będzie 30 min później.");
    await page.getByTestId("save-call").click();
    await expect(page.getByTestId("call-note")).toContainText("Rozmowa telefoniczna: Rampa zajęta, będzie 30 min później.");

    // The driver's phone (simulator) shows SMS only.
    await page.getByRole("button", { name: "Telefon kierowcy" }).click();
    const phone = page.getByTestId("phone-panel");
    await page.getByTestId("phone-driver").selectOption({ label: "Anna Wiśniewska (GD 2M88)" });
    await expect(phone).not.toContainText("Rampa zajęta");
  });
});
