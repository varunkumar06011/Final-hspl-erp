// Builds an ESM version of the shared package using esbuild.
// The main tsc build produces CommonJS (dist/index.js); this produces
// dist/index.mjs so bundlers like Vite can resolve named exports.
// We also copy the type declarations as .d.mts so TypeScript's node16
// module resolution can find types for the ESM entry.
import { build } from 'esbuild';
import { copyFile, readdir } from 'fs/promises';
import { join } from 'path';

await build({
  entryPoints: ['index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: 'dist/index.mjs',
  sourcemap: false,
  packages: 'external',
});

// Copy .d.ts declarations to .d.mts so node16 resolution finds them
const distDir = 'dist';
const files = await readdir(distDir);
for (const file of files) {
  if (file.endsWith('.d.ts')) {
    const mtsName = file.replace(/\.d\.ts$/, '.d.mts');
    await copyFile(join(distDir, file), join(distDir, mtsName));
  }
}

console.log('✓ ESM build written to dist/index.mjs');
