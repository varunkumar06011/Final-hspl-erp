import { useCallback } from 'react';

const STORAGE_KEY = 'hspl-recently-viewed';
const MAX_ITEMS = 10;

export interface RecentItem {
  id: string;
  label: string;
  path: string;
  type: string;
  timestamp: number;
}

export function getRecentlyViewed(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(item: Omit<RecentItem, 'timestamp'>) {
  try {
    const existing = getRecentlyViewed();
    // Remove duplicate (same id + type)
    const filtered = existing.filter((r) => !(r.id === item.id && r.type === item.type));
    const updated = [{ ...item, timestamp: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage might be full or unavailable — silently ignore
  }
}

export function useRecentlyViewed() {
  const track = useCallback((item: Omit<RecentItem, 'timestamp'>) => {
    addRecentlyViewed(item);
  }, []);

  return { track, getRecent: getRecentlyViewed };
}
