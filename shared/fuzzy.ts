// ═══════════════════════════════════════════════════════════
// Typo-tolerant text matching, used wherever people pick a vendor / material
// by typing ("sri lakshmi", "srilaxmi" and "shri lakshmi" should all find the same one).
// ═══════════════════════════════════════════════════════════

// Character ranges are built from code points so the source stays plain ASCII.
const range = (from: number, to: number) => String.fromCharCode(from) + "-" + String.fromCharCode(to);
const COMBINING_MARKS = new RegExp("[" + range(0x300, 0x36f) + "]", "g");
const NOT_SEARCHABLE = new RegExp("[^a-z0-9" + range(0xc00, 0xc7f) + "]+", "g");

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(NOT_SEARCHABLE, " ")
    .trim();

/** Levenshtein distance, giving up (returning max + 1) once it cannot be <= max. */
function distance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Rough sound-alike form, so common spelling variants of the same name meet
 * (lakshmi/laxmi, shri/sri, sreenivas/srinivas, bhaskar/baskar, vijay/wijay).
 */
const phonetic = (word: string): string =>
  word
    .replace(/ksh/g, 'x')
    .replace(/sh/g, 's')
    .replace(/ph/g, 'f')
    .replace(/(th|dh|bh|kh|gh|ch)/g, (m) => (m === 'ch' ? 'c' : m[0]))
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/(.)\1+/g, '$1');

/** How many typos a query word of this length may contain. */
const allowedTypos = (len: number): number => (len <= 2 ? 0 : len <= 4 ? 1 : 2);

/** Cost of matching one query word against the text's words; null when it does not match. */
function wordCost(word: string, textWords: string[], squashed: string): number | null {
  if (squashed.includes(word)) {
    // a whole-word / prefix hit is better than a hit buried inside another word
    return textWords.some((w) => w === word) ? 0 : textWords.some((w) => w.startsWith(word)) ? 0.1 : 0.3;
  }
  const max = allowedTypos(word.length);
  if (max === 0) return null;
  let best: number | null = null;
  for (const w of textWords) {
    // compare against the word itself and against its same-length prefix (partial typing)
    const full = distance(word, w, max);
    const prefix = w.length > word.length ? distance(word, w.slice(0, word.length), max) : max + 1;
    const d = Math.min(full, prefix + 0.5);
    if (d <= max && (best === null || d < best)) best = d;
  }
  return best === null ? null : 1 + best;
}

/**
 * Match score of `query` against `text`: 0 is a perfect hit, higher is a looser (typo'd) match,
 * null means no match. Every word typed must match something in the text.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query);
  if (!q) return 0;
  const t = normalize(text);
  if (!t) return null;
  const textWords = t.split(' ');
  const squashed = textWords.join('');
  const soundWords = textWords.map(phonetic);
  const soundSquashed = soundWords.join('');
  let total = 0;
  for (const word of q.split(' ')) {
    const spelled = wordCost(word, textWords, squashed);
    const sounded = wordCost(phonetic(word), soundWords, soundSquashed);
    const cost = spelled === null ? (sounded === null ? null : sounded + 0.4) : sounded === null ? spelled : Math.min(spelled, sounded + 0.4);
    if (cost === null) {
      // "srilakshmi" typed for "sri lakshmi": try the whole query against the squashed text
      const joined = q.replace(/ /g, '');
      if (joined.length > 3 && distance(joined, squashed.slice(0, joined.length + 2), allowedTypos(joined.length)) <= allowedTypos(joined.length)) {
        return 1.5;
      }
      return null;
    }
    total += cost;
  }
  return total;
}

/** Items matching `query` (any of the `texts(item)` strings), best matches first. */
export function fuzzyFilter<T>(items: readonly T[], query: string, texts: (item: T) => Array<string | null | undefined>): T[] {
  if (!normalize(query)) return [...items];
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    let best: number | null = null;
    for (const text of texts(item)) {
      if (!text) continue;
      const score = fuzzyScore(query, text);
      if (score !== null && (best === null || score < best)) best = score;
    }
    if (best !== null) scored.push({ item, score: best, index });
  });
  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.map((s) => s.item);
}
