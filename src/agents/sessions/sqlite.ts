import { existsSync } from 'node:fs';

export type Row = Record<string, unknown>;

interface Database {
  prepare(sql: string): { all(...params: unknown[]): Row[] };
  close(): void;
}

let loading: Promise<new (path: string, options: { readOnly: boolean }) => Database> | undefined;

/** `node:sqlite`, loaded on first use and without its "experimental" warning. */
function sqlite() {
  loading ??= (async () => {
    const emitWarning = process.emitWarning;
    process.emitWarning = () => {};
    try {
      const name = 'node:sqlite';
      const module = (await import(name)) as {
        DatabaseSync: new (path: string, options: { readOnly: boolean }) => Database;
      };
      return module.DatabaseSync;
    } catch {
      throw new Error('Reading this session store needs Node 22.5 or newer (node:sqlite).');
    } finally {
      process.emitWarning = emitWarning;
    }
  })();
  return loading;
}

/**
 * Run one query against an agent's SQLite index, read-only. `null` when the file does not exist.
 *
 * A WAL database whose `-shm` file is gone cannot be opened read-only, so the second try opens it
 * as immutable: that reads the main file alone and misses what still sits in the WAL.
 */
export async function queryDatabase(file: string, sql: string, params: unknown[] = []): Promise<Row[] | null> {
  if (!existsSync(file)) return null;
  const DatabaseSync = await sqlite();
  const attempts = [file, `file:${encodeURI(file)}?immutable=1`];
  let failure: unknown;
  for (const target of attempts) {
    let database: Database | undefined;
    try {
      database = new DatabaseSync(target, { readOnly: true });
      return database.prepare(sql).all(...params);
    } catch (error) {
      failure = error;
    } finally {
      try {
        database?.close();
      } catch {
        // Already closed, or never opened.
      }
    }
  }
  throw failure instanceof Error ? failure : new Error(String(failure));
}

/** The columns `table` has, so a query can ask only for those an agent version really keeps. */
export async function tableColumns(file: string, table: string): Promise<Set<string> | null> {
  const rows = await queryDatabase(file, `SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}')`);
  return rows ? new Set(rows.map((row) => String(row.name))) : null;
}

export const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
export const number = (value: unknown): number | undefined =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined;
