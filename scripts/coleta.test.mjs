import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../collector/sqlite.js';
import { discover, parseResult, collect, retryDelay, KEY, seriesPoint } from '../collector/core.js';
import { restore, exportArchive } from '../collector/archive.js';

const config = JSON.parse(await readFile(new URL('../fixtures/configuracao.json', import.meta.url)));
const original = JSON.parse(await readFile(new URL('../fixtures/br.json', import.meta.url)));
const context = discover(config);
const copy = () => structuredClone(original);
const candidates = j => j.carg[0].agr.flatMap(a => a.par.flatMap(p => p.cand));

test('EA11 identifica o contexto; EA20 não transforma campos ausentes em zero', () => {
  assert.equal(context.election, '6257');
  assert.equal(parseResult(original, context).candidates.length, 12);
  const j = copy(); delete candidates(j)[0].vap;
  assert.throws(() => parseResult(j, context), /Campo inválido/);
  const wrong = copy(); wrong.ele = '6259';
  assert.throws(() => parseResult(wrong, context), /contexto/);
  const missingPercent = copy(); delete candidates(missingPercent)[0].pvap; delete candidates(missingPercent)[0].pvapn;
  assert.equal(parseResult(missingPercent, context).candidates[0].percent, null);
});

test('arquivo público recupera o histórico completo e respeita o bloqueio após reinício', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'apuracao-check-'));
  const db = openStore(join(folder, 'original.sqlite'));
  const next = openStore(join(folder, 'recuperado.sqlite'));
  try {
    const snapshot = parseResult(original, context, 1000);
    const cooldown = Date.now() + 600000;
    await db.prepare('INSERT INTO collector (key, current, checked_at, next_check, error) VALUES (?, ?, ?, ?, ?)')
      .bind(KEY, JSON.stringify(snapshot), Date.now(), cooldown, 'TSE respondeu HTTP 429.').run();
    await db.batch(Array.from({ length: 1005 }, (_, i) => {
      const point = { ...seriesPoint(snapshot), id: 'registro:' + i, observedAt: 1000 + i };
      return db.prepare('INSERT INTO snapshots (id, key, observed_at, generated_at, series) VALUES (?, ?, ?, ?, ?)')
        .bind(point.id, KEY, point.observedAt, point.generatedAt, JSON.stringify(point));
    }));
    const published = await exportArchive(db, join(folder, 'archive'));
    assert.equal(published.historyVersion, 2004);
    assert.equal(published.history, undefined);
    const archive = JSON.parse(await readFile(join(folder, 'archive/history.json'), 'utf8'));
    assert.equal(archive.history.length, 1005);
    await restore(next, join(folder, 'archive'));
    assert.equal((await next.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n, 1005);
    assert.equal((await next.prepare('SELECT * FROM collector').first()).next_check, cooldown);
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error('Não deve consultar durante bloqueio.'); };
    try { await collect({ DB: next }); assert.equal(calls, 0); }
    finally { globalThis.fetch = realFetch; }
  } finally { db.close(); next.close(); await rm(folder, { recursive: true }); }
});

test('coleta em SQLite: concorrência, 304, correção, geração antiga e bloqueio', async () => {
  const db = openStore();
  const realFetch = globalThis.fetch;
  let response = copy(), calls = 0, status = 200;
  globalThis.fetch = async url => {
    if (url.includes('ele-c.json')) return Response.json(config);
    calls++; await new Promise(r => setTimeout(r, 20));
    return status === 304 ? new Response(null, { status }) : Response.json(response, { status, headers: { etag: '"test"' } });
  };
  const row = () => db.prepare('SELECT * FROM collector').first();
  const allow = () => db.prepare('UPDATE collector SET next_check = 0').run();
  try {
    await Promise.all([collect({ DB: db }), collect({ DB: db }), collect({ DB: db })]);
    assert.equal(calls, 1); assert.equal((await row()).error, null);
    status = 304; await allow(); await collect({ DB: db });
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n, 1);
    status = 200; response.hg = '15:00:00'; response.idg = '100'; candidates(response)[0].vap = '100';
    await allow(); await collect({ DB: db });
    response.hg = '15:01:00'; response.idg = '99'; candidates(response)[0].vap = '90';
    await allow(); await collect({ DB: db });
    assert.equal(JSON.parse((await row()).current).candidates[0].votes, 90);
    response.hg = '14:59:00'; response.idg = '101';
    await allow(); await collect({ DB: db });
    assert.match((await row()).error, /anterior/);
    assert.equal(JSON.parse((await row()).current).idg, '99');
    status = 429; await allow(); await collect({ DB: db });
    const blocked = await row();
    assert.ok(blocked.next_check - blocked.checked_at >= 600000);
    const before = calls; await collect({ DB: db }); assert.equal(calls, before);
    assert.equal(retryDelay(403, '900', 1), 900000);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM snapshots').first()).n, 3);
  } finally { globalThis.fetch = realFetch; db.close(); }
});
