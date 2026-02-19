import { Client } from 'pg';
import { env } from '../src/config/env';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = __dirname;
const MIGRATION_FILE_PATTERN = /^\d{3}_.*\.ts$/;

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getExecutedMigrations(client: Client): Promise<Set<string>> {
  const result = await client.query<{ name: string }>('SELECT name FROM _migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

function getMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => MIGRATION_FILE_PATTERN.test(f))
    .sort();
}

async function runUp(client: Client): Promise<void> {
  await ensureMigrationsTable(client);
  const executed = await getExecutedMigrations(client);
  const files = getMigrationFiles();
  const pending = files.filter((f) => !executed.has(f));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  console.log(`Found ${pending.length} pending migration(s).`);

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    console.log(`Running migration: ${file}`);

    const migration = await import(filePath);

    await client.query('BEGIN');
    try {
      await migration.up(client);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  ✓ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} failed:`, err);
      throw err;
    }
  }

  console.log('All migrations applied successfully.');
}

async function runDown(client: Client): Promise<void> {
  await ensureMigrationsTable(client);
  const result = await client.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY name DESC LIMIT 1',
  );

  if (result.rows.length === 0) {
    console.log('No migrations to rollback.');
    return;
  }

  const lastMigration = result.rows[0].name;
  const filePath = path.join(MIGRATIONS_DIR, lastMigration);

  if (!fs.existsSync(filePath)) {
    console.error(`Migration file not found: ${lastMigration}`);
    process.exit(1);
  }

  console.log(`Rolling back migration: ${lastMigration}`);

  const migration = await import(filePath);

  await client.query('BEGIN');
  try {
    await migration.down(client);
    await client.query('DELETE FROM _migrations WHERE name = $1', [lastMigration]);
    await client.query('COMMIT');
    console.log(`  ✓ Rolled back ${lastMigration}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ✗ Rollback of ${lastMigration} failed:`, err);
    throw err;
  }
}

async function main(): Promise<void> {
  const isDown = process.argv.includes('--down');
  const client = new Client({ connectionString: env.DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database.');

    if (isDown) {
      await runDown(client);
    } else {
      await runUp(client);
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

main();
