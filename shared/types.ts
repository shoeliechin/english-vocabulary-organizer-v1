// Types shared by the Worker (API) and the React app.

export type Reason = "option" | "circled" | "underlined" | "annotated";
export type Status = "new" | "learning" | "known";

/** One word the scan proposes to add. */
export interface Candidate {
  lemma: string;
  reasons: Reason[];
  /** The printed sentence/stem the word came from (blank shown as "____"). */
  sentence: string;
  /** Exam tag printed on the paper, e.g. "98 指考". */
  source: string;
  number: number | null;
  /** The student's own handwritten gloss next to the word. */
  note: string;
  /** Already in the word bank (greyed out, not preselected). */
  saved: boolean;
}

export interface ScanResponse {
  candidates: Candidate[];
  questionCount: number;
  model: string;
}

export interface Word {
  id: number;
  lemma: string;
  pos: string;
  definition_en: string;
  definition_zh: string;
  example: string;
  source: string;
  user_note: string;
  status: Status;
  created_at: string;
}

export interface SaveItem {
  lemma: string;
  sentence: string;
  source: string;
  note: string;
}

export interface SaveRequest {
  items: SaveItem[];
}

export interface SaveResponse {
  saved: Word[];
  /** Already in the word bank, left untouched. */
  skipped: string[];
  /** Could not be defined (model busy or omitted); safe to retry. */
  failed: string[];
}

export const MAX_SAVE_ITEMS = 120;
export const STATUSES: Status[] = ["new", "learning", "known"];
