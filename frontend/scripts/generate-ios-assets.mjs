/**
 * Generates the Capacitor asset sources (resources/icon.png,
 * resources/splash.png, resources/splash-dark.png) from public/logo.png,
 * then runs @capacitor/assets to fill the iOS Assets.xcassets.
 *
 * Usage:  node scripts/generate-ios-assets.mjs
 *         npx capacitor-assets generate --ios
 */

import { Jimp } from 'jimp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logoPath = path.join(root, 'public', 'logo.png');
const resourcesDir = path.join(root, 'resources');
mkdirSync(resourcesDir, { recursive: true });

const logo = await Jimp.read(logoPath);

// ── App icon: 1024x1024, opaque (App Store rejects alpha) ──────────────
const iconBg = new Jimp({ width: 1024, height: 1024, color: 0xffffffff });
const iconLogo = logo.clone().resize({ w: 820, h: 820 });
iconBg.composite(iconLogo, 102, 102);
await iconBg.write(path.join(resourcesDir, 'icon.png'));

// ── Splash: 2732x2732 solid background, centered logo ──────────────────
async function makeSplash(bgColor, file) {
  const img = new Jimp({ width: 2732, height: 2732, color: bgColor });
  const l = logo.clone().resize({ w: 820, h: 820 });
  img.composite(l, (2732 - 820) / 2, (2732 - 820) / 2);
  await img.write(path.join(resourcesDir, file));
}
await makeSplash(0xffffffff, 'splash.png');
await makeSplash(0x0a1929ff, 'splash-dark.png');

console.log('Wrote resources/icon.png, splash.png, splash-dark.png');
console.log('Now run: npx capacitor-assets generate --ios');
