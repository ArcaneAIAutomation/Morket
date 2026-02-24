import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getMigrationFiles, runClickHouseMigrations } from '../../migrations/clickhouse/runner';
import type { ClickHouseClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// Create a temp directory with test SQL files for controlled testing
function createTempMigrationDir(files: Record<string, string>): string {
  const tmpDir = path.join(__dirname, '__test_migrations__');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  // Clean existing files
  for (const f of fs.readdirSync(tmpDir)) {
    fs.unlinkSync(path.join(tmpDir, f));
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmpDir, name), content);
  }
  return tmpDir;
}

function cleanupTempDir(): void {
  const tmpDir = path.join(__dirname, '__test_migrations__');
  if (fs.existsSync(tmpDir)) {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
    fs.rmdirSync(tmpDir);
  }
}

function createMockClient(executedMigrations: string[] = []): ClickHouseClient {
  const tracked = new Set(executedMigrations);

  return {
    command: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockImplementation(() => ({
      json: vi.fn().mockResolvedValue(
        Array.from(tracked).map((name) => ({ name })),
      ),
    })),
    insert: vi.fn().mockImplementation(async ({ values }: { values: Array<{ name: string }> }) => {
      for (const v of values) {
        tracked.add(v.name);
      }
    }),
    close: vi.fn(),
  } as unknown as ClickHouseClient;
}

describe('getMigrationFiles', () => {
  afterAll(() => {
    cleanupTempDir();
  });

  it('returns only .sql files matching NNN_*.sql pattern', () => {
    const dir = createTempMigrationDir({
      '001_first.sql': 'CREATE TABLE t1 (id UInt32) ENGINE = MergeTree() ORDER BY id',
      '002_second.sql': 'CREATE TABLE t2 (id UInt32) ENGINE = MergeTree() ORDER BY id',
      'runner.ts': 'not a migration',
      'readme.md': 'not a migration',
    });
    const files = getMigrationFiles(dir);
    expect(files).toEqual(['001_first.sql', '002_second.sql']);
  });

  it('returns files in sorted order', () => {
    const dir = createTempMigrationDir({
      '003_third.sql': 'SELECT 1',
      '001_first.sql': 'SELECT 1',
      '002_second.sql': 'SELECT 1',
    });
    const files = getMigrationFiles(dir);
    expect(files).toEqual(['001_first.sql', '002_second.sql', '003_third.sql']);
  });

  it('returns empty array when no .sql files exist', () => {
    const dir = createTempMigrationDir({
      'runner.ts': 'code',
    });
    const files = getMigrationFiles(dir);
    expect(files).toEqual([]);
  });
});

describe('runClickHouseMigrations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    cleanupTempDir();
  });

  it('creates _ch_migrations table on first run', async () => {
    const dir = createTempMigrationDir({});
    const mockClient = createMockClient();

    await runClickHouseMigrations(mockClient, dir);

    expect(mockClient.command).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('_ch_migrations'),
      }),
    );
  });

  it('runs all pending migrations in order', async () => {
    const dir = createTempMigrationDir({
      '001_first.sql': 'CREATE TABLE t1 (id UInt32) ENGINE = MergeTree() ORDER BY id',
      '002_second.sql': 'CREATE TABLE t2 (id UInt32) ENGINE = MergeTree() ORDER BY id',
    });
    const mockClient = createMockClient();

    const applied = await runClickHouseMigrations(mockClient, dir);

    expect(applied).toEqual(['001_first.sql', '002_second.sql']);
    // command called: 1 for ensureMigrationsTable + 2 for migrations
    expect(mockClient.command).toHaveBeenCalledTimes(3);
  });

  it('skips already-executed migrations (idempotency)', async () => {
    const dir = createTempMigrationDir({
      '001_first.sql': 'CREATE TABLE t1 (id UInt32) ENGINE = MergeTree() ORDER BY id',
      '002_second.sql': 'CREATE TABLE t2 (id UInt32) ENGINE = MergeTree() ORDER BY id',
    });
    const mockClient = createMockClient(['001_first.sql']);

    const applied = await runClickHouseMigrations(mockClient, dir);

    expect(applied).toEqual(['002_second.sql']);
    // command called: 1 for ensureMigrationsTable + 1 for the pending migration
    expect(mockClient.command).toHaveBeenCalledTimes(2);
  });

  it('returns empty array when all migrations are already applied', async () => {
    const dir = createTempMigrationDir({
      '001_first.sql': 'SELECT 1',
    });
    const mockClient = createMockClient(['001_first.sql']);

    const applied = await runClickHouseMigrations(mockClient, dir);

    expect(applied).toEqual([]);
  });

  it('records each applied migration in _ch_migrations table', async () => {
    const dir = createTempMigrationDir({
      '001_first.sql': 'CREATE TABLE t1 (id UInt32) ENGINE = MergeTree() ORDER BY id',
    });
    const mockClient = createMockClient();

    await runClickHouseMigrations(mockClient, dir);

    expect(mockClient.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        table: '_ch_migrations',
        values: expect.arrayContaining([
          expect.objectContaining({ name: '001_first.sql' }),
        ]),
        format: 'JSONEachRow',
      }),
    );
  });

  it('throws and stops on migration failure', async () => {
    const dir = createTempMigrationDir({
      '001_first.sql': 'CREATE TABLE t1 (id UInt32) ENGINE = MergeTree() ORDER BY id',
      '002_second.sql': 'INVALID SQL',
    });

    const commandFn = vi.fn()
      .mockResolvedValueOnce(undefined) // ensureMigrationsTable
      .mockResolvedValueOnce(undefined) // 001_first.sql
      .mockRejectedValueOnce(new Error('Syntax error')); // 002_second.sql

    const mockClient = {
      command: commandFn,
      query: vi.fn().mockImplementation(() => ({
        json: vi.fn().mockResolvedValue([]),
      })),
      insert: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    } as unknown as ClickHouseClient;

    await expect(runClickHouseMigrations(mockClient, dir)).rejects.toThrow('Syntax error');
  });
});
