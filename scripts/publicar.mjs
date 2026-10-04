import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { openStore } from '../collector/sqlite.js';
import { collect, KEY } from '../collector/core.js';
import { restore, exportArchive } from '../collector/archive.js';

const folder = resolve(process.env.ARCHIVE_DIR || 'archive');
const end = Math.min(Date.now() + Number(process.env.DURATION_MS || 18000000), Date.parse('2026-10-05T12:00:00-03:00'));
const db = openStore(process.env.COLLECTOR_DB || 'data/apuracao.sqlite');
let stopping = false, lastPublished = 0, publishedId, publishedError;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

function git(...args) { return execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
async function publish() {
  const latest = await exportArchive(db, folder);
  if (process.env.PUBLISH_GIT === '1') {
    git('add', '--', 'latest.json', 'history.json');
    if (git('diff', '--cached', '--name-only')) {
      git('commit', '-m', 'Atualiza registros públicos do TSE');
    }
    git('push', 'origin', 'HEAD:dados');
  }
  lastPublished = Date.now(); publishedId = latest.current?.id; publishedError = latest.error;
  console.log(new Date(lastPublished).toISOString(), 'Arquivo publicado:', publishedId || 'aguardando fonte', latest.error || 'sem erro');
}

try {
  await restore(db, folder);
  let state = await db.prepare('SELECT * FROM collector WHERE key = ?').bind(KEY).first();
  if (state?.current && JSON.parse(state.current).finished) { console.log('Totalização final já arquivada.'); }
  else if (Date.now() >= end) { console.log('Janela de coleta encerrada. Histórico mantido.'); }
  else {
    while (!stopping && Date.now() < end) {
      await collect({ DB: db });
      state = await db.prepare('SELECT * FROM collector WHERE key = ?').bind(KEY).first();
      const snapshot = state?.current ? JSON.parse(state.current) : null;
      // New generations publish immediately; heartbeat metadata only once a minute.
      if ((snapshot?.id !== publishedId || state?.error !== publishedError || Date.now() - lastPublished >= 60000) && Date.now() - lastPublished >= 10000) {
        try { await publish(); } catch (error) { console.error('Publicação pendente; registros locais preservados:', error.message); await sleep(10000); }
      }
      if (snapshot?.finished) { await publish(); console.log('Totalização final registrada.'); break; }
      await sleep(Math.min(Math.max(100, (state?.next_check || Date.now() + 2000) - Date.now()), 60000));
    }
    await publish();
  }
} finally { db.close(); }
