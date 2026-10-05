import { create } from 'zustand';

/** Procurement record types the "Related" dropdown in the top bar understands. */
export type ActiveRecordType = 'MPR' | 'QUOTATION' | 'PO' | 'GATE_PASS' | 'GOODS_RECEIPT' | 'INVOICE' | 'PAYMENT';

export interface ActiveRecord {
  type: ActiveRecordType;
  id: string;
  /** Document number shown on the dropdown button (e.g. VGH-PO001). */
  label: string;
}

interface ActiveRecordState {
  record: ActiveRecord | null;
  setRecord: (record: ActiveRecord | null) => void;
}

/** The record the user has opened/selected on the current page. Pages publish it; AppShell reads it. */
export const useActiveRecordStore = create<ActiveRecordState>((set) => ({
  record: null,
  setRecord: (record) => set({ record }),
}));
