import { useRef, useState, useEffect, useCallback } from 'react';

interface PullToRefreshState {
  pulling: boolean;
  pullDistance: number;
  refreshing: boolean;
}

const THRESHOLD = 70; // px — pull distance needed to trigger refresh
const MAX_PULL = 100; // px — visual cap so it doesn't drag too far
const RESISTANCE = 0.5; // dampening factor — makes the pull feel "elastic"

/**
 * Pull-to-refresh hook for mobile (iOS/Android web apps).
 * Attach the returned `bind` handlers to the scrollable container.
 * When the user pulls down at scrollTop === 0 and releases past THRESHOLD,
 * it calls `onRefresh` (defaults to window.location.reload()).
 *
 * Works on touch devices only — desktop uses a separate refresh button.
 */
export function usePullToRefresh(onRefresh?: () => void) {
  const [state, setState] = useState<PullToRefreshState>({
    pulling: false,
    pullDistance: 0,
    refreshing: false,
  });

  const startY = useRef(0);
  const currentPull = useRef(0);
  const isPulling = useRef(false);
  const scrollContainer = useRef<HTMLElement | null>(null);

  const handleRefresh = useCallback(() => {
    setState((s) => ({ ...s, refreshing: true, pullDistance: 0, pulling: false }));
    if (onRefresh) {
      onRefresh();
      // Give the callback time, then reset
      setTimeout(() => setState({ pulling: false, pullDistance: 0, refreshing: false }), 1500);
    } else {
      // Default: reload the page
      window.location.reload();
    }
  }, [onRefresh]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only start tracking if we're at the top of the scroll
    const target = scrollContainer.current;
    const scrollTop = target ? target.scrollTop : window.scrollY;
    if (scrollTop <= 0 && !state.refreshing) {
      startY.current = e.touches[0].clientY;
      isPulling.current = false; // set true only on actual downward move
    }
  }, [state.refreshing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (state.refreshing) return;

    const target = scrollContainer.current;
    const scrollTop = target ? target.scrollTop : window.scrollY;
    if (scrollTop > 0) {
      isPulling.current = false;
      if (currentPull.current > 0) {
        currentPull.current = 0;
        setState((s) => ({ ...s, pulling: false, pullDistance: 0 }));
      }
      return;
    }

    const deltaY = e.touches[0].clientY - startY.current;
    if (deltaY > 5) {
      // User is pulling down at the top
      isPulling.current = true;
      const resisted = Math.min(deltaY * RESISTANCE, MAX_PULL);
      currentPull.current = resisted;
      setState((s) => ({ ...s, pulling: true, pullDistance: resisted }));

      // Prevent native scroll bounce on iOS
      if (e.cancelable) e.preventDefault();
    }
  }, [state.refreshing]);

  const onTouchEnd = useCallback(() => {
    if (!isPulling.current) {
      currentPull.current = 0;
      setState((s) => ({ ...s, pulling: false, pullDistance: 0 }));
      return;
    }

    isPulling.current = false;
    if (currentPull.current >= THRESHOLD) {
      handleRefresh();
    } else {
      currentPull.current = 0;
      setState((s) => ({ ...s, pulling: false, pullDistance: 0 }));
    }
  }, [handleRefresh]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isPulling.current = false;
      currentPull.current = 0;
    };
  }, []);

  return {
    state,
    scrollContainer,
    bind: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
  };
}
