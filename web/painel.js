"use strict";
const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const checkClock = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const formatTime = ms => Number.isFinite(ms) ? clock.format(ms) : '—';
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const localPreview = ['127.0.0.1', 'localhost'].includes(location.hostname);
$('testar').hidden = !localPreview;
$('testar').disabled = !localPreview;
const repository = 'driano1221/apuracao-presidencial-2026';
const dataRoot = localPreview ? './data/' : 'https://raw.githubusercontent.com/' + repository + '/dados/';
const refreshMs = localPreview ? 2000 : 65000;
let nextApiCheck = 0;
const demos = [{ id: 'a', name: 'CANDIDATURA A', order: 1 }, { id: 'b', name: 'CANDIDATURA B', order: 2 }, { id: 'c', name: 'CANDIDATURA C', order: 3 }];
const testPoints = Array.from({ length: 181 }, (_, i) => {
  const p = i / 180, total = Math.round(100000000 * (p - Math.sin(p * Math.PI * 2) * .08));
  const a = Math.round(total * (.435 + .045 * p)), b = Math.round(total * (.475 - .045 * p));
  return { id: 'test:' + i, observedAt: Date.UTC(2026, 9, 4, 20, i), total, sections: p * 100, votes: { a, b, c: total - a - b } };
});
let testing = false, index = 0, playing = true, selected = null, state = {}, history = [], historyVersion = null;
let pollTimer, busy = false, previousChartId = null, rowSignature = '';
const seen = new Set();

function displayed() {
  if (testing) {
    const point = testPoints[index];
    return { point, candidates: demos.map(c => ({ ...c, votes: point.votes[c.id], percent: point.total ? point.votes[c.id] / point.total * 100 : 0 })), points: testPoints.slice(0, index + 1) };
  }
  const point = state.current, shown = playing ? history : history.slice(0, index + 1), oldPoint = shown.at(-1);
  const candidates = (point?.candidates || []).map(c => oldPoint && !playing ? { ...c, votes: oldPoint.votes[c.id] ?? null, percent: oldPoint.percentages?.[c.id] ?? null } : c);
  return { point: playing ? point : oldPoint, candidates, points: shown.filter(p => p.sections > 0 || p.total > 0) };
}

function updateTable(candidates) {
  const sorted = [...candidates].sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1) || a.order - b.order);
  const signature = sorted.map(c => c.id + ':' + c.name).join('|');
  if (signature !== rowSignature) {
    const focused = document.activeElement?.dataset?.candidate;
    $('candidaturas').innerHTML = sorted.map(c => `<tr data-row="${escapeHTML(c.id)}"><td><button type="button" class="candidate" data-candidate="${escapeHTML(c.id)}">${escapeHTML(c.name)}</button></td><td></td><td></td></tr>`).join('');
    rowSignature = signature;
    if (focused) [...$('candidaturas').querySelectorAll('button')].find(b => b.dataset.candidate === focused)?.focus();
  }
  $('candidaturas').classList.toggle('official', !testing);
  const byId = new Map(sorted.map(c => [c.id, c]));
  for (const row of $('candidaturas').rows) {
    const c = byId.get(row.dataset.row), active = c.id === selected, button = row.cells[0].firstElementChild;
    row.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', 'Destacar ' + c.name);
    row.cells[1].textContent = c.votes == null ? '—' : integer.format(c.votes);
    row.cells[2].textContent = c.percent == null ? '—' : decimal.format(c.percent) + '%';
  }
}

function drawChart(animate = false) {
  const { points, candidates } = displayed();
  if (!points.length) {
    $('grafico').innerHTML = `<div class="empty"><strong>${state.error && !state.current ? 'Aguardando conexão com o TSE' : 'Aguardando a apuração'}</strong><p>A série começa com os primeiros votos publicados.</p></div>`;
    previousChartId = null; return;
  }
  const width = $('grafico').clientWidth || 680, height = $('grafico').clientHeight || 300;
  const m = { left: width < 500 ? 48 : 58, right: 16, top: 28, bottom: 32 }, w = width - m.left - m.right, h = height - m.top - m.bottom;
  const first = points[0].observedAt, last = points.at(-1).observedAt, span = Math.max(180000, last - first), end = first + span * 1.025;
  const maxValue = points.reduce((max, p) => Math.max(max, ...Object.values(p.votes)), 1);
  const power = 10 ** Math.floor(Math.log10(maxValue)), top = Math.ceil(maxValue / power) * power;
  const x = p => m.left + (p.observedAt - first) / (end - first) * w, y = v => m.top + h - v / top * h;
  const values = v => v >= 1000000 ? decimal.format(v / 1000000) + ' mi' : v >= 1000 ? integer.format(v / 1000) + ' mil' : integer.format(v);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc"><title id="chart-title">${testing ? 'Simulação: ' : ''}Evolução dos votos</title><desc id="chart-desc">${escapeHTML(candidates.map(c => c.name + ': ' + integer.format(c.votes ?? 0)).join('; '))}. Registros observados até ${formatTime(last)}. Retas conectam os registros; somente os pontos são observações.</desc>`;
  [0, top / 2, top].forEach(v => { svg += `<line x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}" stroke="#324584" stroke-width=".7"/><text x="${m.left - 9}" y="${y(v) + 4}" text-anchor="end">${values(v)}</text>`; });
  [0, .5, 1].forEach(f => { const t = first + (last - first) * f; svg += `<text x="${x({ observedAt: t })}" y="${m.top + h + 25}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${formatTime(t)}</text>`; });
  const newTail = animate && !reducedMotion.matches && previousChartId === points.at(-2)?.id;
  [...candidates].sort((a, b) => (a.id === selected) - (b.id === selected)).forEach(c => {
    const active = c.id === selected, color = active ? '#9df0b2' : '#788eb9', valid = points.filter(p => Number.isFinite(p.votes[c.id]));
    const core = newTail ? valid.slice(0, -1) : valid;
    const path = core.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(2)},${y(p.votes[c.id]).toFixed(2)}`).join(' ');
    svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${active ? 2.3 : 1.2}" stroke-linejoin="round"/>`;
    if (newTail && valid.length > 1) {
      const [a, b] = valid.slice(-2), length = Math.hypot(x(b) - x(a), y(b.votes[c.id]) - y(a.votes[c.id]));
      svg += `<path class="tail" d="M${x(a)},${y(a.votes[c.id])} L${x(b)},${y(b.votes[c.id])}" fill="none" stroke="${color}" stroke-width="${active ? 2.3 : 1.2}" stroke-dasharray="${length}" data-length="${length}"/>`;
    }
    const p = valid.at(-1);
    if (p) svg += `<circle cx="${x(p)}" cy="${y(p.votes[c.id])}" r="${active ? 3 : 2}" fill="${color}"/>`;
  });
  const chosen = candidates.find(c => c.id === selected);
  if (chosen) svg += `<text x="${width - m.right}" y="14" text-anchor="end" class="direct">${escapeHTML(chosen.name)}</text>`;
  $('grafico').innerHTML = svg + '</svg>';
  if (newTail) for (const path of $('grafico').querySelectorAll('.tail')) path.animate([{ strokeDashoffset: Number(path.dataset.length) }, { strokeDashoffset: 0 }], { duration: 300, easing: 'ease-out' });
  previousChartId = points.at(-1).id;
}

function render(animate = false) {
  const { point, candidates } = displayed();
  const stale = !state.current?.finished && state.checkedAt && Date.now() - state.checkedAt > 180000;
  if (!candidates.some(c => c.id === selected)) selected = [...candidates].sort((a, b) => b.votes - a.votes || a.order - b.order)[0]?.id;
  $('testar').textContent = testing ? 'VOLTAR AO TSE' : 'TESTE';
  $('modo-status').textContent = testing ? 'TESTE · VOTOS FICTÍCIOS' : !playing ? 'HISTÓRICO · TSE' : state.error ? 'CONEXÃO EM ESPERA' : stale ? 'ATUALIZAÇÃO EM ATRASO' : !point || (point.total === 0 && point.sectionsCount === 0) ? 'AGUARDANDO DADOS · TSE' : state.current?.finished ? 'APURAÇÃO CONCLUÍDA · TSE' : 'APURAÇÃO · TSE';
  $('modo-status').classList.toggle('test', testing);
  $('percentual').textContent = point?.sections == null ? '—' : decimal.format(point.sections) + '%';
  $('hora').textContent = formatTime(point?.observedAt); $('total').textContent = point?.total == null ? '—' : integer.format(point.total) + ' VOTOS';
  const length = testing ? testPoints.length : history.length;
  $('linha-tempo').hidden = !testing && history.length < 2;
  $('instante').max = Math.max(0, length - 1); $('instante').value = !testing && playing ? length - 1 : index;
  $('instante').setAttribute('aria-label', testing ? 'Horário da simulação' : 'Horário do registro da apuração');
  $('instante-hora').value = formatTime(point?.observedAt);
  $('pausar').textContent = playing ? 'PAUSAR' : testing ? index === testPoints.length - 1 ? 'REINICIAR' : 'CONTINUAR' : 'AO VIVO';
  $('play-status').textContent = testing ? playing ? 'TESTE · ATUALIZAÇÃO A CADA 0,5 S' : 'TESTE PAUSADO' : !playing ? 'HISTÓRICO · VOLTAR AO VIVO' : state.error || stale ? 'COLETA EM ESPERA' : 'ATUALIZAÇÃO · CERCA DE 1 MIN';
  $('fonte-status').textContent = 'Última atualização: ' + (state.checkedAt ? checkClock.format(state.checkedAt) : '—');
  updateTable(candidates); drawChart(animate);
}

async function poll() {
  clearTimeout(pollTimer);
  if (busy) return;
  if (document.hidden) { pollTimer = setTimeout(poll, refreshMs); return; }
  busy = true;
  try {
    let root = dataRoot;
    if (!localPreview && Date.now() >= nextApiCheck) {
      nextApiCheck = Date.now() + refreshMs;
      try {
        // Anonymous GitHub API has a 60/hour/IP limit. One lookup per 65 s;
        // then immutable commit URLs avoid the delayed branch cache entirely.
        const head = await fetch('https://api.github.com/repos/' + repository + '/commits/dados', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (head.status === 403 || head.status === 429) nextApiCheck = Math.max(Date.now() + 600000, Number(head.headers.get('x-ratelimit-reset') || 0) * 1000);
        if (head.ok) {
          const commit = await head.json();
          if (/^[a-f0-9]{40}$/.test(commit.sha)) root = 'https://raw.githubusercontent.com/' + repository + '/' + commit.sha + '/';
        }
      } catch { /* Public branch remains available if the metadata API fails. */ }
    }
    const r = await fetch(root + 'latest.json?consulta=' + Math.floor(Date.now() / refreshMs), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Error('Arquivo temporariamente indisponível.');
    const fresh = await r.json();
    if (!Number.isSafeInteger(fresh.historyVersion) || fresh.historyVersion < 0) throw Error('Resposta do painel inválida.');
    if (fresh.current && (!Array.isArray(fresh.current.candidates) || !Number.isSafeInteger(fresh.current.observedAt))) throw Error('Resultado do painel inválido.');
    if (state.checkedAt && fresh.checkedAt < state.checkedAt) { if (!testing) render(); return; }
    if (historyVersion !== fresh.historyVersion) {
      const hr = await fetch(root + 'history.json?registro=' + fresh.historyVersion, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!hr.ok) throw Error('Histórico temporariamente indisponível.');
      const archive = await hr.json();
      if (!Array.isArray(archive.history) || archive.version < fresh.historyVersion) throw Error('Histórico aguardando publicação.');
      for (const p of archive.history) {
        if (!seen.has(p.id) && p.observedAt <= fresh.historyVersion) { history.push(p); seen.add(p.id); }
      }
      history.sort((a, b) => a.observedAt - b.observedAt);
      historyVersion = fresh.historyVersion;
    }
    state = fresh;
    if (!testing) render(true);
  } catch (error) {
    state = { ...state, error: error.message, nextCheck: Date.now() + 5000 };
    if (!testing) render();
  } finally { busy = false; pollTimer = setTimeout(poll, state.error ? 10000 : refreshMs); }
}

$('testar').addEventListener('click', () => {
  if (!localPreview) return;
  testing = !testing; index = 0; playing = !reducedMotion.matches; selected = null; previousChartId = null;
  if (!testing) playing = true;
  render();
});
$('pausar').addEventListener('click', () => {
  if (testing && index === testPoints.length - 1) { index = 0; playing = true; previousChartId = null; }
  else if (testing) playing = !playing;
  else { if (playing) index = Math.max(0, history.length - 1); playing = !playing; }
  render();
});
$('instante').addEventListener('input', e => { index = Number(e.target.value); playing = false; previousChartId = null; render(); });
$('candidaturas').addEventListener('click', e => { const button = e.target.closest('[data-candidate]'); if (button) { selected = button.dataset.candidate; render(); } });
new ResizeObserver(() => drawChart()).observe($('grafico'));
setInterval(() => {
  if (testing && playing && !document.hidden) { index = Math.min(testPoints.length - 1, index + 1); if (index === testPoints.length - 1) playing = false; render(true); }
}, 500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
render(); poll();
