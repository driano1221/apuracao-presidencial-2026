import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { panel, KEY } from './core.js';

export async function restore(db, folder) {
  let latest, history;
  try {
    latest = JSON.parse(await readFile(join(folder, 'latest.json'), 'utf8'));
    history = JSON.parse(await readFile(join(folder, 'history.json'), 'utf8')).history;
  } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (!Array.isArray(history)) throw Error('Arquivo de histórico inválido.');
  await db.prepare('INSERT OR REPLACE INTO collector (key, context, current, checked_at, next_check, error) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(KEY, latest.current ? JSON.stringify(latest.current.context) : null, latest.current ? JSON.stringify(latest.current) : null, latest.checkedAt || 0, latest.nextCheck || 0, latest.error || null).run();
  if (history.length) await db.batch(history.map(p => db.prepare('INSERT OR IGNORE INTO snapshots (id, key, observed_at, generated_at, series) VALUES (?, ?, ?, ?, ?)')
    .bind(p.id, KEY, p.observedAt, p.generatedAt, JSON.stringify(p))));
}

export async function exportArchive(db, folder) {
  const latest = await panel({ DB: db }, 0);
  const history = (await db.prepare('SELECT series FROM snapshots WHERE key = ? ORDER BY observed_at').bind(KEY).all()).results.map(r => JSON.parse(r.series));
  const version = history.at(-1)?.observedAt || 0;
  delete latest.history; delete latest.more;
  latest.historyVersion = version;
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'history.json'), JSON.stringify({ version, history }) + '\n');
  await writeFile(join(folder, 'latest.json'), JSON.stringify(latest) + '\n');
  return latest;
}
