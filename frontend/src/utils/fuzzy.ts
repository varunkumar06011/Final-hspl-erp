/** True when `a` and `b` differ by at most one insert, delete, substitute or adjacent swap. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length || i === b.length) return true; // one extra character at the end
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** Does `query` match `text` as a substring, or word-by-word allowing one typo per word (4+ letters)? */
export function looseMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (t.includes(q)) return true;
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return q.split(/\s+/).every((qw) =>
    words.some((w) => w.startsWith(qw) || (qw.length >= 4 && (withinOneEdit(qw, w) || withinOneEdit(qw, w.slice(0, qw.length))))),
  );
}
