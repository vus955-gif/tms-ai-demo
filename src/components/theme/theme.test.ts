import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMapTheme, resolveTheme } from "./theme";
import { THEME_INIT_SCRIPT, THEME_KEY } from "./theme-script";

describe("theme", () => {
  it("follows the device until the viewer picks a theme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("lets the map follow the theme or keep its own style", () => {
    expect(resolveMapTheme("auto", "dark")).toBe("dark");
    expect(resolveMapTheme("light", "dark")).toBe("light");
    expect(resolveMapTheme("dark", "light")).toBe("dark");
  });

  describe("inline script (runs before the first paint)", () => {
    afterEach(() => vi.unstubAllGlobals());

    function run(stored: string | null, systemDark: boolean) {
      const classes = new Set<string>();
      const root = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) }, style: { colorScheme: "" } };
      vi.stubGlobal("localStorage", { getItem: (k: string) => (k === THEME_KEY ? stored : null) });
      vi.stubGlobal("window", { matchMedia: () => ({ matches: systemDark }) });
      vi.stubGlobal("document", { documentElement: root });
      new Function(THEME_INIT_SCRIPT)();
      return { dark: classes.has("dark"), scheme: root.style.colorScheme };
    }

    it("applies the stored choice, or the device setting without one", () => {
      expect(run(null, true)).toEqual({ dark: true, scheme: "dark" });
      expect(run(null, false)).toEqual({ dark: false, scheme: "light" });
      expect(run("system", true)).toEqual({ dark: true, scheme: "dark" });
      expect(run("light", true)).toEqual({ dark: false, scheme: "light" });
      expect(run("dark", false)).toEqual({ dark: true, scheme: "dark" });
    });

    it("does not throw when storage is blocked", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
      });
      expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
    });
  });
});
