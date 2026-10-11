import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 3b — skrzynka klientów", () => {
  test("mail z zamówieniem daje szkic ZL-1043, spedytor go zatwierdza", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/skrzynka");
    await resetWorld(page);
    await page.getByRole("button", { name: "60×" }).click();

    // The order e-mail arrives at 09:10 simulated (~40 s at 60x).
    const list = page.getByTestId("inbox-list");
    await expect(list).toContainText("Zlecenie transportu Gądki", { timeout: 90_000 });
    await page.getByRole("button", { name: "1×" }).click();
    await list.getByRole("button", { name: /Marta Sobczak/ }).click();

    const draft = page.getByTestId("draft-order");
    await expect(draft).toContainText("Szkic zlecenia ZL-1043");
    await expect(draft).toContainText("Gądki → Leipzig");
    await expect(draft).toContainText("12 palet");
    await expect(draft).toContainText("LW-5501");
    await draft.getByTestId("approve-draft").click();
    await expect(page.getByText("ZL-1043 zatwierdzone")).toBeVisible();

    // A reply confirming the order, from the template or AI, never with driver data.
    await page.getByTestId("request-draft").click();
    const editor = page.getByTestId("draft-editor");
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.getByRole("textbox", { name: "Treść odpowiedzi" })).toHaveValue(/ZL-1043/);
    await editor.getByTestId("send-draft").click();
    await expect(page.getByTestId("inbox-thread").getByTestId("mail-out")).toBeVisible();

    await page.goto("/zlecenia");
    await expect(page.getByTestId("pick-ZL-1043")).toBeVisible({ timeout: 20_000 });
  });

  test("Poczta klienta: zapytanie ofertowe trafia do skrzynki i do Sprzedaży", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/skrzynka");
    await page.getByTestId("client-mail-toggle").click();
    const panel = page.getByTestId("client-mail-panel");
    await panel.getByTestId("client-mail-client").selectOption({ label: "Sudety Papier Sp. z o.o." });
    await panel.getByTestId("client-mail-subject").fill("Prośba o wycenę kontenera");
    await panel.getByTestId("client-mail-body").fill("Dzień dobry, prosimy o ofertę na fracht morski FCL 40' z Gdańska do Szanghaju, FOB.");
    await panel.getByTestId("client-mail-send").click();
    await expect(page.getByText(/Mail w Skrzynce — kategoria: zapytanie ofertowe/)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("client-mail-toggle").click();
    await page.getByTestId("inbox-list").getByRole("button", { name: /Prośba o wycenę kontenera/ }).click();
    await expect(page.getByTestId("sales-link")).toContainText("Wycena WY-");
  });
});
