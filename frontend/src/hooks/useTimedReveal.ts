import { useCallback, useEffect, useRef, useState } from 'react';

/** Amounts stay hidden until toggled; they hide again after `ms` (default 10 s). */
export function useTimedReveal(ms = 10000) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setRevealed((prev) => {
      const next = !prev;
      if (next) timer.current = setTimeout(() => setRevealed(false), ms);
      return next;
    });
  }, [ms]);

  return { revealed, toggle };
}
