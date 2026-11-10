import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { resetWorld } from "./helpers";

test.describe("A5 — zamknięte zlecenia i eksport do faktur", () => {
  test("lista zamkniętych, plik CSV i oznaczenie wyeksportowanych", async ({ page }) => {
    await page.goto("/zlecenia");
    await resetWorld(page);

    await page.getByTestId("closed-open").click();
    const dialog = page.getByTestId("closed-orders");
    await expect(dialog.getByTestId("closed-ZL-1029")).toContainText("Hanza");
    await expect(dialog.getByTestId("closed-ZL-1022")).toContainText("Swarzędz → Berlin");
    await expect(dialog.getByTestId("closed-summary")).toContainText("Do faktury: 6. Zaznaczone: 6.");

    // Leave one order out: it must stay "do faktury" after the export.
    await dialog.getByLabel("Wybierz ZL-1024 do eksportu").uncheck();
    await expect(dialog.getByTestId("export-csv")).toContainText("Pobierz CSV (5)");

    const downloading = page.waitForEvent("download");
    await dialog.getByTestId("export-csv").click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^zlecenia-do-faktur-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile(await download.path(), "utf8");
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain("Numer zlecenia;Klient;NIP");
    expect(csv).toContain("ZL-1022;Meble Wielkopolska");
    expect(csv).not.toContain("ZL-1024");

    await expect(dialog.getByTestId("closed-ZL-1022")).toContainText("wyeksportowane");
    await expect(dialog.getByTestId("closed-ZL-1024")).toContainText("do faktury");
    await expect(dialog.getByTestId("closed-summary")).toContainText("Do faktury: 1. Zaznaczone: 1.");
  });
});
