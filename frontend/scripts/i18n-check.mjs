#!/usr/bin/env node
/**
 * i18n safety net — run with `npm run i18n:check` (from frontend/ or the repo root).
 *
 * FAILS (exit 1) when:
 *   1. an English key has no Telugu twin (or the reverse) in any locale file, or
 *   2. source code calls t('some.key') / <Trans i18nKey="some.key"> for a key that
 *      does not exist in the file's namespace(s).
 *
 * WARNS (never fails, unless --strict) when a .tsx file still contains what looks
 * like hardcoded English UI text (JSX text, label=/placeholder=/title= props).
 * That is how newly added, untranslated UI gets noticed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const localeDir = path.join(srcDir, 'i18n', 'locales');
const strict = process.argv.includes('--strict');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const flat = (o, p = '') =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`],
  );

// ── Load locales: { en: { translation: Set, po: Set, ... }, te: {...} } ──
const locales = { en: {}, te: {} };
for (const lang of ['en', 'te']) {
  locales[lang].translation = new Set(flat(read(path.join(localeDir, `${lang}.json`))));
  const dir = path.join(localeDir, lang);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      locales[lang][f.replace(/\.json$/, '')] = new Set(flat(read(path.join(dir, f))));
    }
  }
}

const errors = [];
const warnings = [];

// ── 1. en ↔ te parity (plural suffixes are treated as the same base key) ──
const base = (k) => k.replace(/_(zero|one|two|few|many|other)$/, '');
for (const ns of new Set([...Object.keys(locales.en), ...Object.keys(locales.te)])) {
  const en = new Set([...(locales.en[ns] ?? [])].map(base));
  const te = new Set([...(locales.te[ns] ?? [])].map(base));
  for (const k of en) if (!te.has(k)) errors.push(`[${ns}] missing in Telugu: ${k}`);
  for (const k of te) if (!en.has(k)) errors.push(`[${ns}] missing in English: ${k}`);
}

// ── 2. keys used in source must exist ──
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : walk(p);
    return /\.(tsx?|jsx?)$/.test(e.name) ? [p] : [];
  });
}

const HARD = [
  { re: />\s*([A-Z][A-Za-z][A-Za-z ,.'&/()-]{3,})\s*</g, why: 'JSX text' },
  { re: /\b(?:label|placeholder|title|helperText|aria-label)="([A-Za-z][^"{}]{3,})"/g, why: 'prop text' },
];

for (const file of walk(srcDir)) {
  const rel = path.relative(srcDir, file).replace(/\\/g, '/');
  const src = fs.readFileSync(file, 'utf8');

  const nsList = [];
  for (const m of src.matchAll(/useTranslation\(\s*(?:'([^']+)'|\[([^\]]*)\])?/g)) {
    if (m[1]) nsList.push(m[1]);
    else if (m[2]) for (const x of m[2].matchAll(/'([^']+)'/g)) nsList.push(x[1]);
    else nsList.push('translation');
  }
  const usesTranslation = /useTranslation|i18n\.t\(|from '\.\.\/i18n'|from '\.\/i18n'/.test(src);

  const used = new Set();
  for (const m of src.matchAll(/\b(?:t|tr|i18n\.t)\(\s*'([A-Za-z0-9_.:]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/i18nKey="([A-Za-z0-9_.:]+)"/g)) used.add(m[1]);

  for (const key of used) {
    let ns = null;
    let k = key;
    if (key.includes(':')) [ns, k] = key.split(':');
    const candidates = ns ? [ns] : nsList.length ? nsList : ['translation'];
    const found = candidates.some((c) => {
      const has = (lang) => {
        const s = locales[lang][c];
        return s && (s.has(k) || s.has(`${k}_one`) || s.has(`${k}_other`));
      };
      return has('en') && has('te');
    });
    if (!found) errors.push(`${rel}: key "${key}" not found in [${candidates.join(', ')}] (en+te)`);
  }

  // ── 3. hardcoded-text heuristic (warning only) ──
  if (file.endsWith('.tsx') && !/LegalLayout|PrivacyPolicy|TermsConditions/.test(file)) {
    let count = 0;
    const samples = [];
    for (const { re } of HARD) {
      for (const m of src.matchAll(re)) {
        const text = m[1].trim();
        if (/^(px|rem|em|flex|grid|center|left|right|none|auto|block|inline|column|row|bold|small|medium|large|contained|outlined|text|primary|secondary|error|warning|info|success|inherit|default|button|submit|number|date|time|file|image|hidden|http)/i.test(text)) continue;
        count++;
        if (samples.length < 3) samples.push(text.slice(0, 40));
      }
    }
    if (count > 0) warnings.push(`${rel}${usesTranslation ? '' : ' (not translated at all)'}: ~${count} possible hardcoded strings, e.g. ${samples.map((s) => `"${s}"`).join(', ')}`);
  }
}

if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} file(s) may still contain hardcoded English text:`);
  for (const w of warnings) console.log('   -', w);
}
if (errors.length) {
  console.log(`\n✖  ${errors.length} translation problem(s):`);
  for (const e of errors) console.log('   -', e);
  process.exit(1);
}
if (strict && warnings.length) process.exit(1);
console.log('\n✔  i18n check passed (English and Telugu keys match, all used keys exist).');
