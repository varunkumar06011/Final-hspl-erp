import { Capacitor } from '@capacitor/core';

/** True when running inside the Capacitor native shell (iOS/Android). */
export const isNative = Capacitor.isNativePlatform();
export const isIOS = Capacitor.getPlatform() === 'ios';

// Production endpoints baked in as the native fallback. On the web the app
// is served behind same-origin rewrites (Vercel → Railway), so '/api' works;
// inside the native webview a relative path would hit https://localhost and
// fail, so the absolute backend URL is required.
const PROD_API_URL = 'https://hospital-erpbackend-production.up.railway.app/api';
const PROD_WEB_URL = 'https://hospital-erp2.vercel.app';

function resolveApiBase(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (isNative) {
    return envUrl && /^https?:\/\//.test(envUrl) ? envUrl : PROD_API_URL;
  }
  return envUrl || '/api';
}

/** Base URL for REST calls — absolute on native, '/api' (or env) on web. */
export const API_BASE_URL = resolveApiBase();

// QR codes printed on assets must point at the public web app, never at the
// webview's internal origin (capacitor/https://localhost).
export const QR_BASE_URL: string =
  (import.meta.env.VITE_QR_BASE_URL as string | undefined) ||
  (isNative ? PROD_WEB_URL : window.location.origin);
