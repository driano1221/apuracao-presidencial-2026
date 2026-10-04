export const DATE = '04/10/2026', TURN = '1', KEY = DATE + ':' + TURN;
const ORIGIN = 'https://resultados.tse.jus.br';
const CONFIG_URL = ORIGIN + '/oficial/comum/config/ele-c.json';
const POLL_MS = 2000;

function fail(message) { throw new Error(message); }
function count(value, field) {
  if (!/^\d+$/.test(String(value))) fail('Campo inválido: ' + field);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) fail('Contagem inválida: ' + field);
  return n;
}
function percentage(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(String(value))) fail('Percentual inválido: ' + field);
  const n = Number(String(value).replace(',', '.'));
  if (n > 100) fail('Percentual fora do intervalo: ' + field);
  return n;
}

export function discover(config) {
  if (config.f !== 'o') fail('Configuração não oficial.');
  const elections = [];
  for (const p of config.pl || []) {
    if (p.dt !== DATE) continue;
    for (const e of p.e || []) {
      if (String(e.t) === TURN && (e.abr || []).some(a => a.cd === 'br' && (a.cp || []).some(c => String(c.cd) === '1'))) {
        elections.push({ cycle: p.c, election: String(e.cd) });
      }
    }
  }
  if (elections.length !== 1) fail('Eleição presidencial não identificada de forma única.');
  const context = elections[0];
  if (!/^ele\d{4}$/.test(context.cycle) || !/^\d+$/.test(context.election)) fail('Identificação da eleição inválida.');
  const dir = (config.arq || []).find(a => a.tp === 'u')?.dir;
  if (typeof dir !== 'string') fail('Diretório EA20 ausente.');
  const replacements = { base: ORIGIN, ambiente: 'oficial', ciclo: context.cycle, cd_eleicao: context.election, uf: 'br' };
  const replaced = dir.replace(/<([^>]+)>/g, (_, name) => replacements[name] ?? fail('Diretório não reconhecido.'));
  const url = new URL(replaced + '/br-c0001-e' + context.election.padStart(6, '0') + '-u.json');
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/oficial/')) fail('Endereço fora da fonte oficial.');
  return { ...context, url: url.href, turn: TURN, date: DATE };
}

export function parseResult(j, context, observedAt = Date.now()) {
  if (String(j.ele) !== context.election || String(j.t) !== TURN || j.f !== 'o' || j.cdabr !== 'br' || j.dv !== 's') fail('Resultado fora do contexto ou ainda não liberado.');
  const cargo = (j.carg || []).filter(c => String(c.cd) === '1');
  if (cargo.length !== 1 || !/^\d+$/.test(String(j.idg))) fail('Cargo ou geração inválida.');
  const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(j.dg);
  if (!date || !/^\d{2}:\d{2}:\d{2}$/.test(j.hg)) fail('Data de geração inválida.');
  const generatedAt = Date.parse(`${date[3]}-${date[2]}-${date[1]}T${j.hg}-03:00`);
  if (!Number.isFinite(generatedAt)) fail('Data de geração inválida.');
  const candidates = [];
  for (const group of cargo[0].agr || []) for (const party of group.par || []) for (const c of party.cand || []) {
    const id = String(c.sqcand || c.n || '');
    if (!id || candidates.some(x => x.id === id) || typeof c.nmu !== 'string' || !c.nmu.trim()) fail('Candidatura inválida ou duplicada.');
    candidates.push({ id, name: c.nmu.trim(), number: String(c.n), party: String(party.sg || ''), votes: count(c.vap, 'vap'), percent: percentage(c.pvapn ?? c.pvap, 'pvap'), order: count(c.seq, 'seq') });
  }
  if (!candidates.length) fail('Resultado sem candidaturas.');
  return {
    id: context.cycle + ':' + context.election + ':br:' + j.idg,
    idg: String(j.idg), observedAt, generatedAt, candidates,
    sections: percentage(j.s?.pstn ?? j.s?.pst, 'pst'), sectionsCount: count(j.s?.st, 'st'),
    sectionsTotal: count(j.s?.ts, 'ts'), total: count(j.v?.tv, 'tv'),
    valid: count(j.v?.vvc, 'vvc'), blank: count(j.v?.vb, 'vb'), null: count(j.v?.tvn, 'tvn'),
    finished: j.tf === 's', context,
  };
}

export function seriesPoint(snapshot) {
  return { id: snapshot.id, observedAt: snapshot.observedAt, generatedAt: snapshot.generatedAt, total: snapshot.total, sections: snapshot.sections, votes: Object.fromEntries(snapshot.candidates.map(c => [c.id, c.votes])), percentages: Object.fromEntries(snapshot.candidates.map(c => [c.id, c.percent])) };
}

export function retryDelay(status, retryAfter, failures, now = Date.now()) {
  const seconds = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) : Math.max(0, (Date.parse(retryAfter) - now) / 1000) || 0;
  if (status === 403 || status === 429) return Math.max(600000, seconds * 1000);
  if (status === 404) return Math.max(300000, seconds * 1000);
  return Math.max(Math.min(120000, 2000 * 2 ** Math.min(failures, 6)), seconds * 1000);
}

// D1 persists both the history and a shared lease: several tabs still make one upstream request.
function database(env) { return env.DB || fail('Banco de histórico indisponível.'); }
async function sourceFetch(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000), redirect: 'manual' });
  if (r.status !== 304 && !r.ok) {
    const error = new Error('TSE respondeu HTTP ' + r.status + '.');
    error.status = r.status; error.retryAfter = r.headers.get('retry-after');
    throw error;
  }
  return r;
}

export async function collect(env) {
  const db = database(env), started = Date.now();
  await db.prepare('INSERT OR IGNORE INTO collector (key) VALUES (?)').bind(KEY).run();
  const lease = await db.prepare('UPDATE collector SET lease_until = ? WHERE key = ? AND lease_until < ? AND next_check <= ? RETURNING *').bind(started + 25000, KEY, started, started).first();
  if (!lease) return;
  let context = lease.context ? JSON.parse(lease.context) : null;
  try {
    if (!context || started - lease.config_at > 3600000) {
      const r = await sourceFetch(CONFIG_URL);
      context = discover(await r.json());
      const changed = lease.context && JSON.parse(lease.context).url !== context.url;
      if (changed) fail('Fonte oficial mudou. Revise o contexto antes de continuar.');
      await db.prepare('UPDATE collector SET context = ?, config_at = ? WHERE key = ?').bind(JSON.stringify(context), Date.now(), KEY).run();
    }
    const headers = {};
    if (lease.etag) headers['if-none-match'] = lease.etag;
    if (lease.modified) headers['if-modified-since'] = lease.modified;
    const r = await sourceFetch(context.url, headers), checkedAt = Date.now();
    const current = lease.current ? JSON.parse(lease.current) : null;
    const interval = current?.finished ? 60000 : POLL_MS;
    if (r.status === 304) {
      if (!current) fail('Resposta 304 sem resultado anterior.');
      await db.prepare('UPDATE collector SET checked_at = ?, next_check = ?, lease_until = 0, failures = 0, error = NULL WHERE key = ?').bind(checkedAt, checkedAt + interval, KEY).run();
      return;
    }
    const snapshot = parseResult(await r.json(), context, checkedAt);
    // IDs are identifiers, not sequence numbers; a newer generation can reduce vote totals.
    if (current && snapshot.generatedAt < current.generatedAt) fail('Arquivo anterior ao último resultado válido; histórico preservado.');
    const next = snapshot.id === current?.id ? current : snapshot;
    const statements = [];
    if (snapshot.id !== current?.id) {
      statements.push(db.prepare('INSERT OR IGNORE INTO snapshots (id, key, observed_at, generated_at, series) VALUES (?, ?, ?, ?, ?)').bind(snapshot.id, KEY, snapshot.observedAt, snapshot.generatedAt, JSON.stringify(seriesPoint(snapshot))));
    }
    statements.push(db.prepare('UPDATE collector SET current = ?, etag = ?, modified = ?, checked_at = ?, next_check = ?, lease_until = 0, failures = 0, error = NULL WHERE key = ?').bind(JSON.stringify(next), r.headers.get('etag'), r.headers.get('last-modified'), checkedAt, checkedAt + (snapshot.finished ? 60000 : POLL_MS), KEY));
    await db.batch(statements);
  } catch (error) {
    const checkedAt = Date.now(), failures = lease.failures + 1;
    await db.prepare('UPDATE collector SET checked_at = ?, next_check = ?, lease_until = 0, failures = ?, error = ? WHERE key = ?').bind(checkedAt, checkedAt + retryDelay(error.status, error.retryAfter, failures, checkedAt), failures, error.message, KEY).run();
    console.error('Coleta:', error.message);
  }
}

export async function panel(env, since) {
  const db = database(env);
  const state = await db.prepare('SELECT * FROM collector WHERE key = ?').bind(KEY).first();
  const history = await db.prepare('SELECT series FROM snapshots WHERE key = ? AND observed_at > ? ORDER BY observed_at LIMIT 1001').bind(KEY, since).all();
  const rows = history.results.slice(0, 1000).map(r => JSON.parse(r.series));
  return {
    current: state?.current ? JSON.parse(state.current) : null,
    history: rows, more: history.results.length > 1000,
    checkedAt: state?.checked_at || null, nextCheck: state?.next_check || null,
    error: state?.error || null, intervalMs: POLL_MS, source: CONFIG_URL,
  };
}

