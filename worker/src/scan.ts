import type { Candidate, Reason } from "../../shared/types";

// Walking the paper question-by-question (instead of asking for "the words")
// forces full coverage, and tying options to their stem keeps the example
// sentence right. The photo must be upright: the UI has rotate buttons.
export const SCAN_PROMPT = `You are helping a Taiwanese student build a vocabulary list from a photo of an English test paper.
The photo may be curved, shadowed, or partly covered by a pen, and it may show two facing pages.
Parts of the photo may be sideways or upside down (the two pages can even be printed in opposite orientations). Mentally rotate each part so it reads normally, then process EVERY question you can see on every page, from the lowest question number to the highest.
Each question is printed as: the number and stem sentence, THEN its four options (A)-(D) on the line(s) directly below it, ending with an exam tag like 【98 指考】. Options belong to the stem ABOVE them, never the one below.

Step 1 - transcribe each multiple-choice question:
- number: the printed question number (null if cut off).
- source: the exam tag printed at the end of the question, e.g. "98 指考", else "".
- stem: the question sentence with the blank shown as "____".
- options: every printed answer choice (A)-(D), in order. For each option give:
  - text: exactly as printed.
  - lemma: the base/dictionary form, lowercase (bounces -> bounce, estimated -> estimate). Keep multi-word items together.
  - marks: any of "circled", "underlined" if the STUDENT marked this option in pen/pencil. Printed layout is not a mark. Use [] if none.
  - handwritten_note: a handwritten gloss written next to this option, usually Chinese, transcribed as exactly as legible; "" if none.

Step 2 - other_marked_words: words in a question stem or other printed text (NOT answer options) that the student circled or underlined, or wrote a handwritten gloss next to. For each: lemma, mark ("circled" | "underlined" | "annotated"), the sentence it is in, source, question number, handwritten_note.

Ignore handwritten answer letters in the margin (A/B/C/D) and ignore any printed instructions. Never invent text you cannot read; omit an unreadable option instead.`;

const optionSchema = {
  type: "OBJECT",
  properties: {
    text: { type: "STRING" },
    lemma: { type: "STRING" },
    marks: { type: "ARRAY", items: { type: "STRING", enum: ["circled", "underlined"] } },
    handwritten_note: { type: "STRING" },
  },
  required: ["text", "lemma", "marks", "handwritten_note"],
};

export const SCAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "INTEGER", nullable: true },
          source: { type: "STRING" },
          stem: { type: "STRING" },
          options: { type: "ARRAY", items: optionSchema },
        },
        required: ["number", "source", "stem", "options"],
      },
    },
    other_marked_words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          lemma: { type: "STRING" },
          mark: { type: "STRING", enum: ["circled", "underlined", "annotated"] },
          sentence: { type: "STRING" },
          source: { type: "STRING" },
          number: { type: "INTEGER", nullable: true },
          handwritten_note: { type: "STRING" },
        },
        required: ["lemma", "mark", "sentence", "source", "number", "handwritten_note"],
      },
    },
  },
  required: ["questions", "other_marked_words"],
};

export interface RawScan {
  questions?: {
    number?: number | null;
    source?: string;
    stem?: string;
    options?: { text?: string; lemma?: string; marks?: string[]; handwritten_note?: string }[];
  }[];
  other_marked_words?: {
    lemma?: string;
    mark?: string;
    sentence?: string;
    source?: string;
    number?: number | null;
    handwritten_note?: string;
  }[];
}

export function buildScanRequest(imageBase64: string, mimeType: string) {
  return {
    contents: [{ parts: [{ text: SCAN_PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: SCAN_SCHEMA,
      // Transcription needs little reasoning. The default burned ~7k thought
      // tokens and over a minute per scan.
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

/** Lowercase, trim, drop stray punctuation. Returns "" if it isn't a plausible English word/phrase. */
export function normalizeLemma(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"().,;:!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^[a-z](?:[a-z' -]{0,58}[a-z])?$/.test(s) ? s : "";
}

const MARKS = new Set<Reason>(["circled", "underlined", "annotated"]);

/** Flatten the per-question transcription into one deduplicated, ordered word list. */
export function flattenScan(raw: RawScan): Omit<Candidate, "saved">[] {
  const byLemma = new Map<string, Omit<Candidate, "saved">>();

  const add = (lemma: unknown, reasons: Reason[], sentence: string, source: string, number: number | null, note: string) => {
    const key = normalizeLemma(lemma);
    if (!key) return;
    const existing = byLemma.get(key);
    if (existing) {
      for (const r of reasons) if (!existing.reasons.includes(r)) existing.reasons.push(r);
      if (!existing.note && note) existing.note = note;
      if (!existing.sentence && sentence) existing.sentence = sentence;
      return;
    }
    byLemma.set(key, { lemma: key, reasons: [...new Set(reasons)], sentence, source, number, note });
  };

  for (const q of raw.questions ?? []) {
    const number = typeof q.number === "number" ? q.number : null;
    for (const o of q.options ?? []) {
      const note = (o.handwritten_note ?? "").trim();
      const marks = (o.marks ?? []).filter((m): m is Reason => MARKS.has(m as Reason));
      add(o.lemma, ["option", ...marks, ...(note ? (["annotated"] as Reason[]) : [])], q.stem ?? "", q.source ?? "", number, note);
    }
  }
  for (const w of raw.other_marked_words ?? []) {
    const note = (w.handwritten_note ?? "").trim();
    const mark = MARKS.has(w.mark as Reason) ? (w.mark as Reason) : "annotated";
    const reasons: Reason[] = [mark];
    if (note && mark !== "annotated") reasons.push("annotated");
    add(w.lemma, reasons, w.sentence ?? "", w.source ?? "", typeof w.number === "number" ? w.number : null, note);
  }

  // Question order, with unnumbered items last; Array.sort is stable so
  // options keep their printed order within a question.
  return [...byLemma.values()].sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
}
