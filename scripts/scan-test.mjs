// Milestone 1 prototype: send a photo of a test paper to Gemini and print the
// vocabulary words it picks (options, circled, underlined, annotated).
//
// Usage:
//   GEMINI_API_KEY=... node scripts/scan-test.mjs <image.jpg> [model[,fallback,...]] [thinkingLevel]
//
// The API key is read from the environment only; never hard-code or commit it.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const [imagePath, model = "gemini-3.6-flash", thinkingLevel = "low"] = process.argv.slice(2);
const apiKey = process.env.GEMINI_API_KEY;

if (!imagePath || !apiKey) {
  console.error("Usage: GEMINI_API_KEY=... node scripts/scan-test.mjs <image> [model,...] [thinkingLevel]");
  process.exit(1);
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const mimeType = MIME[extname(imagePath).toLowerCase()];
if (!mimeType) {
  console.error(`Unsupported image type: ${imagePath}`);
  process.exit(1);
}

// Walking the paper question-by-question (instead of asking for "the words")
// forces full coverage: the first attempt only read one of the two pages.
const PROMPT = `You are helping a Taiwanese student build a vocabulary list from a photo of an English test paper.
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

const schema = {
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

const image = (await readFile(imagePath)).toString("base64");

const body = {
  contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: image } }] }],
  generationConfig: {
    temperature: 0.1,
    responseMimeType: "application/json",
    responseSchema: schema,
    // Default "thinking" burned ~7k tokens and over a minute; transcription
    // does not need much reasoning.
    thinkingConfig: { thinkingLevel },
  },
};

// The free tier regularly returns 503 ("high demand") or 429 (rate limit), so
// try each model in the comma-separated list, retrying with backoff.
const models = model.split(",");
const RETRYABLE = new Set([429, 500, 503]);
const started = Date.now();
let res;
let usedModel;
outer: for (const m of models) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      console.error(`[${m}] attempt ${attempt}: ${err.name === "TimeoutError" ? "timed out" : err.message}`);
      res = undefined;
      continue;
    }
    if (res.ok) {
      usedModel = m;
      break outer;
    }
    console.error(`[${m}] attempt ${attempt}: HTTP ${res.status}`);
    if (!RETRYABLE.has(res.status)) break outer; // 400/401/404: retrying won't help
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (!res?.ok) {
  console.error(res ? `Giving up: HTTP ${res.status}\n${(await res.text()).slice(0, 800)}` : "Giving up: no response");
  process.exit(1);
}

const data = await res.json();
const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.error("Model did not return valid JSON:\n", text.slice(0, 1000));
  process.exit(1);
}

const u = data.usageMetadata ?? {};
console.log(
  `model=${usedModel} thinking=${thinkingLevel} time=${seconds}s ` +
    `prompt=${u.promptTokenCount} output=${u.candidatesTokenCount} thoughts=${u.thoughtsTokenCount ?? 0}`,
);

// Derive the flat word list the review screen will show.
const words = [];
for (const q of parsed.questions) {
  for (const o of q.options) {
    words.push({
      lemma: o.lemma,
      reasons: ["option", ...o.marks, ...(o.handwritten_note ? ["annotated"] : [])],
      note: o.handwritten_note,
      q: q.number,
    });
  }
}
for (const w of parsed.other_marked_words) {
  words.push({ lemma: w.lemma, reasons: [w.mark], note: w.handwritten_note, q: w.number });
}

console.log(`${parsed.questions.length} questions, ${words.length} words\n`);
for (const q of parsed.questions) {
  console.log(`Q${q.number ?? "?"}  ${q.source}  ${q.stem}`);
  for (const o of q.options) {
    const flags = [...o.marks, ...(o.handwritten_note ? [`✎ ${o.handwritten_note}`] : [])].join(" ");
    console.log(`     - ${o.text.padEnd(16)} -> ${o.lemma.padEnd(14)} ${flags}`);
  }
}
if (parsed.other_marked_words.length) console.log("\nOther marked words:");
for (const w of parsed.other_marked_words) {
  console.log(`  Q${w.number ?? "?"} ${w.lemma} [${w.mark}] ${w.handwritten_note ? "✎ " + w.handwritten_note : ""}  | ${w.sentence}`);
}

// Saved next to the (gitignored) test photos so results can be diffed between runs.
const outDir = new URL("../tests/fixtures/", import.meta.url);
await mkdir(outDir, { recursive: true });
await writeFile(new URL("last-scan.json", outDir), JSON.stringify(parsed, null, 2));
