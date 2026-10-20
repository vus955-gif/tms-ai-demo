import { expect, test } from "@playwright/test";

test.describe("moduł C — przesyłki morskie, lotnicze i kolejowe", () => {
  test("lista, uczciwa notka o śledzeniu, status dla klienta ze strażnikiem danych agenta, nowa przesyłka", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/przesylki");
    const list = page.getByTestId("shipment-list");
    await expect(list.getByRole("button")).toHaveCount(4, { timeout: 60_000 });
    await expect(page.getByRole("navigation", { name: "Menu główne" }).getByRole("link", { name: /Przesyłki/ })).toBeVisible();

    // Detail: lane on the map, milestones confirmed from the agent's mail, and the note that live tracking is not connected.
    await page.getByTestId("shipment-MOR-2001").click();
    const detail = page.getByTestId("shipment-detail");
    await expect(detail).toContainText("MOR-2001 · przesyłka morska");
    await expect(page.getByTestId("live-tracking-note")).toContainText("nie jest podłączona w demo");
    await expect(page.getByRole("link", { name: "Jak podłączyć dostawców" })).toHaveAttribute("href", /docs\/sledzenie-przesylek\.md$/);
    await expect(page.getByTestId("shipment-map").locator("canvas")).toBeVisible();
    await expect(page.getByTestId("milestones")).toContainText("agent · reguły");
    await expect(page.getByTestId("agent-section")).toContainText("Następne zapytanie");

    // Client update: drafted from facts; an agent's name typed in by hand is stopped, the clean text goes out.
    await page.getByTestId("draft-update").click();
    const draft = page.getByTestId("update-draft");
    const body = draft.getByLabel("Treść");
    await expect(body).toContainText("Przewidywane dotarcie do Gdańsk (DCT)");
    const clean = await body.inputValue();
    await body.fill(`${clean}\nPotwierdzone przez Baltic Ocean Lines.`);
    await page.getByTestId("send-update").click();
    await expect(page.getByText("zawiera dane agenta")).toBeVisible();
    await body.fill(clean);
    await page.getByTestId("send-update").click();
    await expect(page.getByTestId("update-draft")).toHaveCount(0);
    await expect(page.getByTestId("client-updates")).toContainText("Następny status");

    // New rail shipment: lanes and agents follow the mode, ETA follows ETD + typical transit.
    await page.getByTestId("new-shipment").click();
    const form = page.getByTestId("shipment-form");
    await form.getByRole("button", { name: /kolejowa/ }).click();
    await form.getByLabel("Klient", { exact: true }).selectOption({ label: "Meble Wielkopolska Sp. z o.o." });
    await form.getByLabel("Skąd", { exact: true }).selectOption({ label: "Xi'an (terminal)" });
    await form.getByLabel("Dokąd", { exact: true }).selectOption({ label: "Duisburg (terminal)" });
    await expect(form.getByLabel("Agent", { exact: true }).locator("option", { hasText: "Skyline" })).toHaveCount(0);
    await form.getByLabel("Agent", { exact: true }).selectOption({ label: "Polrail Intermodal (Europa, Chiny (kolej))" });
    await expect(form).toContainText("Typowy tranzyt: 21 dni");
    await page.getByTestId("create-shipment").click();
    await expect(detail).toContainText("KOL-2002 · przesyłka kolejowa");
    await expect(page.getByTestId("milestones")).toContainText("Przejście graniczne");
    await expect(list.getByRole("button")).toHaveCount(5);
  });
});
