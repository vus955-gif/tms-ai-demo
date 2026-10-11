import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("etap 2 — zlecenia, SMS i komunikator", () => {
  test("przydział z klockami, odpowiedź z warunkiem, potwierdzenie i odpowiedź spedytora", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/zlecenia");
    await resetWorld(page);
    await page.getByRole("button", { name: "60×" }).click();

    // ZL-1043 appears at 09:10 simulated (~40 s at 60x); the board refreshes with the 15 s poll.
    await expect(page.getByTestId("order-card-ZL-1043")).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "1×" }).click();
    // ZL-1043 comes from the client's e-mail as a draft: approve it first.
    await page.getByTestId("approve-ZL-1043").click();
    await expect(page.getByTestId("pick-ZL-1043")).toBeVisible({ timeout: 20_000 });

    // Play Marek Zieliński so his bot stays silent.
    await page.getByTestId("phone-toggle").click();
    await page.getByTestId("phone-driver").selectOption("d-zielinski");

    await page.getByTestId("pick-ZL-1043").click();
    const list = page.getByTestId("pick-list");
    await expect(list).toContainText("za mała pojemność");
    await list.getByRole("button", { name: /Przydziel: Marek Zieliński/ }).click();
    await expect(page.getByText("ZL-1043 wysłane do: Marek Zieliński")).toBeVisible();

    const phone = page.getByTestId("phone-thread");
    await expect(phone).toContainText("ZLECENIE ZL-1043", { timeout: 20_000 });

    await page.getByTestId("phone-input").fill("ok, ale będę 2 h później");
    await page.getByTestId("phone-send").click();
    await expect(page.getByTestId("phone-input")).toHaveValue("");
    await expect(phone).toContainText("ok, ale będę 2 h później");
    await expect(page.getByTestId("queue-ZL-1043")).toContainText("Wysłane do kierowcy", { timeout: 20_000 });
    await expect(page.getByTestId("alerts-toggle")).toHaveAccessibleName(/Powiadomienia \([1-9]/);

    await page.getByTestId("phone-input").fill("OK jadę");
    await page.getByTestId("phone-send").click();
    await expect(page.getByTestId("phone-input")).toHaveValue("");
    await expect(page.getByTestId("queue-ZL-1043")).toContainText("W realizacji", { timeout: 20_000 });

    // The dispatcher answers from the messenger; the driver sees it on the phone.
    await page.goto("/komunikator?d=d-zielinski");
    const conversation = page.getByTestId("conversation");
    await expect(conversation).toContainText("warunek / pytanie");
    await expect(conversation).toContainText("potwierdzenie");
    await page.getByTestId("suggestions").getByRole("button").first().click();
    await page.getByRole("button", { name: "Wyślij" }).click();
    await expect(conversation.getByTestId("msg-out").last()).not.toContainText("ZLECENIE");
  });

  test("nowe zlecenie z formularza trafia do puli", async ({ page }) => {
    await page.goto("/zlecenia");
    await page.getByTestId("new-order").click();
    const form = page.getByTestId("new-order-form");
    await form.getByLabel("Klient").selectOption({ label: "Agro-Pol S.A." });
    await form.getByLabel("Załadunek", { exact: true }).selectOption({ index: 1 });
    await form.getByLabel("Rozładunek", { exact: true }).selectOption({ index: 1 });
    await form.getByLabel("Palety").fill("8");
    await form.getByLabel("Waga (kg)").fill("3500");
    await form.getByRole("button", { name: "Załóż zlecenie" }).click();
    await expect(page.getByText(/Zlecenie ZL-\d+ założone/)).toBeVisible();
  });

  test("formularz pokazuje błąd bez wybranego klienta", async ({ page }) => {
    await page.goto("/zlecenia");
    await page.getByTestId("new-order").click();
    await page.getByRole("button", { name: "Załóż zlecenie" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Wybierz klienta" })).toBeVisible();
  });
});
