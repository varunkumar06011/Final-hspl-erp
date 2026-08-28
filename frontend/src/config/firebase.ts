import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, inMemoryPersistence, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let auth: Auth | null = null;
let app: ReturnType<typeof initializeApp> | null = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // Use inMemoryPersistence: we only need Firebase for the OTP verification step.
  // After that, the app uses its own JWT. This prevents Firebase from persisting
  // auth state in IndexedDB/localStorage, which can interfere with other sessions
  // (e.g., logging in as different users in different tabs/profiles).
  setPersistence(auth, inMemoryPersistence).catch((err) => {
    console.warn('[Firebase] Failed to set in-memory persistence:', err);
  });
} else {
  console.warn(
    '[Firebase] Missing environment variables. Copy .env.example to .env.local and fill in your Firebase config.'
  );
}

export { auth, app, isConfigured };
