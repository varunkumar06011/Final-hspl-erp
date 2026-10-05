import { useEffect } from 'react';
import { useActiveRecordStore, ActiveRecord, ActiveRecordType } from '../stores/activeRecordStore';

/**
 * Publish the record the user has opened so the top bar can list its related
 * documents. Pass null when nothing is selected. Clears itself on unmount.
 */
export function useActiveRecord(type: ActiveRecordType, id: string | null | undefined, label: string | null | undefined): void {
  const setRecord = useActiveRecordStore((s) => s.setRecord);
  useEffect(() => {
    setRecord(id ? { type, id, label: label || '' } : null);
  }, [type, id, label, setRecord]);
  useEffect(() => () => setRecord(null), [setRecord]);
}

/** For table pages: returns a setter to call from a row click. Clears itself on unmount. */
export function useActiveRecordSetter(): (record: ActiveRecord | null) => void {
  const setRecord = useActiveRecordStore((s) => s.setRecord);
  useEffect(() => () => setRecord(null), [setRecord]);
  return setRecord;
}
