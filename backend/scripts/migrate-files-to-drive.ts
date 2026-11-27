/**
 * Move files saved before Google Drive (Supabase / local folder) into Drive, and check
 * the result. Logic and safety rules: src/services/storage/drive-migration.ts.
 *
 *   npx tsx scripts/migrate-files-to-drive.ts --dry-run             list what would move
 *   npx tsx scripts/migrate-files-to-drive.ts                       copy images/PDFs, verify, repoint records
 *   npx tsx scripts/migrate-files-to-drive.ts --all-types           also other file types (videos, Office files)
 *   npx tsx scripts/migrate-files-to-drive.ts --limit 20            only the first 20 files (try it out)
 *   npx tsx scripts/migrate-files-to-drive.ts --tables attachment,document
 *   npx tsx scripts/migrate-files-to-drive.ts --verify [--download] check every Drive file the database uses
 *   npx tsx scripts/migrate-files-to-drive.ts --orphans [--trash]   Drive files no record uses (older than 24 h)
 *   npx tsx scripts/migrate-files-to-drive.ts --cleanup-legacy [--dry-run]
 *                                    delete originals whose Drive copy is verified and unused elsewhere
 *
 * Interrupted? Run the same command again: it continues where it stopped.
 * Progress file: DRIVE_MIGRATION_STATE (default ./drive-migration-state.json).
 * Needs the GOOGLE_OAUTH_* and GOOGLE_DRIVE_FILES_FOLDER_ID settings (any STORAGE_MODE).
 * It works on whatever DATABASE_URL points at: run it against the shared database
 * only deliberately, after a --dry-run.
 */
import { prisma } from '../src/config/prisma';
import { getDriveService, getLegacyStorageService } from '../src/services/storage.service';
import { migrateFiles, verifyDriveReferences, findOrphans, cleanupLegacy } from '../src/services/storage/drive-migration';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const drive = getDriveService();
  if (!drive) {
    console.error('Google Drive is not configured: set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN and GOOGLE_DRIVE_FILES_FOLDER_ID.');
    process.exit(1);
  }
  const deps = {
    db: prisma,
    legacy: getLegacyStorageService(),
    drive,
    statePath: process.env.DRIVE_MIGRATION_STATE || './drive-migration-state.json',
  };

  if (flag('verify')) {
    const r = await verifyDriveReferences(deps, { download: flag('download') });
    console.log(`Checked ${r.checked} Drive files: ${r.missing.length} missing or corrupt.`);
    process.exitCode = r.missing.length ? 1 : 0;
    return;
  }

  if (flag('orphans')) {
    const orphans = await findOrphans(deps, { minAgeHours: Number(value('min-age-hours') ?? 24) });
    for (const o of orphans) console.log(`orphan ${o.id}  ${o.name}  ${o.size} bytes  ${o.createdTime ?? ''}`);
    console.log(`${orphans.length} orphaned file(s).`);
    if (flag('trash')) {
      for (const o of orphans) await drive.trashById(o.id);
      console.log(`Moved ${orphans.length} file(s) to the Drive trash (recoverable for 30 days).`);
    }
    return;
  }

  if (flag('cleanup-legacy')) {
    const r = await cleanupLegacy(deps, { dryRun: flag('dry-run') });
    console.log(`Originals deleted: ${r.deleted}, kept: ${r.kept}.`);
    return;
  }

  const limit = value('limit');
  const tables = value('tables')?.split(',').map((t) => t.trim()).filter(Boolean);
  const stats = await migrateFiles(deps, {
    dryRun: flag('dry-run'),
    limit: limit ? Number(limit) : undefined,
    tables,
    allTypes: flag('all-types'),
  });
  console.log(
    `Scanned ${stats.scanned} file(s): ${stats.migrated} copied, ${stats.reused} already in Drive, ` +
      `${stats.skippedType} other type(s) left in place, ${stats.failed} failed; ${stats.rowsUpdated} record(s) updated.`,
  );
  if (stats.failed) {
    console.log(`Failures are listed in ${deps.statePath}; run the command again to retry them.`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
