import { describe, expect, it } from "vitest";
import { buildDefineRequest, parseDefinitions } from "./define";

const good = { lemma: "Appliance", pos: "n.", definition_en: "a machine for the home", definition_zh: "家電", example: "We bought a new appliance." };

describe("parseDefinitions", () => {
  it("keeps requested entries, lowercasing the lemma", () => {
    const m = parseDefinitions({ definitions: [good] }, ["appliance"]);
    expect(m.get("appliance")).toMatchObject({ lemma: "appliance", definition_zh: "家電" });
  });
  it("drops entries nobody asked for, duplicates, and entries missing a definition", () => {
    const m = parseDefinitions(
      {
        definitions: [
          { ...good, lemma: "stranger" },
          good,
          { ...good, definition_en: "second copy" },
          { ...good, lemma: "facility", definition_zh: "" },
        ],
      },
      ["appliance", "facility"],
    );
    expect([...m.keys()]).toEqual(["appliance"]);
    expect(m.get("appliance")?.definition_en).toBe("a machine for the home");
  });
  it("clips oversized fields", () => {
    const m = parseDefinitions({ definitions: [{ ...good, example: "x".repeat(1000) }] }, ["appliance"]);
    expect(m.get("appliance")?.example).toHaveLength(300);
  });
  it("tolerates a missing array", () => expect(parseDefinitions({}, ["a"]).size).toBe(0));
});

describe("buildDefineRequest", () => {
  it("passes the list as JSON data and trims long sentences", () => {
    const body = buildDefineRequest([{ lemma: "token", sentence: "s".repeat(500) }]);
    const text = body.contents[0].parts[0].text;
    expect(text).toContain('"lemma":"token"');
    expect(text).not.toContain("s".repeat(301));
  });
});
