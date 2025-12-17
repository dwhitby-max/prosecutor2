import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
let db = null;
export function getDb() {
    if (db)
        return db;
    const dir = path.join(process.cwd(), 'data');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'app.sqlite');
    db = new Database(file);
    init(db);
    return db;
}
function init(d) {
    d.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      case_number TEXT,
      defendant_name TEXT,
      created_at TEXT NOT NULL,
      analysis_json TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      upload_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_cache (
      id TEXT PRIMARY KEY,
      jurisdiction TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      content_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      UNIQUE(jurisdiction, normalized_key)
    );
  `);
}
