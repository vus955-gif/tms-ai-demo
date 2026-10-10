import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus, type StatusActor } from "@/db/schema";
import { canTransition, transitionError, TRANSITIONS } from "./order-lifecycle";

describe("order lifecycle", () => {
  it.each<[OrderStatus, OrderStatus, StatusActor]>([
    ["SZKIC", "NOWE", "dispatcher"],
    ["NOWE", "PRZYPISANE", "dispatcher"],
    ["PRZYPISANE", "WYSLANE", "system"],
    ["WYSLANE", "POTWIERDZONE", "ai"],
    ["WYSLANE", "NOWE", "system"],
    ["POTWIERDZONE", "ZALADUNEK", "system"],
    ["ZALADUNEK", "W_DRODZE", "system"],
    ["W_DRODZE", "ROZLADUNEK", "system"],
    ["ROZLADUNEK", "DO_ZAMKNIECIA", "ai"],
    ["DO_ZAMKNIECIA", "ZAMKNIETE", "dispatcher"],
    ["POTWIERDZONE", "ANULOWANE", "dispatcher"],
  ])("allows %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });

  it("never lets AI close an order or set a final status", () => {
    for (const from of ORDER_STATUSES) {
      expect(canTransition(from, "ZAMKNIETE", "ai")).toBe(false);
      expect(canTransition(from, "ANULOWANE", "ai")).toBe(false);
    }
  });

  it("lets AI set exactly two statuses", () => {
    const aiTargets = new Set(TRANSITIONS.filter((r) => r.actors.includes("ai")).map((r) => r.to));
    expect([...aiTargets].sort()).toEqual(["DO_ZAMKNIECIA", "POTWIERDZONE"]);
  });

  it("explains rejected changes in Polish", () => {
    expect(transitionError("W_DRODZE", "ANULOWANE", "dispatcher")).toBe("Zlecenia po załadunku nie można anulować.");
    expect(transitionError("DO_ZAMKNIECIA", "ZAMKNIETE", "ai")).toBe("Tej zmiany statusu nie może wykonać AI.");
    expect(transitionError("NOWE", "ROZLADUNEK", "system")).toContain("Nie można zmienić statusu");
    expect(transitionError("NOWE", "PRZYPISANE", "dispatcher")).toBeNull();
  });
});
