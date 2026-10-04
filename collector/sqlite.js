import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Preserve the tested collector queries while using Node's built-in SQLite.
export function openStore(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
    .replaceAll('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
    .replaceAll('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '));
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        first() { return statement.get(...values) ?? null; },
        all() { return { results: statement.all(...values) }; },
        run() { return statement.run(...values); },
      };
    },
    batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(s => s.run());
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); },
  };
}
