import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vgrand.hospitalerp',
  appName: 'Hospital ERP',
  webDir: 'dist',
  server: {
    // Serve the bundled app from https://localhost instead of the default
    // capacitor://localhost. Firebase phone-auth / reCAPTCHA only run on
    // domains listed in the Firebase console's authorized domains — which
    // includes localhost — so an http(s) scheme is required for OTP sign-in
    // inside the native webview.
    iosScheme: 'https',
    hostname: 'localhost',
  },
  ios: {
    // Edge-to-edge webview; safe areas are handled in CSS via
    // env(safe-area-inset-*) (viewport-fit=cover is set in index.html).
    contentInset: 'never',
  },
  experimental: {
    ios: {
      spm: {
        // Required by @capacitor-firebase/messaging under SwiftPM to avoid a
        // package identity collision with its bundled Firebase dependency.
        packageOptions: {
          // Both @capacitor-firebase packages end in /app and /messaging —
          // without symlinks their last path component collides with
          // @capacitor/app's SPM package identity.
          '@capacitor-firebase/app': { symlink: true },
          '@capacitor-firebase/messaging': { symlink: true },
        },
      },
    },
  },
};

export default config;
