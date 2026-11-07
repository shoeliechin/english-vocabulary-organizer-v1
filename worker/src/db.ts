import type { Status, Word } from "../../shared/types";
import type { Definition } from "./define";

// D1 allows at most 100 bound parameters per statement.
const CHUNK = 50;

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function existingLemmas(db: D1Database, lemmas: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunks(lemmas)) {
    const marks = part.map(() => "?").join(",");
    const { results } = await db.prepare(`SELECT lemma FROM words WHERE lemma IN (${marks})`).bind(...part).all<{ lemma: string }>();
    for (const r of results) found.add(r.lemma.toLowerCase());
  }
  return found;
}

export interface NewWord extends Definition {
  source: string;
  user_note: string;
}

export async function insertWords(db: D1Database, rows: NewWord[]): Promise<Word[]> {
  if (rows.length === 0) return [];
  // INSERT OR IGNORE: a concurrent scan that saved the same lemma first wins.
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO words (lemma, pos, definition_en, definition_zh, example, source, user_note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  await db.batch(rows.map((r) => stmt.bind(r.lemma, r.pos, r.definition_en, r.definition_zh, r.example, r.source, r.user_note)));

  const saved: Word[] = [];
  for (const part of chunks(rows.map((r) => r.lemma))) {
    const marks = part.map(() => "?").join(",");
    const { results } = await db.prepare(`SELECT * FROM words WHERE lemma IN (${marks}) ORDER BY id`).bind(...part).all<Word>();
    saved.push(...results);
  }
  return saved;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export async function listWords(db: D1Database, q: string, status: Status | null): Promise<Word[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where.push(`(lemma LIKE ? ESCAPE '\\' OR definition_en LIKE ? ESCAPE '\\' OR definition_zh LIKE ? ESCAPE '\\' OR user_note LIKE ? ESCAPE '\\')`);
    args.push(like, like, like, like);
  }
  if (status) {
    where.push("status = ?");
    args.push(status);
  }
  const sql = `SELECT * FROM words ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC, id DESC LIMIT 500`;
  const { results } = await db.prepare(sql).bind(...args).all<Word>();
  return results;
}

export async function updateWord(db: D1Database, id: number, patch: { status?: Status; user_note?: string }): Promise<Word | null> {
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (patch.user_note !== undefined) {
    sets.push("user_note = ?");
    args.push(patch.user_note);
  }
  if (sets.length) await db.prepare(`UPDATE words SET ${sets.join(", ")} WHERE id = ?`).bind(...args, id).run();
  return db.prepare("SELECT * FROM words WHERE id = ?").bind(id).first<Word>();
}

export async function deleteWord(db: D1Database, id: number): Promise<boolean> {
  const res = await db.prepare("DELETE FROM words WHERE id = ?").bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}
