import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { addRecentlyViewed } from './useRecentlyViewed';

/**
 * Tracks page views for the "Recently Viewed" section in GlobalSearch.
 * Fires whenever the route changes.
 *
 * We only track list pages and detail pages (not the dashboard or settings),
 * and we use the page title from the route to build a readable label.
 */
const ROUTE_LABELS: Record<string, string> = {
  '/pos': 'Purchase Orders',
  '/invoices': 'Invoices',
  '/payments': 'Payments',
  '/vendors': 'Vendors',
  '/issues': 'Issues',
  '/work': 'Work Tasks',
  '/quotations': 'Quotations',
  '/ledgers': 'Ledgers',
  '/assets': 'Assets',
  '/audit': 'Audit Log',
  '/budget': 'Budget',
  '/phases': 'Phases',
  '/bank-accounts': 'Bank Accounts',
  '/users': 'Users',
  '/materials': 'Materials',
  '/reports': 'Reports',
  '/dashboard': 'Dashboard',
};

export function useTrackPageView() {
  const location = useLocation();
  const lastTrackedRef = useRef<string>('');

  useEffect(() => {
    const path = location.pathname;
    // Avoid double-tracking the same path
    if (path === lastTrackedRef.current) return;
    lastTrackedRef.current = path;

    // Skip non-content routes
    if (path === '/' || path === '/login' || path.startsWith('/scan/')) return;

    // Find the base route label
    const baseRoute = '/' + path.split('/')[1];
    const label = ROUTE_LABELS[path] ?? ROUTE_LABELS[baseRoute];
    if (!label) return;

    // If there's an id query param, it's a specific record — track with the id
    const idParam = new URLSearchParams(location.search).get('id');
    const trackId = idParam || path;
    const trackLabel = idParam ? `${label} (record)` : label;

    addRecentlyViewed({
      id: trackId,
      label: trackLabel,
      path: path + location.search,
      type: label,
    });
  }, [location.pathname, location.search]);
}
