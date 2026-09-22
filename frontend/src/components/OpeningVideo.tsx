import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useIsFetching } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';

const SHOWN_KEY = 'hspl-opening-shown';
// Absolute failsafe — the app is never held hostage by the video or the network.
const HARD_CAP_MS = 9000;
// Queries must have spun up before we consider "no fetches" meaningful.
const QUERY_GRACE_MS = 1500;

declare global {
  interface Window {
    __hsplVideoDone?: boolean;
    __openingAppReady?: () => void;
  }
}

/**
 * Opening video gate — two modes:
 *
 * 1. BOOT mode: index.html already plays the video the instant the page loads
 *    (logged-in fresh opens). This component then only decides WHEN the splash
 *    reveals the app: after the video ends AND the dashboard's queries have
 *    settled — so the dashboard is populated the moment it appears, not
 *    skeletons. The inline script's own timers remain as failsafes.
 *
 * 2. OVERLAY mode: the session flag wasn't set at boot (user was logged out,
 *    then logged in) — this renders the video itself, same reveal rules.
 *
 * Once per session (sessionStorage), replayed after every login (the flag is
 * cleared on logout). Mobile screens/portrait tablets get the mobile cut;
 * landscape/desktop get the laptop cut. Tap/click skips.
 */
export default function OpeningVideo() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const authed = Boolean(token && user);

  const [showOverlay, setShowOverlay] = useState(false);
  const [fading, setFading] = useState(false);
  const [videoDone, setVideoDone] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const timers = useRef<number[]>([]);
  const doneRef = useRef(false);
  const bootRef = useRef(false);
  const seenFetch = useRef(false);
  const mountTime = useRef(Date.now());

  const fetching = useIsFetching();

  const isMobile = typeof window !== 'undefined' && (
    window.matchMedia('(max-width: 599px)').matches ||
    (window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(orientation: portrait)').matches)
  );
  const src = isMobile ? '/opening-mobile.mp4' : '/opening-desktop.mp4';

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    setFading(true);
    timers.current.push(window.setTimeout(() => setShowOverlay(false), 250));
  };

  // Data is "ready" once the boot-time queries have actually run and settled —
  // errors count too (a settled 401 must still hand control to the app).
  useEffect(() => {
    if (dataReady) return;
    if (fetching > 0) {
      seenFetch.current = true;
      return;
    }
    if (seenFetch.current || Date.now() - mountTime.current > QUERY_GRACE_MS) {
      setDataReady(true);
    }
  }, [fetching, dataReady]);

  useEffect(() => {
    if (!authed) {
      // Logged out → clear the flag so the next login replays the intro.
      try { sessionStorage.removeItem(SHOWN_KEY); } catch { /* storage unavailable */ }
      doneRef.current = false;
      setVideoDone(false);
      setDataReady(false);
      seenFetch.current = false;
      return;
    }

    const bootSplash = document.getElementById('opening-splash');
    if (bootSplash) {
      // Boot mode — the HTML splash is playing; reveal it once video+data done.
      bootRef.current = true;
      if (window.__hsplVideoDone) setVideoDone(true);
      else {
        const onDone = () => setVideoDone(true);
        window.addEventListener('hspl-video-done', onDone, { once: true });
        timers.current.push(window.setTimeout(() => setVideoDone(true), HARD_CAP_MS));
        return () => window.removeEventListener('hspl-video-done', onDone);
      }
      return;
    }

    let alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem(SHOWN_KEY) === '1'; } catch { /* storage unavailable */ }
    if (alreadyShown) return;
    try { sessionStorage.setItem(SHOWN_KEY, '1'); } catch { /* storage unavailable */ }
    doneRef.current = false;
    setShowOverlay(true);
    timers.current.push(window.setTimeout(() => setVideoDone(true), HARD_CAP_MS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // Reveal only when BOTH the video finished and the app's data has settled.
  useEffect(() => {
    if (!videoDone || !dataReady) return;
    if (bootRef.current) {
      window.__openingAppReady?.();
      bootRef.current = false;
      return;
    }
    if (showOverlay) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDone, dataReady, showOverlay]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  if (!showOverlay) return null;

  return (
    <Box
      onClick={() => setVideoDone(true)}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        bgcolor: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.25s ease',
        pointerEvents: 'auto',
      }}
    >
      <Box
        component="video"
        key={src}
        src={src}
        autoPlay
        muted
        playsInline
        preload="auto"
        ref={(el: HTMLVideoElement | null) => {
          if (!el) return;
          // React only sets the muted *attribute* — the DOM property is what
          // autoplay policies check. Set both, then play() explicitly so any
          // rejection (iOS Low Power Mode etc.) skips straight to the app
          // instead of freezing on the first frame.
          el.muted = true;
          el.defaultMuted = true;
          const p = el.play();
          if (p) p.catch(() => setVideoDone(true));
        }}
        onEnded={() => setVideoDone(true)}
        onError={() => setVideoDone(true)}
        onLoadedMetadata={(e: React.SyntheticEvent<HTMLVideoElement>) => {
          const dur = e.currentTarget.duration;
          if (Number.isFinite(dur) && dur > 0) {
            timers.current.push(window.setTimeout(() => setVideoDone(true), Math.min(dur * 1000 + 400, HARD_CAP_MS)));
          }
        }}
        sx={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </Box>
  );
}
