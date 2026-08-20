// Builds an ESM version of the shared package without external deps.
// Uses tsc with a temp tsconfig to emit ESM to a temp dir, then copies
// all .js files to .mjs in dist/ and rewrites import paths to use .mjs
// extensions. Also copies .d.ts files to .d.mts for TypeScript node16 resolution.
import { execSync } from 'child_process';
import { copyFile, readdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';

const tmpDir = 'dist/_esm_tmp';
const tmpConfig = 'tsconfig.esm.tmp.json';

const esmConfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'esnext',
    moduleResolution: 'bundler',
    outDir: tmpDir,
    rootDir: '.',
    esModuleInterop: true,
    strict: true,
    skipLibCheck: true,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    forceConsistentCasingInFileNames: true,
  },
  include: ['./**/*.ts'],
  exclude: ['dist', 'node_modules', 'scripts'],
};

await writeFile(tmpConfig, JSON.stringify(esmConfig, null, 2));

try {
  execSync(`tsc -p ${tmpConfig}`, { stdio: 'inherit' });

  // Copy all ESM .js files from temp dir to dist/ as .mjs,
  // rewriting .js import specifiers to .mjs
  async function copyEsmFiles(prefix = '') {
    const entries = await readdir(join(tmpDir, prefix), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await copyEsmFiles(relPath);
      } else if (entry.name.endsWith('.js')) {
        let content = await readFile(join(tmpDir, relPath), 'utf8');
        // Rewrite .js import/export specifiers to .mjs
        content = content.replace(/(\.(?:import|export)\s.*?from\s*['"])([^'"]+)(\.js)(['"])/g, '$1$2.mjs$4');
        content = content.replace(/(from\s*['"])([^'"]+)(\.js)(['"])/g, '$1$2.mjs$4');
        const destPath = join('dist', relPath.replace(/\.js$/, '.mjs'));
        await writeFile(destPath, content);
      }
    }
  }
  await copyEsmFiles();

  await rm(tmpDir, { recursive: true, force: true });

  // Copy .d.ts declarations to .d.mts so node16 resolution finds them
  async function copyDeclFiles(prefix = '') {
    const entries = await readdir(join('dist', prefix), { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await copyDeclFiles(relPath);
      } else if (entry.name.endsWith('.d.ts')) {
        const mtsName = entry.name.replace(/\.d\.ts$/, '.d.mts');
        await copyFile(join('dist', relPath), join('dist', prefix ? `${prefix}/${mtsName}` : mtsName));
      }
    }
  }
  await copyDeclFiles();

  console.log('✓ ESM build written to dist/index.mjs');
} finally {
  await rm(tmpConfig, { force: true }).catch(() => {});
}
