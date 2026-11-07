import { useCallback, useEffect, useRef, useState } from "react";
import type { Candidate, SaveItem, SaveResponse } from "../shared/types";
import { api, ApiError } from "./api";
import { drawRotated, PREVIEW_EDGE, renderUploadJpeg, turn } from "./image";
import type { Rotation } from "./image";
import { Review } from "./Review";

type ReviewPhase = { name: "review"; candidates: Candidate[]; questionCount: number };

type Phase =
  | { name: "pick" }
  | { name: "adjust" }
  | { name: "scanning" }
  | { name: "review"; candidates: Candidate[]; questionCount: number }
  | { name: "saving"; count: number; review: ReviewPhase | null }
  | { name: "done"; result: SaveResponse; retry: SaveItem[] };

export function ScanPage({ onSaved, onOpenWords }: { onSaved: () => void; onOpenWords: () => void }) {
  const [phase, setPhase] = useState<Phase>({ name: "pick" });
  const [error, setError] = useState("");
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Redraw the preview whenever the photo or rotation changes (also after returning from review).
  useEffect(() => {
    if (bitmap && canvasRef.current && (phase.name === "adjust" || phase.name === "scanning")) {
      drawRotated(canvasRef.current, bitmap, rotation, PREVIEW_EDGE);
    }
  }, [bitmap, rotation, phase.name]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      // createImageBitmap applies the camera's EXIF orientation by default.
      const bmp = await createImageBitmap(file);
      bitmap?.close();
      setBitmap(bmp);
      setRotation(0);
      setPhase({ name: "adjust" });
    } catch {
      setError("That file could not be opened as an image.");
    }
  }

  async function scan() {
    if (!bitmap) return;
    setError("");
    setPhase({ name: "scanning" });
    try {
      const res = await api.scan(renderUploadJpeg(bitmap, rotation), "image/jpeg");
      if (res.candidates.length === 0) {
        setError("No words found. Try rotating the photo so the text is upright, or retake it with less glare.");
        setPhase({ name: "adjust" });
        return;
      }
      setPhase({ name: "review", candidates: res.candidates, questionCount: res.questionCount });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Scan failed.");
      setPhase({ name: "adjust" });
    }
  }

  // `back` is where to return if the request itself fails (network / AI busy),
  // so the user's selections are never lost and pressing Save again is the retry.
  const save = useCallback(
    async (items: SaveItem[], back: Phase) => {
      setError("");
      setPhase({ name: "saving", count: items.length, review: back.name === "review" ? back : null });
      try {
        const result = await api.saveWords(items);
        if (result.saved.length > 0) onSaved();
        const failed = new Set(result.failed);
        setPhase({ name: "done", result, retry: items.filter((i) => failed.has(i.lemma.toLowerCase())) });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Saving failed.");
        setPhase(back);
      }
    },
    [onSaved],
  );

  function reset() {
    bitmap?.close();
    setBitmap(null);
    setRotation(0);
    setError("");
    setPhase({ name: "pick" });
  }

  return (
    <section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase.name === "pick" && (
        <div className="card center">
          <p className="lead">Take a photo of your test paper, or choose one from your gallery.</p>
          <p className="hint">拍下考卷，或從相簿選一張照片。</p>
          <label className="btn primary">
            📷 Take photo
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <label className="btn">
            🖼 Choose from gallery
            <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
      )}

      {(phase.name === "adjust" || phase.name === "scanning") && (
        <div className="card">
          <p className="hint">Rotate until the text reads upright (if two pages are upside-down from each other, pick the one that reads best). 轉到文字正向。</p>
          <canvas ref={canvasRef} className="preview" aria-label="Photo preview" />
          <div className="row">
            <button className="btn" onClick={() => setRotation((r) => turn(r, -1))} disabled={phase.name === "scanning"} aria-label="Rotate left">
              ↺ Rotate left
            </button>
            <button className="btn" onClick={() => setRotation((r) => turn(r, 1))} disabled={phase.name === "scanning"} aria-label="Rotate right">
              ↻ Rotate right
            </button>
          </div>
          <div className="row">
            <button className="btn" onClick={reset} disabled={phase.name === "scanning"}>
              Choose another
            </button>
            <button className="btn primary" onClick={scan} disabled={phase.name === "scanning"}>
              {phase.name === "scanning" ? "Reading… (≈15 s)" : "Scan words 掃描"}
            </button>
          </div>
        </div>
      )}

      {/* Review stays mounted while saving (hidden) so its checkboxes survive a failed save. */}
      {(phase.name === "review" || (phase.name === "saving" && phase.review)) && (
        <div hidden={phase.name === "saving"}>
          <Review
            candidates={(phase.name === "review" ? phase : phase.review!).candidates}
            questionCount={(phase.name === "review" ? phase : phase.review!).questionCount}
            onSave={(items) => save(items, phase.name === "review" ? phase : phase.review!)}
            onBack={() => setPhase({ name: "adjust" })}
          />
        </div>
      )}

      {phase.name === "saving" && (
        <div className="card center" aria-busy="true">
          <p className="lead">Looking up {phase.count} words… 查詢中</p>
          <p className="hint">This can take up to a minute.</p>
        </div>
      )}

      {phase.name === "done" && (
        <div className="card center">
          <p className="lead">
            ✅ Saved {phase.result.saved.length} word{phase.result.saved.length === 1 ? "" : "s"}
          </p>
          {phase.result.skipped.length > 0 && <p className="hint">{phase.result.skipped.length} were already in your word bank.</p>}
          {phase.result.failed.length > 0 && (
            <>
              <p className="error">Couldn't look up: {phase.result.failed.join(", ")}.</p>
              <button className="btn primary" onClick={() => save(phase.retry, phase)}>
                Retry {phase.retry.length} failed
              </button>
            </>
          )}
          <button className="btn" onClick={onOpenWords}>
            Open word bank 單字庫
          </button>
          <button className="btn" onClick={reset}>
            Scan another page
          </button>
        </div>
      )}
    </section>
  );
}
