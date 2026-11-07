-- Word bank. One row per word (lemma); re-scanning a saved word does not duplicate it.
CREATE TABLE words (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lemma         TEXT NOT NULL COLLATE NOCASE UNIQUE,
  pos           TEXT NOT NULL DEFAULT '',
  definition_en TEXT NOT NULL,
  definition_zh TEXT NOT NULL,
  example       TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT '',   -- e.g. "98 指考"
  user_note     TEXT NOT NULL DEFAULT '',   -- the student's own handwritten gloss
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'learning', 'known')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_words_created_at ON words (created_at DESC);
