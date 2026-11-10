import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("E — profil klienta do wycen", () => {
  test("handlowiec ustawia profil klienta na wycenie; profil zostaje przy kliencie", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/skrzynka");
    await resetWorld(page);
    await page.getByTestId("client-mail-toggle").click();
    const panel = page.getByTestId("client-mail-panel");
    await panel.getByTestId("client-mail-client").selectOption({ label: "Sudety Papier Sp. z o.o." });
    await panel.getByTestId("client-mail-subject").fill("Wycena — kontener do Chin");
    await panel.getByTestId("client-mail-body").fill("Prosimy o ofertę na fracht morski FCL 40' HC z Gdańska do Szanghaju, incoterms FOB Gdańsk, papier w rolach ok. 24 t, gotowe od 25.10.");
    await panel.getByTestId("client-mail-send").click();
    await expect(page.getByText(/kategoria: zapytanie ofertowe/)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("client-mail-toggle").click();
    await page.getByTestId("inbox-list").getByRole("button", { name: /Wycena — kontener do Chin/ }).first().click();
    await page.getByTestId("sales-link").getByRole("link", { name: "Otwórz wycenę" }).click();

    // A new client starts balanced; no rate has come in yet, so there is nothing to explain.
    const ranking = page.getByTestId("ranking-panel");
    await expect(ranking.getByTestId("profile-label")).toHaveText("cena i czas są równie ważne");
    await expect(ranking.getByTestId("ranking-explain")).toBeDisabled();
    await expect(ranking.getByTestId("profile-save")).toBeDisabled();

    await ranking.getByTestId("profile-najtaniej").click();
    await expect(ranking.getByTestId("profile-label")).toHaveText("liczy się głównie cena");
    await ranking.getByPlaceholder(/lubi tanio i dłużej/).fill("lubi tanio i dłużej");
    await ranking.getByTestId("profile-save").click();
    await expect(page.getByText(/Profil klienta zapisany: liczy się głównie cena/)).toBeVisible();

    // The profile is the client's: it is still there after a reload.
    await page.reload();
    await expect(page.getByTestId("ranking-panel").getByTestId("profile-label")).toHaveText("liczy się głównie cena");
    await expect(page.getByTestId("ranking-panel").getByPlaceholder(/lubi tanio i dłużej/)).toHaveValue("lubi tanio i dłużej");
  });
});
