import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Database = {
  db: Db;
  driver: 'pg' | 'pglite';
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
};

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../database/migrations');

export type DatabaseOptions = { databaseUrl?: string | undefined; pgliteDataDir?: string };

export async function openDatabase(opts: DatabaseOptions): Promise<Database> {
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzlePg({ client: pool, schema, casing: 'snake_case' });
    return {
      db: db as unknown as Db,
      driver: 'pg',
      migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
      ping: async () => {
        await db.execute(sql`select 1`);
      },
      close: () => pool.end(),
    };
  }

  const dataDir = opts.pgliteDataDir ?? 'memory://';
  if (!dataDir.startsWith('memory://')) mkdirSync(dataDir, { recursive: true });
  const client = await PGlite.create(dataDir);
  const db = drizzlePglite({ client, schema, casing: 'snake_case' });
  return {
    db: db as unknown as Db,
    driver: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => client.close(),
  };
}

/** Runs raw SQL and returns its rows. Both drivers (pg and PGlite) return `{ rows }`. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}
