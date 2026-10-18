import { getDb } from './index.js';

async function runMigration() {
  console.log('[MIGRATION] Checking and applying database tables...');
  try {
    await getDb();
    console.log('[MIGRATION] Database schema verified and updated successfully.');
    process.exit(0);
  } catch (err: any) {
    console.error('[MIGRATION_ERROR]', err);
    process.exit(1);
  }
}

runMigration();
