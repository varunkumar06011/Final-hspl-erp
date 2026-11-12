import { useEffect } from 'react';
import { useToast } from './ToastProvider';

/**
 * Shows the server's "possible duplicate" warnings (sent with an otherwise successful answer)
 * as a toast. The upload is already saved; this only tells the person.
 */
export default function DuplicateWarningListener() {
  const toast = useToast();
  useEffect(() => {
    const onWarn = (e: Event) => {
      const messages = (e as CustomEvent<string[]>).detail ?? [];
      messages.forEach((m) => toast.warning(m));
    };
    window.addEventListener('duplicate-warning', onWarn);
    return () => window.removeEventListener('duplicate-warning', onWarn);
  }, [toast]);
  return null;
}
