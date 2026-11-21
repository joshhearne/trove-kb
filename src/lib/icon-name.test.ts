import { describe, expect, it } from "vitest";
import { icons } from "lucide-react";
import { iconNames } from "lucide-react/dynamic";
import { iconKey, iconLookup, iconStoredName, isIconName } from "./icon-name";

describe("icon names", () => {
  it("turns the component name into a stored name", () => {
    expect(iconStoredName("Building2")).toBe("building-2");
    expect(iconStoredName("GlobeLock")).toBe("globe-lock");
    expect(iconStoredName("AArrowDown")).toBe("a-arrow-down");
    expect(iconStoredName("Grid2x2")).toBe("grid-2x2");
    expect(iconStoredName("Columns3Cog")).toBe("columns-3-cog");
    expect(iconStoredName("Clock10")).toBe("clock-10");
  });

  it("gives both spellings of a name the same key", () => {
    expect(iconKey("globe-lock")).toBe(iconKey("GlobeLock"));
    expect(iconKey("arrow-down-a-z")).toBe(iconKey("ArrowDownAZ"));
    expect(iconKey(" Building-2 ")).toBe(iconKey("Building2"));
  });

  it("finds every icon lucide-react ships by either spelling of its name", () => {
    const lookup = iconLookup(Object.entries(icons));
    for (const [component, Icon] of Object.entries(icons)) {
      expect(lookup(component)).toBe(Icon);
      expect(lookup(iconStoredName(component))).toBe(Icon);
    }
  });

  it("keeps icons apart whose names differ only by a dash", () => {
    const lookup = iconLookup([
      ["LetterS", "letter s"],
      ["Letters", "letters"],
      ["GlobeLock", "globe lock"],
    ]);
    expect(lookup("letter-s")).toBe("letter s");
    expect(lookup("LetterS")).toBe("letter s");
    expect(lookup("letters")).toBe("letters");
    expect(lookup("Letters")).toBe("letters");
    // The dash-free fallback still finds a name nobody else shares...
    expect(lookup("globelock")).toBe("globe lock");
    expect(lookup(" Globe-Lock ")).toBe("globe lock");
    // ...and guesses at neither when two names share it.
    expect(lookup("LETTERS")).toBe("letters");
    expect(lookup("letter s")).toBeUndefined();
  });

  it("keys almost every icon lucide-react ships apart", () => {
    const keys = Object.keys(icons).map(iconKey);
    expect(keys.length - new Set(keys).size).toBeLessThan(5);
  });

  it("names almost every icon the way the lucide site does", () => {
    // The few that differ ("ArrowDown01" is "arrow-down-0-1" upstream) still
    // resolve, since the key is what the lookup goes by.
    const official = new Set<string>(iconNames);
    const unofficial = Object.keys(icons)
      .map(iconStoredName)
      .filter((name) => !official.has(name));
    expect(unofficial.length).toBeLessThan(10);
    for (const name of unofficial) expect(isIconName(name)).toBe(true);
  });

  it("resolves the official spelling of every icon that is not an alias", () => {
    const exported = new Set(Object.keys(icons).map(iconKey));
    const unresolved = iconNames.filter((name) => !exported.has(iconKey(name)));
    // Aliases ("home" for "house") are not in the component map and miss on
    // purpose; they are a minority of the list.
    expect(unresolved.length).toBeLessThan(iconNames.length / 4);
    expect(unresolved).not.toContain("globe-lock");
    expect(unresolved).not.toContain("arrow-down-a-z");
  });

  it("knows what a name looks like", () => {
    expect(isIconName("globe-lock")).toBe(true);
    expect(isIconName("Globe Lock")).toBe(false);
    expect(isIconName("")).toBe(false);
  });
});
