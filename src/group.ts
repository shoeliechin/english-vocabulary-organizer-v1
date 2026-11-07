import type { Candidate } from "../shared/types";

export interface Group {
  key: string;
  number: number | null;
  source: string;
  sentence: string;
  items: Candidate[];
}

/**
 * Group candidates by question for the review screen. Questions whose number
 * is cut off in the photo (null) are grouped by their sentence instead, so two
 * different unnumbered questions never share one sentence header.
 */
export function groupCandidates(candidates: Candidate[]): Group[] {
  const map = new Map<string, Group>();
  for (const c of candidates) {
    const key = c.number !== null ? `q${c.number}` : c.sentence ? `s:${c.sentence}` : "other";
    let g = map.get(key);
    if (!g) {
      g = { key, number: c.number, source: c.source, sentence: c.sentence, items: [] };
      map.set(key, g);
    }
    if (!g.sentence) g.sentence = c.sentence;
    if (!g.source) g.source = c.source;
    g.items.push(c);
  }
  return [...map.values()];
}
