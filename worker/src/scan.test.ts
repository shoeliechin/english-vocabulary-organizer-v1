import { describe, expect, it } from "vitest";
import { flattenScan, normalizeLemma } from "./scan";

describe("normalizeLemma", () => {
  it("lowercases and trims", () => expect(normalizeLemma("  Bounce ")).toBe("bounce"));
  it("keeps multi-word items and hyphens/apostrophes", () => {
    expect(normalizeLemma("Naked Eye")).toBe("naked eye");
    expect(normalizeLemma("warm-up")).toBe("warm-up");
  });
  it("strips surrounding punctuation", () => expect(normalizeLemma("“appliance.”")).toBe("appliance"));
  it.each(["", "4", "A1", "-x", "x-", "你好", "a".repeat(80), null, 42])("rejects %j", (v) => expect(normalizeLemma(v)).toBe(""));
});

describe("flattenScan", () => {
  const raw = {
    questions: [
      {
        number: 15,
        source: "110 指考",
        stem: "paper ____ are still most common",
        options: [
          { text: "tokens", lemma: "token", marks: [], handwritten_note: "" },
          { text: "ballots", lemma: "Ballot", marks: ["underlined"], handwritten_note: "選票" },
        ],
      },
      {
        number: 2,
        source: "98 指考",
        stem: "The Internet has ____ newspapers",
        options: [{ text: "estimated", lemma: "estimate", marks: ["bogus"], handwritten_note: "" }],
      },
    ],
    other_marked_words: [
      { lemma: "naked eye", mark: "underlined", sentence: "with the naked eye", source: "98 指考", number: 20, handwritten_note: "肉眼" },
      { lemma: "4", mark: "circled", sentence: "", source: "", number: null, handwritten_note: "" },
      // already seen as an option: reasons merge, first sentence wins
      { lemma: "token", mark: "circled", sentence: "other", source: "", number: 15, handwritten_note: "" },
    ],
  };

  const out = flattenScan(raw);

  it("orders by question number, keeping option order within a question", () => {
    expect(out.map((w) => w.lemma)).toEqual(["estimate", "token", "ballot", "naked eye"]);
  });
  it("marks options and derives 'annotated' from a handwritten note", () => {
    expect(out.find((w) => w.lemma === "ballot")?.reasons).toEqual(["option", "underlined", "annotated"]);
    expect(out.find((w) => w.lemma === "ballot")?.note).toBe("選票");
  });
  it("ignores unknown marks", () => expect(out.find((w) => w.lemma === "estimate")?.reasons).toEqual(["option"]));
  it("merges duplicates without losing the original sentence", () => {
    const token = out.find((w) => w.lemma === "token")!;
    expect(token.reasons).toEqual(["option", "circled"]);
    expect(token.sentence).toBe("paper ____ are still most common");
  });
  it("adds marked non-option words and drops junk lemmas", () => {
    expect(out.find((w) => w.lemma === "naked eye")).toMatchObject({ reasons: ["underlined", "annotated"], number: 20 });
    expect(out.some((w) => w.lemma === "4")).toBe(false);
  });
  it("tolerates missing arrays", () => expect(flattenScan({})).toEqual([]));
});
