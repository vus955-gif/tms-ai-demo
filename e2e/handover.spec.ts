import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("B2 — przekazanie zmiany", () => {
  test("zestawienie stanu, szkic notatki bez AI i zapis dla następnej zmiany", async ({ page }) => {
    await page.goto("/przekazanie");
    await resetWorld(page);

    // The overdue tachograph blocks a vehicle: it must be the first thing the next shift reads.
    const urgent = page.getByTestId("handover-section-Pilne");
    await expect(urgent).toContainText("EL 9K41: legalizacja tachografu (blokuje przydział)");
    await expect(page.getByTestId("handover-save")).toBeDisabled();

    await page.getByTestId("handover-draft").click();
    const note = page.getByTestId("handover-note");
    await expect(note).toHaveValue(/Przekazanie zmiany,[\s\S]*Pilne:[\s\S]*- Po terminie: EL 9K41/);

    // The outgoing dispatcher adds what the system cannot know, then saves.
    await note.fill(`${await note.inputValue()}\n\nKlient Hanza prosił o telefon po 14:00.`);
    await page.getByTestId("handover-save").click();
    await expect(page.getByText(/Przekazanie zapisane/)).toBeVisible();
    const last = page.getByTestId("handover-last");
    await expect(last).toContainText("Klient Hanza prosił o telefon po 14:00.");
    await expect(last).toContainText("z zestawienia, bez AI");
    await expect(note).toHaveValue("");
  });
});
