// better-sqlite3-backed sqliteJson(db, sql), matching the shape lib/graph.mjs
// expects from its injected query function: given a DB path and a SQL
// string, return the result rows as an array of plain objects — the same
// shape `sqlite3 -json` produces for the CLI's implementation.
import Database from 'better-sqlite3';

const dbCache = new Map<string, Database.Database>();

/** Returns a cached, read-only connection to the SQLite database at `dbPath`, opening it on first use. */
function getDb(dbPath: string): Database.Database {
  let db = dbCache.get(dbPath);
  if (!db) {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    dbCache.set(dbPath, db);
  }
  return db;
}

/** Runs a SQL query against the given database and returns its rows as plain objects. */
export function sqliteJson(dbPath: string, sql: string): Record<string, unknown>[] {
  return getDb(dbPath).prepare(sql).all() as Record<string, unknown>[];
}
