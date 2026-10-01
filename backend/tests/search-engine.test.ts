import { describe, it, expect } from 'vitest';
import { SearchIndex, type DocInput, type Section } from '../src/services/search/engine';
import { editDistance, queryGroups, tokenize } from '../src/services/search/text';

const sec = (label: string, text: string, weight = 1, kind: Section['kind'] = 'self'): Section => ({
  label,
  labelKey: label,
  text,
  weight,
  kind,
});

function doc(model: string, id: string, title: string, sections: Section[] = [], refs: string[] = []): DocInput {
  return {
    key: `${model}:${id}`,
    model,
    id,
    title,
    subtitle: '',
    path: `/${model}?id=${id}`,
    sections: [sec('Number', title, 3), ...sections],
    refs,
    stamp: 0,
  };
}

const search = (index: SearchIndex, q: string, extra: Partial<Parameters<SearchIndex['search']>[1]> = {}) =>
  index.search(q, { limit: 20, perTypeLimit: 20, ...extra });

describe('tokenize', () => {
  it('emits every spelling of a document code', () => {
    const t = tokenize('VGH-PO017');
    expect(t).toEqual(expect.arrayContaining(['vgh', 'po017', 'po', '17', 'po17', 'vghpo017', 'vghpo17']));
  });

  it('treats lakh/thousand separators as one number', () => {
    expect(tokenize('Total 1,25,000')).toContain('125000');
  });

  it('keeps Telugu words intact', () => {
    expect(tokenize('సిమెంట్ సరఫరా')).toEqual(['సిమెంట్', 'సరఫరా']);
  });

  it('folds diacritics', () => {
    expect(tokenize('Café')).toContain('cafe');
  });
});

describe('queryGroups', () => {
  it('makes each typed part a required term with zero-stripped alternatives', () => {
    expect(queryGroups('PO 017')).toEqual([
      { text: 'po', variants: ['po'] },
      { text: '017', variants: ['017', '17'] },
    ]);
  });
});

describe('editDistance', () => {
  it('counts a transposition as one edit', () => {
    expect(editDistance('cmeent', 'cement', 2)).toBe(1);
  });
  it('gives up beyond the limit', () => {
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
  });
});

describe('SearchIndex', () => {
  function build(): SearchIndex {
    const index = new SearchIndex();
    index.upsert(doc('Vendor', 'v1', 'ABC Traders', [sec('Address', 'Plot 4 Industrial Area Hyderabad')]));
    index.upsert(doc('Vendor', 'v2', 'Sri Lakshmi Hardware'));
    index.upsert(
      doc(
        'PurchaseOrder',
        'p1',
        'VGH-PO017',
        [
          sec('PO item', 'Cement 53 Grade OPC · bags', 3, 'child'),
          sec('PO item', 'TMT Steel Bar 12mm · kg', 3, 'child'),
          sec('Notes', 'Deliver to basement block before monsoon'),
        ],
        ['Vendor:v1'],
      ),
    );
    index.upsert(doc('PurchaseOrder', 'p2', 'VGH-PO018', [sec('PO item', 'Plumbing pipes PVC 4 inch', 3, 'child')], ['Vendor:v2']));
    index.upsert(doc('PurchaseOrder', 'p3', 'VGH-PO019', [sec('PO item', 'Electrical wire 2.5 sqmm', 3, 'child')], ['Vendor:v1']));
    return index;
  }

  it('finds a PO from a material and shows the matching line', () => {
    const { hits } = search(build(), 'cement');
    expect(hits[0].key).toBe('PurchaseOrder:p1');
    expect(hits[0].matches[0]).toMatchObject({ label: 'PO item', text: 'Cement 53 Grade OPC · bags' });
    expect(hits[0].matches[0].marks).toEqual([{ start: 0, end: 6 }]);
  });

  it('survives spelling mistakes', () => {
    const index = build();
    for (const typo of ['sement', 'cemnt', 'cmeent', 'plumbng', 'electrcal']) {
      expect(search(index, typo).hits.length, typo).toBeGreaterThan(0);
    }
    expect(search(index, 'plumbng').hits[0].key).toBe('PurchaseOrder:p2');
    // The typo'd word is still highlighted in the original text.
    expect(search(index, 'plumbng').hits[0].matches[0].marks.length).toBe(1);
  });

  it('matches partial words and the middle of words', () => {
    const index = build();
    expect(search(index, 'cem').hits[0].key).toBe('PurchaseOrder:p1');
    expect(search(index, 'ement').hits[0].key).toBe('PurchaseOrder:p1');
    expect(search(index, 'monso').hits[0].key).toBe('PurchaseOrder:p1');
  });

  it('finds a document code however it is typed', () => {
    const index = build();
    for (const q of ['VGH-PO017', 'vgh po 17', 'po017', 'po17', 'vghpo017', 'PO 017']) {
      expect(search(index, q).hits[0]?.key, q).toBe('PurchaseOrder:p1');
    }
  });

  it('requires every typed word, but still shows the best partial match', () => {
    const index = build();
    expect(search(index, 'cement steel').hits.map((h) => h.key)).toEqual(['PurchaseOrder:p1']);
    // "zzzz" matches nothing, so the rest of the query decides.
    expect(search(index, 'cement zzzz').hits[0].key).toBe('PurchaseOrder:p1');
    expect(search(index, 'zzzz').hits).toEqual([]);
  });

  it('finds records through the record they point at', () => {
    const { hits } = search(build(), 'abc cement');
    expect(hits[0].key).toBe('PurchaseOrder:p1');
    expect(hits[0].via).toMatchObject({ model: 'Vendor', title: 'ABC Traders' });
    expect(hits[0].related[0]).toMatchObject({ title: 'ABC Traders' });

    // Both of ABC's POs come back for "abc wire", the wire one first.
    const wire = search(build(), 'abc wire');
    expect(wire.hits[0].key).toBe('PurchaseOrder:p3');
  });

  it('does not let a hidden record lend its text or name to the records pointing at it', () => {
    const index = build();
    const hiddenVendors = (d: { model: string }) => d.model !== 'Vendor';
    // "abc" only exists on the vendor; with vendors hidden, its POs must not match through it.
    expect(search(index, 'abc', { allow: hiddenVendors }).hits).toEqual([]);
    const shown = search(index, 'cement', { allow: hiddenVendors }).hits[0];
    expect(shown.related).toEqual([]);
    expect(shown.via).toBeUndefined();
  });

  it('ranks the exact title above incidental matches', () => {
    const index = build();
    index.upsert(doc('Issue', 'i1', 'Delay in VGH-PO017 delivery'));
    expect(search(index, 'VGH-PO017').hits[0].key).toBe('PurchaseOrder:p1');
  });

  it('applies the permission filter and reports counts', () => {
    const index = build();
    const out = search(index, 'abc', { allow: (d) => d.model !== 'Vendor' });
    expect(out.hits.every((h) => h.model === 'PurchaseOrder')).toBe(true);
    const all = search(index, 'abc');
    expect(all.counts.Vendor).toBe(1);
    expect(all.counts.PurchaseOrder).toBe(2);
  });

  it('caps each type without hiding the others', () => {
    const index = new SearchIndex();
    for (let i = 0; i < 12; i++) index.upsert(doc('PurchaseOrder', `p${i}`, `PO-${i}`, [sec('Notes', 'steel')]));
    index.upsert(doc('Vendor', 'v', 'Steel Works'));
    const out = search(index, 'steel', { perTypeLimit: 5 });
    expect(out.hits.filter((h) => h.model === 'PurchaseOrder')).toHaveLength(5);
    expect(out.hits.some((h) => h.model === 'Vendor')).toBe(true);
    expect(out.counts.PurchaseOrder).toBe(12);
  });

  it('reflects updates and removals immediately', () => {
    const index = build();
    index.upsert(doc('PurchaseOrder', 'p1', 'VGH-PO017', [sec('PO item', 'Granite tiles', 3, 'child')], ['Vendor:v1']));
    expect(search(index, 'cement').hits).toEqual([]);
    expect(search(index, 'granite').hits[0].key).toBe('PurchaseOrder:p1');
    expect(index.remove('PurchaseOrder:p1')).toBe(true);
    expect(search(index, 'granite').hits).toEqual([]);
    // A term that disappeared and came back is searchable by prefix again.
    index.upsert(doc('PurchaseOrder', 'p9', 'VGH-PO099', [sec('PO item', 'Granite slab', 3, 'child')]));
    expect(search(index, 'gran').hits[0].key).toBe('PurchaseOrder:p9');
  });

  it('matches amounts and dates written in other styles', () => {
    const index = new SearchIndex();
    index.upsert(
      doc('Invoice', 'i1', 'INV-9', [
        { label: 'Grand total', labelKey: 'grandTotal', text: '1,25,000', index: '125000', weight: 0.6, kind: 'self' },
        { label: 'Date', labelKey: 'date', text: '14 Mar 2026', index: '2026-03-14 14-03-2026 14/03/2026 14 Mar March 2026', weight: 0.4, kind: 'self' },
      ]),
    );
    expect(search(index, '1,25,000').hits).toHaveLength(1);
    expect(search(index, '125000').hits).toHaveLength(1);
    expect(search(index, '14/03/2026').hits).toHaveLength(1);
    expect(search(index, 'march 2026').hits).toHaveLength(1);
  });

  it('clips long text around the match', () => {
    const index = new SearchIndex();
    const long = `${'lorem ipsum dolor '.repeat(30)}special-anchor ${'tail text '.repeat(30)}`;
    index.upsert(doc('Issue', 'i1', 'Problem', [sec('Description', long)]));
    const m = search(index, 'anchor').hits[0].matches[0];
    expect(m.text.length).toBeLessThan(200);
    expect(m.text.slice(m.marks[0].start, m.marks[0].end).toLowerCase()).toBe('anchor');
  });
});
