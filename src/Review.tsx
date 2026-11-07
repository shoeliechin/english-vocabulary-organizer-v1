import { useMemo, useState } from "react";
import type { Candidate, Reason, SaveItem } from "../shared/types";
import { groupCandidates } from "./group";

const REASON_LABEL: Record<Reason, string> = {
  option: "選項 option",
  circled: "圈起 circled",
  underlined: "底線 underlined",
  annotated: "手寫 note",
};

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function Review({
  candidates: initial,
  questionCount,
  onSave,
  onBack,
}: {
  candidates: Candidate[];
  questionCount: number;
  onSave: (items: SaveItem[]) => void;
  onBack: () => void;
}) {
  const [candidates, setCandidates] = useState(initial);
  // Everything the model found is preselected, except words already saved.
  const [picked, setPicked] = useState(() => new Set(initial.filter((c) => !c.saved).map((c) => c.lemma)));
  const [manual, setManual] = useState("");

  const groups = useMemo(() => groupCandidates(candidates), [candidates]);
  const selectable = candidates.filter((c) => !c.saved);

  const toggle = (lemma: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(lemma)) next.add(lemma);
      return next;
    });

  function addManual() {
    const lemma = clean(manual);
    if (!/^[a-z](?:[a-z' -]{0,58}[a-z])?$/.test(lemma)) return;
    if (!candidates.some((c) => c.lemma === lemma)) {
      setCandidates((cs) => [...cs, { lemma, reasons: [], sentence: "", source: "", number: null, note: "", saved: false }]);
    }
    setPicked((p) => new Set(p).add(lemma));
    setManual("");
  }

  const chosen = selectable.filter((c) => picked.has(c.lemma));

  return (
    <div className="card">
      <div className="reviewHead">
        <div>
          <strong>
            {selectable.length} words found in {questionCount} questions
          </strong>
          <p className="hint">Uncheck the ones you already know. 取消勾選你已經會的單字。</p>
        </div>
        <div className="row tight">
          <button className="link" onClick={() => setPicked(new Set(selectable.map((c) => c.lemma)))}>
            All
          </button>
          <button className="link" onClick={() => setPicked(new Set())}>
            None
          </button>
        </div>
      </div>

      {groups.map((g) => (
        <fieldset key={g.key} className="group">
          <legend>
            {g.number !== null ? `Q${g.number}` : "Other"}
            {g.source && <span className="tag"> {g.source}</span>}
          </legend>
          {g.sentence && <p className="sentence">{g.sentence}</p>}
          <ul>
            {g.items.map((c) => (
              <li key={c.lemma} className={c.saved ? "saved" : ""}>
                <label>
                  <input type="checkbox" checked={!c.saved && picked.has(c.lemma)} disabled={c.saved} onChange={() => toggle(c.lemma)} />
                  <span className="lemma">{c.lemma}</span>
                  {c.saved && <span className="badge">已儲存 saved</span>}
                  {!c.saved &&
                    c.reasons
                      .filter((r) => r !== "option")
                      .map((r) => (
                        <span key={r} className={`badge ${r}`}>
                          {REASON_LABEL[r]}
                        </span>
                      ))}
                  {c.note && <span className="note">✎ {c.note}</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}

      <form
        className="row manual"
        onSubmit={(e) => {
          e.preventDefault();
          addManual();
        }}
      >
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Missed a word? Type it 補充單字" autoCapitalize="none" autoCorrect="off" />
        <button className="btn" type="submit">
          Add
        </button>
      </form>

      <div className="stickybar">
        <button className="btn" onClick={onBack}>
          ← Back
        </button>
        <button
          className="btn primary"
          disabled={chosen.length === 0}
          onClick={() => onSave(chosen.map((c) => ({ lemma: c.lemma, sentence: c.sentence, source: c.source, note: c.note })))}
        >
          Save {chosen.length} word{chosen.length === 1 ? "" : "s"} 儲存
        </button>
      </div>
    </div>
  );
}
