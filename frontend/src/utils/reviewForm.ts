import { dateLocale } from '../i18n';

/**
 * Reads what a person has typed or chosen in a form, for the "check before you create"
 * step. It reads the form as it is on screen (label + the value shown), so every create
 * dialog gets its summary without describing its fields a second time. Names show as the
 * name the person picked, never as an internal id.
 *
 * Opt a field in or out by hand:
 *   data-review-label="Bill file" data-review-value="bill.jpg"   adds a row
 *   data-review-skip                                              leaves the element out
 */

export interface ReviewRow {
  label: string;
  value: string;
}

export interface ReviewData {
  /** Single fields, in the order they appear in the form. */
  fields: ReviewRow[];
  /** Fields that repeat (item lines), grouped one group per line. */
  lines: ReviewRow[][];
}

const MAX_ROWS = 300;

// zero-width space: MUI puts one in an empty Select
const ZERO_WIDTH = new RegExp(String.fromCharCode(0x200b), 'g');
const clean = (s: string | null | undefined) => (s ?? '').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
/** MUI marks a required label with a trailing " *". */
const noStar = (s: string) => s.replace(/\s*\*+\s*$/, '').trim();

function textOf(el: Element | null | undefined): string {
  return el ? noStar(clean(el.textContent)) : '';
}

function labelOf(el: HTMLElement, root: Element): string {
  if (el.id) {
    const byFor = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (byFor) return textOf(byFor);
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return noStar(clean(aria));
  const control = el.closest('.MuiFormControl-root');
  const inControl = control?.querySelector('label, .MuiFormLabel-root');
  if (inControl) return textOf(inControl);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const first = by.split(/\s+/)[0];
    const target = first ? root.querySelector(`#${CSS.escape(first)}`) : null;
    if (target) return textOf(target);
  }
  return noStar(clean(el.getAttribute('placeholder')));
}

function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function rowsOf(root: Element): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const add = (label: string, value: string) => {
    const v = clean(value);
    if (v && rows.length < MAX_ROWS) rows.push({ label: clean(label), value: v });
  };
  const seenGroups = new Set<Element>();

  const nodes = root.querySelectorAll<HTMLElement>(
    'input, textarea, select, [role="combobox"], .MuiToggleButtonGroup-root, [data-review-label]'
  );
  nodes.forEach((el) => {
    if (el.closest('[data-review-skip], .MuiPopover-root, .MuiAutocomplete-popper, .MuiMenu-root')) return;

    // a hand-described row
    if (el.hasAttribute('data-review-label')) {
      add(el.getAttribute('data-review-label') ?? '', el.getAttribute('data-review-value') ?? '');
      return;
    }

    // buttons that switch between a few choices (payment mode, ...): the chosen one
    if (el.classList.contains('MuiToggleButtonGroup-root')) {
      const chosen = [...el.querySelectorAll('[aria-pressed="true"]')].map(textOf).filter(Boolean).join(', ');
      const caption = el.previousElementSibling ?? el.parentElement?.previousElementSibling;
      const cap = caption && clean(caption.textContent).length <= 60 ? textOf(caption) : '';
      add(cap, chosen);
      return;
    }

    // MUI Select shows its choice in a div; the real value sits in a hidden input
    if (el.tagName === 'DIV' && el.getAttribute('role') === 'combobox') {
      const native = el.parentElement?.querySelector<HTMLInputElement>('input.MuiSelect-nativeInput');
      if (native && native.value === '') return;
      add(labelOf(el, root), textOf(el));
      return;
    }

    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (el.classList.contains('MuiSelect-nativeInput')) return;
    if (el.getAttribute('aria-hidden') === 'true') return; // MUI's hidden textarea twin
    if (el instanceof HTMLInputElement && ['hidden', 'file', 'password', 'button', 'submit', 'image'].includes(el.type)) return;
    if (!el.getClientRects().length) return; // not on screen

    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      if (!el.checked) return;
      const option = textOf(el.closest('label'));
      if (el.type === 'radio') {
        const group = el.closest('.MuiFormControl-root')?.querySelector('legend, .MuiFormLabel-root');
        add(textOf(group), option);
      } else {
        add(option || labelOf(el, root), '✓');
      }
      return;
    }

    if (el instanceof HTMLSelectElement) {
      add(labelOf(el, root), el.selectedOptions[0]?.textContent ?? '');
      return;
    }

    let value = el.value;
    if (el instanceof HTMLInputElement && el.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) value = prettyDate(value);

    // an Autocomplete that holds several choices shows them as chips next to the input
    const auto = el.closest('.MuiAutocomplete-root');
    if (auto && !seenGroups.has(auto)) {
      seenGroups.add(auto);
      const chips = [...auto.querySelectorAll('.MuiChip-label')].map(textOf).filter(Boolean);
      if (chips.length) value = [...chips, clean(value)].filter(Boolean).join(', ');
    }
    add(labelOf(el, root), value);
  });
  return rows;
}

/** Splits rows into single fields and repeated "line" groups (one group per item row). */
export function readFormForReview(root: Element): ReviewData {
  const rows = rowsOf(root);
  const count = new Map<string, number>();
  rows.forEach((r) => r.label && count.set(r.label, (count.get(r.label) ?? 0) + 1));

  const fields: ReviewRow[] = [];
  const lines: ReviewRow[][] = [];
  let current: ReviewRow[] = [];
  for (const r of rows) {
    if (!r.label || (count.get(r.label) ?? 0) < 2) {
      fields.push(r);
      continue;
    }
    // the same label again means the next line has started
    if (current.some((c) => c.label === r.label)) {
      lines.push(current);
      current = [];
    }
    current.push(r);
  }
  if (current.length) lines.push(current);
  return { fields, lines };
}

/** The dialog currently on top, ignoring any review dialog itself. */
export function topDialogPaper(): Element | null {
  const papers = [...document.querySelectorAll('.MuiDialog-paper')].filter(
    (p) => !p.closest('[data-review-dialog]') && p.getClientRects().length > 0
  );
  return papers[papers.length - 1] ?? null;
}
