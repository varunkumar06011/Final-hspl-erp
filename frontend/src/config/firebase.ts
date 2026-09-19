const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

if (!isConfigured) {
  console.warn(
    '[Firebase] Missing environment variables. Copy .env.example to .env.local and fill in your Firebase config.'
  );
}

// firebase/app + firebase/auth (~250KB) are lazy-loaded — they are only
// needed for the phone-OTP step and push notifications, not on every boot
// (important for slow iOS Home Screen cold starts). The promise is cached so
// the modules initialize exactly once.
export interface FirebaseHandles {
  app: import('firebase/app').FirebaseApp;
  auth: import('firebase/auth').Auth;
  signInWithPhoneNumber: typeof import('firebase/auth').signInWithPhoneNumber;
  RecaptchaVerifier: typeof import('firebase/auth').RecaptchaVerifier;
}

let cached: Promise<FirebaseHandles> | null = null;

export function getFirebase(): Promise<FirebaseHandles | null> {
  if (!isConfigured) return Promise.resolve(null);
  if (!cached) {
    cached = Promise.all([import('firebase/app'), import('firebase/auth')]).then(
      ([appMod, authMod]) => {
        const app = appMod.initializeApp(firebaseConfig);
        const auth = authMod.getAuth(app);
        // Use inMemoryPersistence: we only need Firebase for the OTP verification step.
        // After that, the app uses its own JWT. This prevents Firebase from persisting
        // auth state in IndexedDB/localStorage, which can interfere with other sessions
        // (e.g., logging in as different users in different tabs/profiles).
        authMod.setPersistence(auth, authMod.inMemoryPersistence).catch((err) => {
          console.warn('[Firebase] Failed to set in-memory persistence:', err);
        });
        return {
          app,
          auth,
          signInWithPhoneNumber: authMod.signInWithPhoneNumber,
          RecaptchaVerifier: authMod.RecaptchaVerifier,
        };
      },
    );
  }
  return cached;
}
