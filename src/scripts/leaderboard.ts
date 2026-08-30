// Local-only high scores: persisted in localStorage on this device, no
// account and no backend. Kept outside src/scripts/game/ since it touches
// browser storage, unlike that folder's deterministic, dependency-free rule
// modules.

export interface ScoreEntry {
  score: number;
  distance: number;
}

const STORAGE_KEY = "downhill.local-scores.v1";
const MAX_ENTRIES = 5;

function isScoreEntry(value: unknown): value is ScoreEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ScoreEntry).score === "number" &&
    typeof (value as ScoreEntry).distance === "number"
  );
}

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScoreEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

// Adds a completed run's score, keeps only the top MAX_ENTRIES, and returns
// the updated list so the caller can render it immediately without a second
// read.
export function saveScore(entry: ScoreEntry): ScoreEntry[] {
  const scores = loadScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const top = scores.slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(top));
  } catch {
    // Storage can be unavailable (private browsing, quota) — the run still
    // finishes and shows its score, it just won't persist.
  }
  return top;
}
