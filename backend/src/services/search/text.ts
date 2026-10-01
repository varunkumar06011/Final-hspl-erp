/**
 * Text utilities for the in-memory search index: normalisation, tokenisation,
 * fuzzy-matching helpers. Pure functions, no I/O.
 *
 * Most text is plain ASCII, so tokenisation takes a fast path with simple
 * character classes; anything else (Telugu, accented Latin) uses the slower
 * Unicode-aware path.
 */

const COMBINING_LATIN = /[\u{300}-\u{36f}]/gu;
const ASCII_ONLY = /^[\t\n\r -~]*$/; // printable ASCII + whitespace

const WORD_PARTS = /[\p{L}\p{N}\p{M}]+/gu;
const RUNS = /\p{L}[\p{L}\p{M}]*|\p{N}+/gu;
const ASCII_WORD_PARTS = /[a-z0-9]+/g;
const ASCII_RUNS = /[a-z]+|[0-9]+/g;

const HAS_DIGIT = /\p{N}/u;
const ONLY_DIGITS = /^\p{N}+$/u;
const ASCII_HAS_DIGIT = /[0-9]/;
const ASCII_ONLY_DIGITS = /^[0-9]+$/;

interface Scanner {
  parts: RegExp;
  runs: RegExp;
  hasDigit: RegExp;
  onlyDigits: RegExp;
}
const ASCII_SCANNER: Scanner = { parts: ASCII_WORD_PARTS, runs: ASCII_RUNS, hasDigit: ASCII_HAS_DIGIT, onlyDigits: ASCII_ONLY_DIGITS };
const UNICODE_SCANNER: Scanner = { parts: WORD_PARTS, runs: RUNS, hasDigit: HAS_DIGIT, onlyDigits: ONLY_DIGITS };

/** Lower-case, strip Latin diacritics, drop digit-group commas ("1,25,000" → "125000"). */
export function normalize(input: string): string {
  let s = ASCII_ONLY.test(input) ? input.toLowerCase() : input.normalize('NFKD').replace(COMBINING_LATIN, '').toLowerCase();
  if (s.includes(',')) s = s.replace(/(\d),(?=\d{2,3}(?!\d))/g, '$1');
  return s;
}

/** "00017" → "17", "000" → "0". */
export function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

function collapse(runs: string[], onlyDigits: RegExp): string {
  let out = '';
  for (const r of runs) out += onlyDigits.test(r) ? stripLeadingZeros(r) : r;
  return out;
}

/**
 * Variants of a single alphanumeric part that mean "the same thing" to a human:
 * "po017" ≈ "po17", "017" ≈ "17". Used on the query side as OR-alternatives.
 */
export function partVariants(part: string): string[] {
  const scan = ASCII_ONLY.test(part) ? ASCII_SCANNER : UNICODE_SCANNER;
  if (!scan.hasDigit.test(part)) return [part];
  const collapsed = collapse(part.match(scan.runs) ?? [], scan.onlyDigits);
  return collapsed && collapsed !== part ? [part, collapsed] : [part];
}

/**
 * Index-side tokenisation. Emits every form a user might later type:
 *   "VGH-PO017" → vgh, po017, po, 17, po17, vghpo017, vghpo17
 * so "po 17", "po17", "vgh po 017" and "vghpo017" all find it.
 */
export function tokenize(raw: string): string[] {
  const text = normalize(raw);
  const scan = ASCII_ONLY.test(text) ? ASCII_SCANNER : UNICODE_SCANNER;
  const out = new Set<string>();
  // Chunk on whitespace first so joined forms only combine code-like neighbours.
  for (const chunk of text.split(/\s+/)) {
    if (!chunk) continue;
    const parts = chunk.match(scan.parts);
    if (!parts) continue;
    for (const part of parts) {
      out.add(part);
      if (scan.hasDigit.test(part)) {
        const runs = part.match(scan.runs) ?? [];
        if (runs.length > 1 || scan.onlyDigits.test(part)) {
          for (const r of runs) out.add(scan.onlyDigits.test(r) ? stripLeadingZeros(r) : r);
          out.add(collapse(runs, scan.onlyDigits));
        }
      }
    }
    if (parts.length > 1 && parts.length <= 6 && chunk.length <= 48) {
      out.add(parts.join(''));
      let joined = '';
      for (const p of parts) {
        const v = partVariants(p);
        joined += v[v.length - 1];
      }
      out.add(joined);
    }
  }
  return [...out];
}

export interface QueryGroup {
  /** The user's word as typed (normalised). */
  text: string;
  /** Alternative spellings that count as the same term (OR). */
  variants: string[];
}

/** Query-side tokenisation: each typed part is a required term with OR-variants. */
export function queryGroups(raw: string): QueryGroup[] {
  const groups: QueryGroup[] = [];
  const seen = new Set<string>();
  for (const part of normalize(raw).match(WORD_PARTS) ?? []) {
    if (seen.has(part)) continue;
    seen.add(part);
    groups.push({ text: part, variants: partVariants(part) });
  }
  return groups;
}

/** Max typos tolerated for a query term of a given length. */
export function maxEdits(length: number): number {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  return 2;
}

/**
 * Optimal-string-alignment distance (insert / delete / substitute / adjacent
 * transposition), aborting early once the distance must exceed `limit`.
 * Returns limit + 1 when over the limit.
 */
export function editDistance(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > limit) return limit + 1;
  if (la === 0) return lb <= limit ? lb : limit + 1;
  if (lb === 0) return la <= limit ? la : limit + 1;

  let prev2: number[] = new Array(lb + 1).fill(0);
  let prev: number[] = new Array(lb + 1);
  let cur: number[] = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb] <= limit ? prev[lb] : limit + 1;
}

/** Padded character trigrams: "cement" → ^ce, cem, eme, men, ent, nt$ (L grams for length L). */
export function trigrams(term: string): string[] {
  const padded = `^${term}$`;
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) grams.push(padded.slice(i, i + 3));
  return grams;
}

/** Unpadded trigrams, for substring lookups. */
export function innerTrigrams(term: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i + 3 <= term.length; i++) grams.push(term.slice(i, i + 3));
  return grams;
}
