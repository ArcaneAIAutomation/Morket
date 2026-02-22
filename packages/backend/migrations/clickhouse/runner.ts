import * as fs from 'fs';
import * as path from 'path';
import { type ClickHouseClient } from '@clickhouse/client';
import { logger } from '../../src/shared/logger';

const MIGRATIONS_DIR = __dirname;
const MIGRATION_FILE_PATTERN = /^\d{3}_.*\.sql$/;

/**
 * Ensures the _ch_migrations tracking table exists in ClickHouse.
 */
async function ensureMigrationsTable(client: ClickHouseClient): Promise<void> {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS _ch_migrations (
        name String,
        executed_at DateTime64(3, 'UTC') DEFAULT now64(3)
      ) ENGINE = MergeTree()
      ORDER BY name
    `,
  });
}

/**
 * Returns the set of already-executed migration names.
 */
async function getExecutedMigrations(client: ClickHouseClient): Promise<Set<string>> {
  const result = await client.query({
    query: 'SELECT name FROM _ch_migrations ORDER BY name',
    format: 'JSONEachRow',
  });
  const rows = await result.json<{ name: string }>();
  return new Set(rows.map((r) => r.name));
}

/**
 * Returns sorted list of .sql migration files in the clickhouse migrations directory.
 */
export function getMigrationFiles(dir?: string): string[] {
  const targetDir = dir ?? MIGRATIONS_DIR;
  return fs
    .readdirSync(targetDir)
    .filter((f) => MIGRATION_FILE_PATTERN.test(f))
    .sort();
}

/**
 * Runs all pending ClickHouse migrations in order.
 * Reads numbered .sql files, checks against _ch_migrations tracking table,
 * and executes any that haven't been applied yet.
 *
 * Migrations are idempotent — re-running skips already-applied migrations.
 */
export async function runClickHouseMigrations(
  client: ClickHouseClient,
  dir?: string,
): Promise<string[]> {
  const targetDir = dir ?? MIGRATIONS_DIR;
  await ensureMigrationsTable(client);
  const executed = await getExecutedMigrations(client);
  const files = getMigrationFiles(targetDir);
  const pending = files.filter((f) => !executed.has(f));

  if (pending.length === 0) {
    logger.info('ClickHouse: No pending migrations.');
    return [];
  }

  logger.info(`ClickHouse: Found ${pending.length} pending migration(s).`);
  const applied: string[] = [];

  for (const file of pending) {
    const filePath = path.join(targetDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8').trim();

    if (!sql) {
      logger.warn(`ClickHouse: Skipping empty migration file: ${file}`);
      continue;
    }

    logger.info(`ClickHouse: Running migration: ${file}`);

    try {
      await client.command({ query: sql });

      await client.insert({
        table: '_ch_migrations',
        values: [{ name: file, executed_at: new Date().toISOString() }],
        format: 'JSONEachRow',
      });

      applied.push(file);
      logger.info(`ClickHouse: ✓ ${file}`);
    } catch (err) {
      logger.error(`ClickHouse: ✗ ${file} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  logger.info(`ClickHouse: All migrations applied successfully (${applied.length}).`);
  return applied;
}
