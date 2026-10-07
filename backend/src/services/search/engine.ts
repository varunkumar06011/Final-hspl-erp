/**
 * In-memory full-text index: weighted inverted index + trigram vocabulary for
 * typo / partial-word tolerance + one-hop "referrer" edges so a record is also
 * found through the records it points at (a PO through its vendor's name).
 *
 * Pure data structure — knows nothing about Prisma, projects or permissions.
 * Postings are compact parallel arrays keyed by term id, and scoring runs on
 * typed arrays, so a project with tens of thousands of records stays small and
 * answers in a few milliseconds.
 */
import {
  editDistance,
  innerTrigrams,
  maxEdits,
  normalize,
  queryGroups,
  tokenize,
  trigrams,
  type QueryGroup,
} from './text';

export interface Section {
  /** Human label, e.g. "Notes" or "PO Item". */
  label: string;
  /** Stable key for translation lookups (column or model name). */
  labelKey: string;
  /** What the user sees. */
  text: string;
  /** What gets tokenised when it differs from `text` (extra spellings of dates, big numbers). */
  index?: string;
  /** Relative importance for ranking (identifiers/names high, free text low). */
  weight: number;
  kind: 'self' | 'child';
  /** Display-only detail shown next to child text (quantities, rates). */
  extra?: string;
}

export interface DocInput {
  key: string;
  model: string;
  id: string;
  title: string;
  subtitle: string;
  path: string | null;
  status?: string;
  amount?: number;
  date?: string;
  sections: Section[];
  /** Keys of records this one points at (vendor, PO, …). */
  refs: string[];
  /** Last-modified time, used as a ranking tie-break. */
  stamp: number;
}

interface Doc extends DocInput {
  no: number;
  /** Distinct indexed terms (for length normalisation). */
  len: number;
  /** Term ids this document is posted under (for removal and snippets). */
  terms: Int32Array;
}

export interface Mark {
  start: number;
  end: number;
}

export interface MatchSnippet {
  label: string;
  labelKey: string;
  text: string;
  marks: Mark[];
  extra?: string;
}

export interface Related {
  model: string;
  id: string;
  title: string;
}

export interface SearchHit {
  key: string;
  model: string;
  id: string;
  title: string;
  titleMarks: Mark[];
  subtitle: string;
  path: string | null;
  status?: string;
  amount?: number;
  date?: string;
  score: number;
  matches: MatchSnippet[];
  /** Set when the record matched through a record it points at. */
  via?: Related;
  /** Records this one points at (vendor, PO…), for context under the title. */
  related: Related[];
}

export interface SearchOutput {
  hits: SearchHit[];
  /** Matches per model before per-type trimming. */
  counts: Record<string, number>;
  total: number;
}

export interface SearchOptions {
  limit: number;
  perTypeLimit: number;
  /** Return false to hide a doc (permissions). */
  allow?: (doc: { model: string; id: string; path: string | null }) => boolean;
}

const K1 = 1.2;
const B = 0.25;
const REFERRER_DISCOUNT = 0.5;
const MAX_TERMS_PER_GROUP = 400;
const MAX_PROPAGATION_SOURCES = 3000;
const MAX_TF = 8;
/** Only the best candidates get the (string-heavy) exact-title bonus. */
const RERANK_POOL = 300;

interface GroupResult {
  accepted: Map<number, number>;
  scores: Float64Array;
  /** Doc number the score was inherited from; 0 = matched directly. */
  via: Int32Array;
  touched: number[];
}

export class SearchIndex {
  private docs: (Doc | undefined)[] = [undefined]; // doc number → doc; slot 0 unused
  private live = 0;
  private byKey = new Map<string, number>();
  private referrers = new Map<string, Set<number>>();
  private totalLen = 0;

  // Vocabulary + postings, keyed by term id.
  private termIds = new Map<string, number>();
  private termList: string[] = [];
  private postDocs: number[][] = [];
  private postWeights: number[][] = [];
  private grams = new Map<string, number[]>();
  private sorted: string[] | null = null;
  private tokenCache = new Map<string, string[]>();

  get size(): number {
    return this.live;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  // ── writes ────────────────────────────────────────────────────────────────

  private tokens(text: string): string[] {
    if (text.length > 80) return tokenize(text);
    let t = this.tokenCache.get(text);
    if (!t) {
      if (this.tokenCache.size > 20000) this.tokenCache.clear();
      this.tokenCache.set(text, (t = tokenize(text)));
    }
    return t;
  }

  private termId(token: string): number {
    let id = this.termIds.get(token);
    if (id !== undefined) return id;
    id = this.termList.length;
    this.termIds.set(token, id);
    this.termList.push(token);
    this.postDocs.push([]);
    this.postWeights.push([]);
    for (const gram of new Set(trigrams(token))) {
      const list = this.grams.get(gram);
      if (list) list.push(id);
      else this.grams.set(gram, [id]);
    }
    return id;
  }

  upsert(input: DocInput): void {
    this.remove(input.key);
    const no = this.docs.length;

    const weights = new Map<number, number>();
    const bump = (token: string, w: number, mode: 'add' | 'max') => {
      const id = this.termId(token);
      const prev = weights.get(id) ?? 0;
      weights.set(id, Math.min(MAX_TF, mode === 'add' ? prev + w : Math.max(prev, w)));
    };
    for (const section of input.sections) {
      for (const token of this.tokens(section.index ?? section.text)) bump(token, section.weight, 'add');
    }
    // The title is always searchable even if the schema marked it elsewhere.
    for (const token of this.tokens(input.title)) bump(token, 3, 'max');

    const terms = new Int32Array(weights.size);
    let i = 0;
    for (const [id, w] of weights) {
      const docsOfTerm = this.postDocs[id];
      if (docsOfTerm.length === 0) this.sorted = null; // a term that was dropped earlier is back
      docsOfTerm.push(no);
      this.postWeights[id].push(w);
      terms[i++] = id;
    }

    const doc: Doc = { ...input, no, len: terms.length, terms };
    this.docs.push(doc);
    this.byKey.set(input.key, no);
    this.live++;
    this.totalLen += doc.len;
    for (const ref of new Set(input.refs)) {
      let set = this.referrers.get(ref);
      if (!set) this.referrers.set(ref, (set = new Set()));
      set.add(no);
    }
  }

  remove(key: string): boolean {
    const no = this.byKey.get(key);
    if (no === undefined) return false;
    const doc = this.docs[no]!;
    for (const id of doc.terms) {
      const ds = this.postDocs[id];
      const ws = this.postWeights[id];
      const at = ds.indexOf(no);
      if (at === -1) continue;
      const last = ds.length - 1;
      ds[at] = ds[last];
      ws[at] = ws[last];
      ds.pop();
      ws.pop();
    }
    for (const ref of new Set(doc.refs)) {
      const set = this.referrers.get(ref);
      if (!set) continue;
      set.delete(no);
      if (set.size === 0) this.referrers.delete(ref);
    }
    this.totalLen -= doc.len;
    this.live--;
    this.docs[no] = undefined;
    this.byKey.delete(key);
    this.sorted = null;
    return true;
  }

  // ── vocabulary lookups ────────────────────────────────────────────────────

  private isLive(id: number): boolean {
    return this.postDocs[id].length > 0;
  }

  private sortedTerms(): string[] {
    if (!this.sorted) {
      const live: string[] = [];
      this.termList.forEach((t, id) => {
        if (this.isLive(id)) live.push(t);
      });
      this.sorted = live.sort();
    }
    return this.sorted;
  }

  private prefixTerms(prefix: string, cap: number): string[] {
    const list = this.sortedTerms();
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < list.length && list[i].startsWith(prefix) && out.length < cap; i++) out.push(list[i]);
    return out;
  }

  /** Indexed terms a typed word could mean, with a 0..1 closeness. */
  private expand(variant: string): Map<number, number> {
    const found = new Map<number, number>();
    const put = (id: number | undefined, quality: number) => {
      if (id === undefined || !this.isLive(id)) return;
      if ((found.get(id) ?? 0) < quality) found.set(id, quality);
    };

    put(this.termIds.get(variant), 1);

    const len = [...variant].length;
    if (len >= 2) for (const t of this.prefixTerms(variant, 250)) put(this.termIds.get(t), t === variant ? 1 : 0.85);

    // Digits and codes: exact + prefix only — fuzzy/substring on numbers is noise.
    if (/\p{N}/u.test(variant)) return found;

    if (len >= 3) {
      // Substring ("ement" → "cement"): start from the rarest trigram list.
      let best: number[] | undefined;
      for (const g of new Set(innerTrigrams(variant))) {
        const list = this.grams.get(g);
        if (!list) {
          best = undefined;
          break;
        }
        if (!best || list.length < best.length) best = list;
      }
      if (best) {
        let checked = 0;
        for (const id of best) {
          if (checked++ > 6000) break;
          const t = this.termList[id];
          if (t !== variant && t.includes(variant)) put(id, 0.6);
        }
      }
    }

    const k = maxEdits(len);
    if (k > 0) {
      const need = Math.max(1, len - 4 * k); // padded trigrams a k-edit neighbour must still share (a swap breaks up to 4)
      const counts = new Map<number, number>();
      for (const g of new Set(trigrams(variant))) {
        const list = this.grams.get(g);
        if (!list) continue;
        for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (const [id, shared] of counts) {
        if (shared < need || !this.isLive(id)) continue;
        const t = this.termList[id];
        if (/\p{N}/u.test(t)) continue;
        const d = editDistance(variant, t, k);
        if (d > 0 && d <= k) put(id, 0.75 - 0.15 * (d - 1));
        // Typo inside a longer word the user is still typing ("cemnt" → "cement").
        else if (d > k && t.length > variant.length) {
          const pd = editDistance(variant, t.slice(0, variant.length), k);
          if (pd > 0 && pd <= k) put(id, 0.55);
        }
      }
    }
    return found;
  }

  // ── search ────────────────────────────────────────────────────────────────

  private scoreGroup(group: QueryGroup, allow?: SearchOptions['allow']): GroupResult {
    const merged = new Map<number, number>();
    for (const variant of group.variants) {
      for (const [id, quality] of this.expand(variant)) {
        if ((merged.get(id) ?? 0) < quality) merged.set(id, quality);
      }
    }
    let entries = [...merged];
    if (entries.length > MAX_TERMS_PER_GROUP) {
      entries.sort((a, b) => b[1] - a[1]);
      entries = entries.slice(0, MAX_TERMS_PER_GROUP);
    }
    const accepted = new Map(entries);

    const slots = this.docs.length;
    const scores = new Float64Array(slots);
    const via = new Int32Array(slots);
    const touched: number[] = [];
    const n = this.live;
    const avgLen = n ? this.totalLen / n : 1;

    for (const [id, quality] of entries) {
      const ds = this.postDocs[id];
      const ws = this.postWeights[id];
      const df = ds.length;
      if (df === 0) continue;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      for (let i = 0; i < df; i++) {
        const no = ds[i];
        const wtf = ws[i];
        const norm = 1 - B + B * (this.docs[no]!.len / avgLen);
        const s = quality * idf * ((wtf * (K1 + 1)) / (wtf + K1 * norm));
        if (scores[no] === 0) touched.push(no);
        if (s > scores[no]) scores[no] = s;
      }
    }

    // One hop outwards: records that point at a matching record inherit part
    // of its score ("ABC Traders" → every PO/invoice of that vendor).
    const direct = touched.length;
    if (direct > 0 && direct <= MAX_PROPAGATION_SOURCES) {
      for (let i = 0; i < direct; i++) {
        const no = touched[i];
        const source = this.docs[no]!;
        // Never let a record the viewer cannot see lend its text (or its name) to another.
        if (allow && !allow(source)) continue;
        const referrers = this.referrers.get(source.key);
        if (!referrers) continue;
        const s = scores[no] * REFERRER_DISCOUNT;
        for (const refNo of referrers) {
          if (scores[refNo] === 0) {
            touched.push(refNo);
            scores[refNo] = s;
            via[refNo] = no;
          } else if (via[refNo] !== 0 && s > scores[refNo]) {
            scores[refNo] = s;
            via[refNo] = no;
          }
        }
      }
    }
    return { accepted, scores, via, touched };
  }

  search(query: string, options: SearchOptions): SearchOutput {
    const groups = queryGroups(query);
    if (groups.length === 0 || this.live === 0) return { hits: [], counts: {}, total: 0 };

    const results = groups.map((g) => this.scoreGroup(g, options.allow));
    const slots = this.docs.length;
    const coverage = new Uint8Array(slots);
    const total = new Float64Array(slots);
    const via = new Int32Array(slots);
    const seen: number[] = [];
    let maxCoverage = 0;
    for (const r of results) {
      for (const no of r.touched) {
        if (coverage[no] === 0) seen.push(no);
        const c = ++coverage[no];
        if (c > maxCoverage) maxCoverage = c;
        total[no] += r.scores[no];
        if (r.via[no] !== 0 && via[no] === 0) via[no] = r.via[no];
      }
    }
    if (maxCoverage === 0) return { hits: [], counts: {}, total: 0 };

    // Everything the user typed matched → only those. Otherwise the best partial matches.
    const candidates: number[] = [];
    const counts: Record<string, number> = {};
    for (const no of seen) {
      if (coverage[no] < maxCoverage) continue;
      const doc = this.docs[no]!;
      if (options.allow && !options.allow(doc)) continue;
      candidates.push(no);
      counts[doc.model] = (counts[doc.model] ?? 0) + 1;
    }
    const byScore = (a: number, b: number) => total[b] - total[a] || this.docs[b]!.stamp - this.docs[a]!.stamp;
    candidates.sort(byScore);

    // Exact / leading title matches float to the top of the best candidates.
    const nq = normalize(query).trim();
    const pool = candidates.slice(0, RERANK_POOL);
    const finalScore = new Map<number, number>();
    for (const no of pool) {
      const nt = normalize(this.docs[no]!.title);
      const bonus = nt === nq ? 6 : nt.startsWith(nq) ? 3 : nt.includes(nq) ? 1.5 : 0;
      finalScore.set(no, total[no] + bonus);
    }
    pool.sort((a, b) => finalScore.get(b)! - finalScore.get(a)! || this.docs[b]!.stamp - this.docs[a]!.stamp);

    const perType: Record<string, number> = {};
    const hits: SearchHit[] = [];
    for (const no of pool) {
      if (hits.length >= options.limit) break;
      const doc = this.docs[no]!;
      const used = perType[doc.model] ?? 0;
      if (used >= options.perTypeLimit) continue;
      perType[doc.model] = used + 1;

      const matched = new Set<string>();
      for (const id of doc.terms) {
        if (results.some((r) => r.accepted.has(id))) matched.add(this.termList[id]);
      }
      hits.push(this.toHit(doc, finalScore.get(no)!, matched, via[no], options.allow));
    }
    return { hits, counts, total: candidates.length };
  }

  private toHit(doc: Doc, score: number, matched: Set<string>, viaNo: number, allow?: SearchOptions['allow']): SearchHit {
    const hit: SearchHit = {
      key: doc.key,
      model: doc.model,
      id: doc.id,
      title: doc.title,
      titleMarks: markWords(doc.title, matched),
      subtitle: doc.subtitle,
      path: doc.path,
      status: doc.status,
      amount: doc.amount,
      date: doc.date,
      score: Math.round(score * 100) / 100,
      matches: [],
      related: [],
    };
    for (const ref of doc.refs) {
      const target = this.docs[this.byKey.get(ref) ?? 0];
      if (target && hit.related.length < 2 && (!allow || allow(target))) {
        hit.related.push({ model: target.model, id: target.id, title: target.title });
      }
    }
    const parent = viaNo ? this.docs[viaNo] : undefined;
    if (parent && (!allow || allow(parent))) hit.via = { model: parent.model, id: parent.id, title: parent.title };

    if (matched.size > 0) {
      const scored: { section: Section; marks: Mark[] }[] = [];
      for (const section of doc.sections) {
        if (section.kind === 'self' && section.text === doc.title) continue;
        const marks = markWords(section.text, matched);
        if (marks.length > 0) scored.push({ section, marks });
      }
      scored.sort((a, b) => b.marks.length - a.marks.length || b.section.weight - a.section.weight);
      for (const { section, marks } of scored.slice(0, 4)) {
        const clipped = clip(section.text, marks);
        hit.matches.push({
          label: section.label,
          labelKey: section.labelKey,
          text: clipped.text,
          marks: clipped.marks,
          extra: section.extra,
        });
      }
    }
    return hit;
  }
}

const WORD = /[\p{L}\p{N}\p{M}]+/gu;

/** Ranges of words in `text` whose tokens are among the matched index terms. */
export function markWords(text: string, matched: Set<string>): Mark[] {
  if (matched.size === 0) return [];
  const marks: Mark[] = [];
  for (const m of text.matchAll(WORD)) {
    const word = m[0];
    if (tokenize(word).some((t) => matched.has(t))) {
      marks.push({ start: m.index ?? 0, end: (m.index ?? 0) + word.length });
    }
  }
  return marks;
}

/** Trim long text to a window around the first highlight, re-basing marks. */
export function clip(text: string, marks: Mark[], width = 150): { text: string; marks: Mark[] } {
  if (text.length <= width) return { text, marks };
  const first = marks[0]?.start ?? 0;
  const start = Math.max(0, Math.min(first - 40, text.length - width));
  const end = Math.min(text.length, start + width);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const shifted = marks
    .filter((m) => m.start >= start && m.end <= end)
    .map((m) => ({ start: m.start - start + prefix.length, end: m.end - start + prefix.length }));
  return { text: prefix + text.slice(start, end) + suffix, marks: shifted };
}
