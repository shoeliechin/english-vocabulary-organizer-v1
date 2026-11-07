import { useCallback, useEffect, useState } from "react";
import { STATUSES } from "../shared/types";
import type { Status, Word } from "../shared/types";
import { api, ApiError } from "./api";

const STATUS_LABEL: Record<Status, string> = { new: "New 新", learning: "Learning 學習中", known: "Known 已會" };

export function WordsPage({ active, version }: { active: boolean; version: number }) {
  const [words, setWords] = useState<Word[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWords((await api.listWords(q.trim(), status)).words);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load words.");
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  // Reload when the tab is shown, after a save, and (debounced) as the filters change.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [active, version, load]);

  async function setWordStatus(w: Word, next: Status) {
    setWords((ws) => ws.map((x) => (x.id === w.id ? { ...x, status: next } : x))); // optimistic
    try {
      await api.updateWord(w.id, { status: next });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update.");
      load();
    }
  }

  async function remove(w: Word) {
    if (!confirm(`Delete "${w.lemma}"?`)) return;
    try {
      await api.deleteWord(w.id);
      setWords((ws) => ws.filter((x) => x.id !== w.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete.");
    }
  }

  return (
    <section>
      <div className="row filters">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 搜尋" aria-label="Search words" />
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | "")} aria-label="Filter by status">
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && words.length === 0 && (
        <p className="hint center">{q || status ? "No matching words." : "No words yet. Scan a page to add some! 還沒有單字，去掃描吧！"}</p>
      )}

      <ul className="words">
        {words.map((w) => (
          <li key={w.id} className="card word">
            <div className="wordHead">
              <h2>
                {w.lemma} <span className="pos">{w.pos}</span>
              </h2>
              <select value={w.status} onChange={(e) => setWordStatus(w, e.target.value as Status)} aria-label={`Status of ${w.lemma}`}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <p className="zh">{w.definition_zh}</p>
            <p className="en">{w.definition_en}</p>
            {w.example && <p className="example">“{w.example}”</p>}
            <div className="meta">
              {w.user_note && <span className="note">✎ {w.user_note}</span>}
              {w.source && <span className="tag">{w.source}</span>}
              <button className="link danger" onClick={() => remove(w)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
