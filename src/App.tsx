import { useEffect, useState } from "react";
import { api } from "./api";
import { ScanPage } from "./ScanPage";
import { WordsPage } from "./WordsPage";

type Tab = "scan" | "words";

export function App() {
  const [tab, setTab] = useState<Tab>("scan");
  const [email, setEmail] = useState("");
  // Bumped whenever words are saved so the word bank refetches.
  const [wordsVersion, setWordsVersion] = useState(0);

  useEffect(() => {
    api.me().then((m) => setEmail(m.email)).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>單字庫 <span>Vocab</span></h1>
        {email && <span className="who">{email}</span>}
      </header>

      {/* Both pages stay mounted so a half-finished scan survives a tab switch. */}
      <main>
        <div hidden={tab !== "scan"}>
          <ScanPage onSaved={() => setWordsVersion((v) => v + 1)} onOpenWords={() => setTab("words")} />
        </div>
        <div hidden={tab !== "words"}>
          <WordsPage active={tab === "words"} version={wordsVersion} />
        </div>
      </main>

      <nav className="tabs" aria-label="Main">
        <button className={tab === "scan" ? "on" : ""} onClick={() => setTab("scan")} aria-current={tab === "scan"}>
          📷 Scan <small>掃描</small>
        </button>
        <button className={tab === "words" ? "on" : ""} onClick={() => setTab("words")} aria-current={tab === "words"}>
          📚 Words <small>單字庫</small>
        </button>
      </nav>
    </div>
  );
}
