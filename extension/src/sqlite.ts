// better-sqlite3-backed sqliteJson(db, sql), matching the shape lib/graph.mjs
// expects from its injected query function: given a DB path and a SQL
// string, return the result rows as an array of plain objects — the same
// shape `sqlite3 -json` produces for the CLI's implementation.
import Database from 'better-sqlite3';

const dbCache = new Map<string, Database.Database>();

function getDb(dbPath: string): Database.Database {
  let db = dbCache.get(dbPath);
  if (!db) {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    dbCache.set(dbPath, db);
  }
  return db;
}

export function sqliteJson(dbPath: string, sql: string): Record<string, unknown>[] {
  return getDb(dbPath).prepare(sql).all() as Record<string, unknown>[];
}
