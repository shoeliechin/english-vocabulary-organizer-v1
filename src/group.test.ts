import { describe, expect, it } from "vitest";
import type { Candidate } from "../shared/types";
import { groupCandidates } from "./group";

const c = (lemma: string, number: number | null, sentence: string, source = ""): Candidate => ({
  lemma, reasons: ["option"], sentence, source, number, note: "", saved: false,
});

describe("groupCandidates", () => {
  it("groups by question number and keeps order", () => {
    const g = groupCandidates([c("a", 14, "s14"), c("b", 14, "s14"), c("d", 15, "s15")]);
    expect(g.map((x) => [x.number, x.items.map((i) => i.lemma)])).toEqual([[14, ["a", "b"]], [15, ["d"]]]);
  });
  it("keeps different unnumbered questions apart (cut-off question numbers)", () => {
    const g = groupCandidates([c("utensil", null, "We decided to buy some ____"), c("appliance", null, "We decided to buy some ____"), c("racial", null, "Buddhism is the ____ religion")]);
    expect(g).toHaveLength(2);
    expect(g[0].items.map((i) => i.lemma)).toEqual(["utensil", "appliance"]);
    expect(g[1].sentence).toBe("Buddhism is the ____ religion");
  });
  it("puts words with neither number nor sentence (manual adds) in one 'other' group", () => {
    const g = groupCandidates([c("x", null, ""), c("y", null, "")]);
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe("other");
  });
  it("fills in a missing sentence/source from a later item in the same group", () => {
    const g = groupCandidates([c("a", 3, ""), c("b", 3, "stem", "98 指考")]);
    expect(g[0]).toMatchObject({ sentence: "stem", source: "98 指考" });
  });
});
