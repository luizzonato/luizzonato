import { googleConfigured, preloadGoogle, pendingRedirectToken, googleIdToken, googleSignOut } from '/google.js';
import {
  KIND_LABEL, addMonths, currentMonth, monthLabel, summarize, shareOf, levelOf, goalAlert, paceOfMonth, timeline, fairness, openSplits, fixedWeight, deltaPct, categoryCompare, endingCommitments, assess, simulate, dailyBudget, formatBRL, parseBRL,
} from '/calc.js';

// Segurança: todo texto vindo do usuário entra na tela via textContent (nunca innerHTML).
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'cssVars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const state = {
  user: null,
  entries: [],
  categories: [],
  settings: { limit_pct: 70 },
  month: currentMonth(),
  view: 'resumo',
  filterMethod: null,
  simText: '',
  kind: 'expense',
  editingId: null,
  scope: 'me', // 'me' = só a minha parte | 'couple' = tudo que eu posso ver
  partner: null,
  payments: [],
};

// ---------- API ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* resposta sem corpo */ }
  if (res.status === 401 && path !== '/api/google' && path !== '/api/me') {
    state.user = null;
    showAuth(false);
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Algo deu errado. Tente de novo.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- Entrar / cadastro ----------

function showAuth() {
  $('#app').hidden = true;
  const sp = $('#splash');
  sp.hidden = false;
  sp.classList.remove('out');
}

// ---------- App ----------

async function startApp() {
    $('#app').hidden = false;
  const [{ entries, categories, partner, payments }, settings] = await Promise.all([api('/api/entries'), api('/api/settings')]);
  state.entries = entries;
  state.partner = partner;
  state.payments = payments || [];
  state.categories = categories;
  state.settings = settings;
  fillFormStatics();
  render();
}

async function reloadEntries() {
  const { entries, partner, payments } = await api('/api/entries');
  state.partner = partner;
  state.payments = payments || [];
  state.entries = entries;
  render();
}

function avatarEl(user, big = false) {
  if (user.avatar) return h('img', { class: `avatar${big ? ' big' : ''}`, src: user.avatar, alt: '' });
  // Sem foto: usa a letra da arte do app (L para o Luiz, É para a Édila).
  const letter = user.owner ? 'l' : 'e';
  return h('img', { class: `avatar letter${big ? ' big' : ''}`, src: `/img/letra-${letter}.jpg`, alt: '' });
}

function render() {
  document.body.dataset.view = state.view;
  renderTop();
  const views = { resumo: renderResumo, lancamentos: renderLancamentos, analises: renderAnalises, perfil: renderPerfil, sobre: renderSobre };
  for (const name of Object.keys(views)) $(`#view-${name}`).hidden = name !== state.view;
  views[state.view]();
  for (const b of document.querySelectorAll('.tabs button[data-view]')) b.classList.toggle('active', b.dataset.view === state.view);
  $('#fab').hidden = ['perfil', 'sobre', 'analises'].includes(state.view);
}

// ---------- Menu lateral (desktop): recolhe/expande, lembra a escolha e abre ao passar o mouse ----------

const SIDE_KEY = 'edila.side';
function savedSide() { try { return localStorage.getItem(SIDE_KEY); } catch { return null; } }
function applySide() {
  const pref = savedSide();
  // Recolhe sozinho: abre ao passar o mouse; só fica aberto fixo se a pessoa escolher.
  const side = pref === 'open' ? 'open' : 'mini';
  document.body.dataset.side = side;
  $('#side-collapse').setAttribute('aria-expanded', String(side === 'open'));
}
function toggleSide() {
  const next = document.body.dataset.side === 'open' ? 'mini' : 'open';
  try { localStorage.setItem(SIDE_KEY, next); } catch { /* sem armazenamento: vale só nesta sessão */ }
  // Ao recolher com o mouse em cima, não reabre sozinho até o mouse sair do menu.
  document.body.classList.toggle('no-peek', next === 'mini');
  applySide();
}
// Clicar na letra/nome (logo) volta para o Resumo; recolher/expandir é pelo botão do pé do menu.
$('#side-toggle').addEventListener('click', () => { state.view = 'resumo'; render(); window.scrollTo(0, 0); });
$('#side-collapse').addEventListener('click', toggleSide);
$('#side').addEventListener('mouseleave', () => document.body.classList.remove('no-peek'));
window.addEventListener('resize', applySide);
applySide();

function renderTop() {
  const who = state.user.owner ? 'luiz' : 'edila';
  $('#brand-name').src = `/img/nome-${who}.jpg`;
  $('#brand-letter').src = `/img/letra-${who === 'luiz' ? 'l' : 'e'}.jpg`;
  $('#top-avatar').replaceChildren(avatarEl(state.user));
  $('#hello-name').textContent = state.user.name.split(' ')[0];
  const label = monthLabel(state.month);
  $('#m-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);
}

document.querySelectorAll('.tabs button[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); window.scrollTo(0, 0); }));
$('#top-avatar').addEventListener('click', () => { state.view = 'perfil'; render(); });
$('#m-prev').addEventListener('click', () => { state.month = addMonths(state.month, -1); render(); });
$('#m-next').addEventListener('click', () => { state.month = addMonths(state.month, 1); render(); });
$('#m-label').addEventListener('click', () => { state.month = currentMonth(); render(); });
$('#fab').addEventListener('click', () => openEntry(null));

// ---------- Resumo ----------

function renderResumo() {
  const root = $('#view-resumo');
  const scope = state.scope === 'me' ? { userId: state.user.id } : null;
  const s = summarize(state.entries, state.month, scope, state.payments);
  const limit = state.settings.limit_pct;
  const a = assess(s.income, s.committed, limit);
  const pct = s.pct ?? 0;

  const C = 2 * Math.PI * 80;
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(ns, 'svg');
  svgEl.setAttribute('viewBox', '0 0 190 190');
  svgEl.setAttribute('aria-hidden', 'true');
  const gauge = h('div', { class: 'gauge' },
    svgEl,
    h('div', { class: 'gauge-center' },
      h('strong', { text: s.pct === null ? '—' : `${s.pct.toFixed(0)}%` }),
      h('span', { text: 'da renda' })));
  const svg = svgEl;
  for (const cls of ['track', 'bar']) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '95'); c.setAttribute('cy', '95'); c.setAttribute('r', '80');
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '16'); c.setAttribute('stroke-linecap', 'round');
    if (cls === 'bar') {
      c.setAttribute('stroke-dasharray', String(C));
      c.setAttribute('stroke-dashoffset', String(C * (1 - Math.min(pct, 100) / 100)));
    }
    svg.append(c);
  }

  const daily = dailyBudget(s.leftover, state.month);

  const hero = h('div', { class: `card hero lvl-${a.level}` },
    gauge,
    h('div', { class: 'banner' }, h('strong', { text: a.title }), a.text),
    allPaid(s) && h('div', { class: 'congrats', role: 'status' },
      h('b', { text: '🎉 Parabéns!' }),
      `Todas as contas de ${monthLabel(state.month)} estão pagas${state.scope === 'me' ? '' : ' (do casal)'}.`),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('small', { text: 'Renda' }), h('strong', { text: formatBRL(s.income) })),
      h('div', { class: 'stat' }, h('small', { text: 'Comprometido' }), h('strong', { text: formatBRL(s.committed) })),
      h('div', { class: 'stat left' }, h('small', { text: s.leftover < 0 ? 'Faltando' : 'Sobra' }), h('strong', { text: formatBRL(Math.abs(s.leftover)) }))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('small', { text: 'Recebido' }), h('strong', { text: formatBRL(s.received) })),
      h('div', { class: 'stat' }, h('small', { text: 'Pago' }), h('strong', { text: formatBRL(s.paid) })),
      h('div', { class: 'stat' }, h('small', { text: 'A pagar' }), h('strong', { text: formatBRL(s.toPay) }))),
    daily && h('p', { class: 'muted', text: `Dá para gastar até ${formatBRL(daily.perDay)} por dia nos ${daily.daysLeft} dias que restam.` }));

  // Simulador: "e se eu gastar mais X?"
  const simOut = h('div', { class: 'sim-result', hidden: true });
  const simInput = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Ex.: 150,00', autocomplete: 'off', value: state.simText, 'aria-label': 'Valor que pretendo gastar' });
  const runSim = () => {
    state.simText = simInput.value;
    const extra = parseBRL(simInput.value);
    simOut.hidden = extra === null || extra <= 0;
    if (simOut.hidden) return;
    const r = simulate(s.income, s.committed, extra, limit);
    simOut.className = `sim-result lvl-${r.assessment.level}`;
    simOut.replaceChildren(...(r.pct === null ? ['Cadastre sua renda para simular.'] : [
      'Se gastar ', h('b', { text: formatBRL(extra) }), ': comprometido ', h('b', { text: `${r.pct.toFixed(0)}%` }), ', ',
      r.leftover >= 0 ? 'sobram ' : 'faltam ', h('b', { text: formatBRL(Math.abs(r.leftover)) }), '. ', `${r.assessment.title}.`,
    ]));
  };
  simInput.addEventListener('input', runSim);
  const sim = h('div', { class: 'card sim' }, h('h3', { text: 'E se eu gastar mais…?' }), h('p', { class: 'hint', text: 'Digite um valor e veja como ele mudaria seu mês, sem lançar nada.' }), simInput, simOut);

  const scopeBar = h('div', { class: 'scope', role: 'group', 'aria-label': 'Visão' },
    h('button', { type: 'button', class: state.scope === 'me' ? 'active' : '', text: 'Meu', onclick: () => { state.scope = 'me'; render(); } }),
    h('button', { type: 'button', class: state.scope === 'couple' ? 'active' : '', text: 'Casal', onclick: () => { state.scope = 'couple'; render(); } }));

  root.replaceChildren(scopeBar, kpiCard(s, scope), hero, trendCard(scope),
    coupleCard(), categoryCompareCard(scope), topCard(s), endingCard(scope), sim,
    barsCard('Por cartão / forma de pagamento', s.byMethod, s.committed),
    barsCard('Por categoria', s.byCategory, s.committed, 'desk-hide'));
  runSim();
}

// Evolução: renda x comprometido nos 2 meses anteriores e nos 3 seguintes (para planejar o que vem).
function trendCard(scope) {
  const months = [-2, -1, 0, 1, 2, 3].map((d) => addMonths(state.month, d));
  const data = months.map((m) => ({ m, ...summarize(state.entries, m, scope, state.payments) }));
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.committed]));
  const cols = data.map((d) => h('button', {
    type: 'button', class: `tcol${d.m === state.month ? ' active' : ''}`, 'aria-label': `${monthLabel(d.m)}: renda ${formatBRL(d.income)}, comprometido ${formatBRL(d.committed)}`,
    onclick: () => { state.month = d.m; render(); },
  },
  h('span', { class: 'tbars' },
    h('i', { class: 'inc', cssVars: { '--h': String(Math.round((d.income / max) * 100)) } }),
    h('i', { class: 'exp', cssVars: { '--h': String(Math.round((d.committed / max) * 100)) } })),
  h('small', { text: new Date(Number(d.m.slice(0, 4)), Number(d.m.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') }),
  h('b', { text: d.income > 0 ? `${Math.round((d.committed / d.income) * 100)}%` : '—' })));
  return h('div', { class: 'card trend' },
    h('h3', { text: 'Evolução (renda × comprometido)' }),
    h('div', { class: 'tchart' }, cols),
    h('p', { class: 'legend' }, h('span', { class: 'dot inc' }), 'Renda', h('span', { class: 'dot exp' }), 'Comprometido', h('span', { class: 'muted', text: '· toque num mês para abrir' })));
}

// ---------- Painel de análise (desktop) ----------

const monthShort = (m) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

function deltaTag(cur, prev, goodWhenUp) {
  const d = deltaPct(cur, prev);
  if (d === null || Math.abs(d) < 0.5) return h('small', { class: 'delta flat', text: 'sem base no mês anterior' });
  const up = d > 0;
  const good = up === goodWhenUp;
  return h('small', { class: `delta ${good ? 'good' : 'bad'}`, text: `${up ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}% vs mês anterior` });
}

function kpiCard(s, scope) {
  const prev = summarize(state.entries, addMonths(state.month, -1), scope, state.payments);
  const tile = (label, value, extra, cls = '') => h('div', { class: `kpi ${cls}`.trim() }, h('small', { text: label }), h('strong', { text: formatBRL(value) }), extra || h('small', { class: 'delta flat', text: ' ' }));
  return h('div', { class: 'kpis desk-only' },
    tile('Renda', s.income, deltaTag(s.income, prev.income, true)),
    tile('Comprometido', s.committed, deltaTag(s.committed, prev.committed, false)),
    tile(s.leftover < 0 ? 'Faltando' : 'Sobra', Math.abs(s.leftover), deltaTag(s.leftover, prev.leftover, true), s.leftover < 0 ? 'neg' : ''),
    tile('Recebido', s.received),
    tile('Pago', s.paid),
    tile('A pagar', s.toPay));
}

function coupleCard() {
  const me = state.user;
  const partner = state.partner;
  if (!partner) return h('div', { class: 'card desk desk-only' }, h('h3', { text: 'Luiz × Édila' }), h('p', { class: 'empty', text: 'Quando a outra pessoa entrar no app, a comparação aparece aqui.' }));
  const col = (u) => {
    const s = summarize(state.entries, state.month, { userId: u.id }, state.payments);
    return { name: u.name.split(' ')[0], s, pct: s.income > 0 ? Math.min(100, Math.round((s.committed / s.income) * 100)) : 0 };
  };
  const a = col(me);
  const b = col({ id: partner.id, name: partner.name });
  const row = (label, f) => h('div', { class: 'vs-row' }, h('span', { class: 'muted', text: label }), h('b', { text: f(a.s) }), h('b', { text: f(b.s) }));
  const meter = (c) => h('div', { class: 'vs-meter' }, h('div', { class: 'meter' }, h('i', { cssVars: { '--w': String(c.pct) } })), h('small', { text: c.s.income > 0 ? `${c.pct}% da renda` : 'sem renda' }));
  return h('div', { class: 'card desk desk-only' },
    h('h3', { text: `${a.name} × ${b.name}` }),
    h('div', { class: 'vs-head' }, h('span'), h('b', { text: a.name }), h('b', { text: b.name })),
    row('Renda', (x) => formatBRL(x.income)),
    row('Comprometido', (x) => formatBRL(x.committed)),
    row('Sobra', (x) => formatBRL(x.leftover)),
    h('div', { class: 'vs-head' }, h('span', { class: 'muted', text: 'Uso da renda' }), meter(a), meter(b)),
    h('p', { class: 'hint', text: 'Parte de cada um nas contas divididas já está somada. O que é privado não aparece para a outra pessoa.' }));
}

function categoryCompareCard(scope) {
  const rows = categoryCompare(state.entries, state.month, scope, state.payments).slice(0, 7);
  const max = Math.max(1, ...rows.flatMap((r) => [r.cur, r.prev]));
  const body = rows.length
    ? h('div', { class: 'cmp' }, rows.map((r) => {
      const d = deltaPct(r.cur, r.prev);
      return h('div', { class: 'cmp-row' },
        h('header', {}, h('span', { text: r.name }), h('b', { text: formatBRL(r.cur) }),
          h('small', { class: `delta ${d === null ? 'flat' : d > 0 ? 'bad' : 'good'}`, text: d === null ? (r.cur ? 'novo' : '') : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%` })),
        h('div', { class: 'cmp-bars' },
          h('div', { class: 'meter' }, h('i', { class: 'now', cssVars: { '--w': String(Math.round((r.cur / max) * 100)) } })),
          h('div', { class: 'meter thin' }, h('i', { class: 'before', cssVars: { '--w': String(Math.round((r.prev / max) * 100)) } }))));
    }))
    : h('p', { class: 'empty', text: 'Sem gastos para comparar ainda.' });
  return h('div', { class: 'card desk desk-only' },
    h('h3', { text: `Categorias: ${monthShort(state.month)} × ${monthShort(addMonths(state.month, -1))}` }), body,
    h('p', { class: 'legend' }, h('span', { class: 'dot exp' }), 'Este mês', h('span', { class: 'dot old' }), 'Mês anterior'));
}

function topCard(s) {
  const top = s.items.filter((i) => i.kind !== 'income' && i.share_cents > 0).sort((x, y) => y.share_cents - x.share_cents).slice(0, 5);
  const body = top.length
    ? h('ol', { class: 'top' }, top.map((i) => h('li', {}, h('span', { text: i.description }), h('b', { text: formatBRL(i.share_cents) }),
      h('small', { class: 'muted', text: s.committed > 0 ? `${Math.round((i.share_cents / s.committed) * 100)}% do mês` : '' }))))
    : h('p', { class: 'empty', text: 'Nenhum gasto neste mês.' });
  return h('div', { class: 'card desk desk-only' }, h('h3', { text: 'Maiores gastos do mês' }), body);
}

function endingCard(scope) {
  const list = endingCommitments(state.entries, state.month, scope, 8);
  const body = list.length
    ? h('ul', { class: 'ending' }, list.map((e) => h('li', {}, h('span', { text: e.description }), h('b', { text: `libera ${formatBRL(e.cents)}` }),
      h('small', { class: 'muted', text: `a partir de ${monthShort(e.free_from)}/${e.free_from.slice(2, 4)}` }))))
    : h('p', { class: 'empty', text: 'Nenhuma parcela termina nos próximos meses.' });
  return h('div', { class: 'card desk desk-only' }, h('h3', { text: 'Compromissos que terminam' }), body,
    h('p', { class: 'hint', text: 'É dinheiro que volta para o seu mês quando a última parcela é paga.' }));
}

function barsCard(title, rows, total, cls = '') {
  const body = rows.length
    ? h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
      h('header', {}, h('span', { text: r.name }), h('b', { text: formatBRL(r.cents) })),
      h('div', { class: 'meter' }, h('i', { cssVars: { '--w': String(Math.round((r.cents / total) * 100)) } })))))
    : h('p', { class: 'empty', text: 'Nada lançado neste mês ainda. Toque no + para começar.' });
  return h('div', { class: `card ${cls}`.trim() }, h('h3', { text: title }), body);
}

// ---------- Lançamentos ----------

const KIND_ICON = { expense: '🛒', installment: '🧾', fixed: '🔁', income: '💰' };

function renderLancamentos() {
  const root = $('#view-lancamentos');
  const s = summarize(state.entries, state.month, null, state.payments);
  const methods = [...new Set(s.items.filter((i) => i.kind !== 'income').map((i) => i.method || 'Sem forma definida'))];
  if (state.filterMethod && !methods.includes(state.filterMethod)) state.filterMethod = null;

  const chips = h('div', { class: 'chips' },
    [null, ...methods].map((m) => h('button', {
      type: 'button', class: `chip${state.filterMethod === m ? ' active' : ''}`, text: m ?? 'Tudo',
      onclick: () => { state.filterMethod = m; renderLancamentos(); },
    })));

  const items = s.items
    .filter((i) => !state.filterMethod || (i.kind !== 'income' && (i.method || 'Sem forma definida') === state.filterMethod))
    .sort((a, b) => (a.kind === 'income') - (b.kind === 'income') || b.amount_cents - a.amount_cents);

  const total = items.filter((i) => i.kind !== 'income').reduce((t, i) => t + i.amount_cents, 0);

  const list = items.length
    ? h('div', { class: 'list' }, items.map(itemRow))
    : h('p', { class: 'empty', text: 'Nenhum lançamento neste mês.' });

  root.replaceChildren(
    h('div', { class: 'card' }, h('h3', { text: state.filterMethod ? `Total em ${state.filterMethod}` : 'Total de gastos do mês' }), h('strong', { text: formatBRL(total) })),
    methods.length > 1 && chips,
    list);
}

function itemRow(i) {
  let when = '';
  if (i.kind === 'installment') when = `parcela ${i.occ.n}/${i.occ.of}`;
  else if (i.kind === 'fixed' || i.kind === 'income') when = i.occ.of ? `mês ${i.occ.n}/${i.occ.of}` : 'todo mês';
  const splitTxt = i.split_pct !== null && i.split_pct !== undefined && i.kind !== 'income'
    ? `dividida ${i.split_pct}/${100 - i.split_pct} · sua parte ${formatBRL(shareOf(i, state.user.id))}` : '';
  const parts = [i.kind === 'income' ? 'Renda' : i.method || i.category, when, i.created_by && `por ${i.created_by}`, splitTxt,
    i.is_private ? '🔒 privado' : ''].filter(Boolean);
  const mine = shareOf(i, state.user.id) > 0;
  const done = i.paid_by.includes(state.user.id);
  const verb = i.kind === 'income' ? 'recebido' : 'pago';
  const check = mine && h('button', {
    type: 'button', class: `check-btn${done ? ' on' : ''}`, 'aria-pressed': String(done),
    'aria-label': done ? `Desmarcar ${verb}` : `Marcar como ${verb}`, title: done ? `Desmarcar ${verb}` : `Marcar como ${verb}`,
    text: done ? '✓' : '',
    onclick: () => togglePaid(i, !done),
  });
  const main = h('button', { type: 'button', class: 'item', onclick: () => openEntry(i) },
    h('span', { class: `badge${i.kind === 'income' ? ' income' : ''}`, 'aria-hidden': 'true', text: KIND_ICON[i.kind] }),
    h('span', { class: 't' }, h('b', { text: i.description }), h('small', { text: parts.join(' · ') })),
    h('span', { class: `v${i.kind === 'income' ? ' income' : ''}`, text: `${i.kind === 'income' ? '+' : ''}${formatBRL(i.amount_cents)}` }));
  return h('div', { class: `item-row${done ? ' paid' : ''}` }, check || h('span', { class: 'check-spacer' }), main);
}

// Tudo pago = existe algo a pagar no mês e nada falta.
const allPaid = (s) => s.committed > 0 && s.toPay <= 0;

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#3d7bff', '#ff4fa3', '#ffffff', '#3ee0a0', '#ffb938', '#a07bf0'];
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  for (let n = 0; n < 60; n += 1) {
    box.append(h('i', { cssVars: {
      '--x': `${Math.round(Math.random() * 100)}vw`,
      '--dx': `${Math.round((Math.random() - 0.5) * 240)}px`,
      '--d': `${(2.2 + Math.random() * 1.8).toFixed(2)}s`,
      '--delay': `${(Math.random() * 0.5).toFixed(2)}s`,
      '--c': colors[n % colors.length],
      '--r': `${Math.round(Math.random() * 720)}deg`,
    } }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4800);
}

async function togglePaid(entry, paid) {
  const mine = (p) => p.entry_id === entry.id && p.month === state.month && p.user_id === state.user.id;
  const before = state.payments;
  const me = { userId: state.user.id };
  const wasAll = allPaid(summarize(state.entries, state.month, me, before));
  // atualiza na hora; se o servidor recusar, volta ao que era
  state.payments = paid ? [...before, { entry_id: entry.id, month: state.month, user_id: state.user.id }] : before.filter((p) => !mine(p));
  render();
  if (paid && !wasAll && allPaid(summarize(state.entries, state.month, me, state.payments))) {
    confetti();
    toast('🎉 Parabéns! Tudo pago neste mês');
  }
  try {
    await api('/api/payments', { method: 'POST', body: { entry_id: entry.id, month: state.month, paid } });
  } catch (e) {
    state.payments = before;
    render();
    toast(e.message);
  }
}

// ---------- Análises ----------

function scopeBarEl() {
  return h('div', { class: 'scope', role: 'group', 'aria-label': 'Visão' },
    h('button', { type: 'button', class: state.scope === 'me' ? 'active' : '', text: 'Meu', onclick: () => { state.scope = 'me'; render(); } }),
    h('button', { type: 'button', class: state.scope === 'couple' ? 'active' : '', text: 'Casal', onclick: () => { state.scope = 'couple'; render(); } }));
}

const LEVEL_TXT = { ok: 'ok', warn: 'atenção', danger: 'risco', none: '' };
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const monthYY = (m) => `${monthShort(m)}/${m.slice(2, 4)}`;

function paceCard(s, scope) {
  const limit = state.settings.limit_pct;
  const alert = goalAlert(s.income, s.committed, limit);
  const pace = paceOfMonth(s, state.month);
  const daily = dailyBudget(s.leftover, state.month);
  const kids = [h('h3', { text: 'Ritmo do mês' })];

  if (alert) {
    const msg = {
      danger: 'Você já comprometeu mais do que ganha neste mês.',
      warn: `Passou da meta de ${limit}% da renda.`,
      soon: `Você já usou ${pctTxt(alert.used)} da meta de ${limit}%. Cuidado com novos gastos.`,
      ok: `Usou ${pctTxt(alert.used)} da meta de ${limit}%. Tem folga.`,
    }[alert.level];
    kids.push(h('div', { class: `insight ${alert.level}` }, h('b', { text: alert.title }), msg));
  } else {
    kids.push(h('div', { class: 'insight none' }, h('b', { text: 'Cadastre uma renda' }), 'Sem renda no mês não dá para medir a meta.'));
  }

  if (pace) {
    const msg = {
      done: 'Tudo pago. Pode respirar. 🎉',
      ahead: 'Você está adiantado nos pagamentos em relação ao mês.',
      ontrack: 'Os pagamentos estão no ritmo do mês.',
      behind: `Atenção: o mês já passou bastante e ainda falta pagar ${formatBRL(s.toPay)}.`,
    }[pace.status];
    kids.push(
      h('div', { class: 'pace' },
        h('div', { class: 'pace-track' },
          h('i', { class: 'paid', cssVars: { '--w': String(Math.round(pace.paidPct * 100)) } }),
          h('span', { class: 'now', cssVars: { '--w': String(Math.round(pace.elapsed * 100)) }, title: 'Hoje' })),
        h('div', { class: 'pace-legend' },
          h('span', {}, h('b', { text: pctTxt(pace.paidPct) }), ' das contas pagas'),
          h('span', {}, h('b', { text: pctTxt(pace.elapsed) }), ' do mês passou'))),
      h('p', { class: 'muted', text: msg }));
  } else {
    kids.push(h('p', { class: 'muted', text: 'O ritmo só aparece no mês atual. Toque na data do topo para voltar a ele.' }));
  }

  kids.push(h('div', { class: 'stats' },
    h('div', { class: 'stat' }, h('small', { text: 'Livre por dia' }), h('strong', { text: daily ? formatBRL(daily.perDay) : '—' })),
    h('div', { class: 'stat' }, h('small', { text: 'Dias restantes' }), h('strong', { text: daily ? String(daily.daysLeft) : '—' })),
    h('div', { class: 'stat' }, h('small', { text: 'A pagar' }), h('strong', { text: formatBRL(s.toPay) }))));
  return h('div', { class: 'card' }, ...kids);
}

function timelineCard(scope) {
  const limit = state.settings.limit_pct;
  const t = timeline(state.entries, state.month, 12, scope, state.payments, limit);
  const top = Math.max(110, ...t.rows.map((r) => r.pct || 0));
  const cols = t.rows.map((r) => h('button', {
    type: 'button', class: `tl lvl-${r.level}${r.m === state.month ? ' active' : ''}`,
    'aria-label': `${monthLabel(r.m)}: ${r.pct === null ? 'sem renda' : `${Math.round(r.pct)}% da renda`}`,
    onclick: () => { state.month = r.m; render(); },
  },
  h('b', { text: r.pct === null ? '—' : `${Math.round(r.pct)}%` }),
  h('span', { class: 'tl-bar' }, h('i', { cssVars: { '--h': String(r.pct === null ? 0 : Math.round((Math.min(r.pct, top) / top) * 100)) } })),
  h('small', { text: monthShort(r.m) })));
  const notes = [];
  if (t.risk.length) notes.push(h('div', { class: 'insight danger' }, h('b', { text: 'Meses de risco' }), `${t.risk.map((r) => monthYY(r.m)).join(', ')}: 90% da renda ou mais já comprometida.`));
  else notes.push(h('div', { class: 'insight ok' }, h('b', { text: 'Sem meses de risco' }), 'Nenhum dos próximos 12 meses passa de 90% da renda.'));
  if (t.relief) notes.push(h('div', { class: 'insight ok' }, h('b', { text: `Alivia em ${monthYY(t.relief.m)}` }), `O comprometimento cai ${formatBRL(t.relief.cents)} nesse mês.`));
  return h('div', { class: 'card wide' },
    h('h3', { text: 'Próximos 12 meses: uso da renda' }),
    h('div', { class: 'tl-chart', cssVars: { '--meta': String(Math.round((limit / top) * 100)) } }, h('span', { class: 'tl-meta', text: `meta ${limit}%` }), ...cols),
    h('div', { class: 'notes' }, ...notes),
    h('p', { class: 'hint', text: 'Lance contas fixas e parcelas dos meses seguintes para esta linha ficar mais fiel. Toque num mês para abri-lo.' }));
}

function fairCard() {
  const me = state.user;
  const p = state.partner;
  const f = p ? fairness(state.entries, state.month, me.id, p.id, state.payments) : null;
  const a = me.name.split(' ')[0];
  const b = p ? p.name.split(' ')[0] : '';
  if (!f) {
    return h('div', { class: 'card' }, h('h3', { text: 'Proporção justa' }),
      h('p', { class: 'empty', text: p ? 'Cadastre a renda de cada um para comparar quem paga quanto.' : 'Quando a outra pessoa entrar no app, a comparação aparece aqui.' }));
  }
  const bar = (label, x) => h('div', { class: 'fair-row' },
    h('span', { class: 'muted', text: label }),
    h('div', { class: 'fair-bar' }, h('i', { class: 'a', cssVars: { '--w': String(Math.round(x * 100)) } })),
    h('b', { text: `${a} ${pctTxt(x)}` }), h('b', { text: `${b} ${pctTxt(1 - x)}` }));
  const gapPts = Math.round(Math.abs(f.gap) * 100);
  const msg = gapPts <= 5 ? 'As contas estão bem proporcionais à renda de cada um. 👏'
    : f.gap > 0 ? `${a} paga ${gapPts} pontos a mais nas contas do que pesa na renda do casal.`
      : `${b} paga ${gapPts} pontos a mais nas contas do que pesa na renda do casal.`;
  return h('div', { class: 'card' }, h('h3', { text: 'Proporção justa' }),
    bar('Peso na renda', f.incA), bar('Peso nas contas', f.costA),
    h('div', { class: `insight ${gapPts <= 5 ? 'ok' : 'soon'}` }, h('b', { text: gapPts <= 5 ? 'Equilibrado' : 'Vale conversar' }), msg),
    h('p', { class: 'hint', text: 'É um retrato do mês para conversa, não uma cobrança.' }));
}

function splitsCard() {
  const me = state.user;
  const p = state.partner;
  if (!p) return h('div', { class: 'card' }, h('h3', { text: 'Contas divididas em aberto' }), h('p', { class: 'empty', text: 'Aparece quando a outra pessoa entrar no app.' }));
  const rows = openSplits(state.entries, state.month, state.payments, me.id, p.id);
  const a = me.name.split(' ')[0];
  const b = p.name.split(' ')[0];
  const owedA = rows.filter((r) => !r.paidA).reduce((t, r) => t + r.a, 0);
  const owedB = rows.filter((r) => !r.paidB).reduce((t, r) => t + r.b, 0);
  const chip = (ok) => h('span', { class: `pill ${ok ? 'ok' : 'open'}`, text: ok ? 'pago' : 'aberto' });
  const body = rows.length
    ? h('div', { class: 'splits' }, rows.map((r) => h('div', { class: 'split-row' },
      h('span', { text: r.description }),
      h('span', { class: 'who' }, h('small', { text: `${a} ${formatBRL(r.a)}` }), chip(r.paidA)),
      h('span', { class: 'who' }, h('small', { text: `${b} ${formatBRL(r.b)}` }), chip(r.paidB)))))
    : h('p', { class: 'empty', text: 'Nenhuma conta dividida neste mês.' });
  return h('div', { class: 'card' }, h('h3', { text: 'Contas divididas em aberto' }), body,
    rows.length > 0 && h('div', { class: 'stats two' },
      h('div', { class: 'stat' }, h('small', { text: `${a} ainda paga` }), h('strong', { text: formatBRL(owedA) })),
      h('div', { class: 'stat' }, h('small', { text: `${b} ainda paga` }), h('strong', { text: formatBRL(owedB) }))));
}

function fixedCard(scope) {
  const w = fixedWeight(state.entries, state.month, scope);
  const total = w.fixed + w.variable;
  const pctF = total > 0 ? Math.round((w.fixed / total) * 100) : 0;
  let msg = 'Lance contas e parcelas para ver o peso do que é fixo.';
  let level = 'none';
  if (w.fixedPct !== null) {
    level = w.fixedPct > 60 ? 'danger' : w.fixedPct > 50 ? 'soon' : 'ok';
    msg = `Os custos fixos levam ${Math.round(w.fixedPct)}% da renda. ${w.fixedPct > 50 ? 'Passou de metade: sobra pouca folga para imprevistos.' : 'Boa margem para imprevistos.'}`;
  }
  return h('div', { class: 'card' }, h('h3', { text: 'Peso dos custos fixos' }),
    h('div', { class: 'split-bar', role: 'img', 'aria-label': `${pctF}% fixo, ${100 - pctF}% variável` },
      h('i', { class: 'fx', cssVars: { '--w': String(pctF) } })),
    h('div', { class: 'pace-legend' },
      h('span', {}, h('b', { text: formatBRL(w.fixed) }), ' fixo (contas e parcelas)'),
      h('span', {}, h('b', { text: formatBRL(w.variable) }), ' variável')),
    h('div', { class: `insight ${level}` }, h('b', { text: w.fixedPct === null ? 'Sem renda' : `${Math.round(w.fixedPct)}% da renda` }), msg));
}

function renderAnalises() {
  const scope = state.scope === 'me' ? { userId: state.user.id } : null;
  const s = summarize(state.entries, state.month, scope, state.payments);
  $('#view-analises').replaceChildren(scopeBarEl(), paceCard(s, scope), fixedCard(scope), timelineCard(scope), fairCard(), splitsCard());
}

// ---------- Sobre ----------

function renderSobre() {
  const letter = state.user.owner ? 'l' : 'e';
  const feature = (icon, title, text) => h('div', { class: 'feat' },
    h('span', { class: 'feat-ico', 'aria-hidden': 'true', text: icon }),
    h('b', { text: title }),
    h('p', { text: text }));
  const secure = (title, text) => h('li', {},
    h('span', { class: 'tick', 'aria-hidden': 'true', text: '✓' }),
    h('div', {}, h('b', { text: title }), h('small', { text: text })));
  const step = (n, title, text) => h('li', {},
    h('span', { class: 'step-n', text: String(n) }),
    h('div', {}, h('b', { text: title }), h('small', { text: text })));

  $('#view-sobre').replaceChildren(
    h('div', { class: 'about-hero' },
      h('img', { class: 'about-logo', src: `/img/letra-${letter}.jpg`, alt: '', width: '84', height: '84' }),
      h('div', { class: 'about-title' },
        h('h2', { text: 'Couple Bank' }),
        h('p', { text: 'As finanças do casal, em sintonia: o que entra, o que sai e quanto sobra em cada mês.' }),
        h('div', { class: 'chips-row' },
          h('span', { class: 'chip-info', text: 'Versão 1.0' }),
          h('span', { class: 'chip-info', text: 'Dados na nuvem' }),
          h('span', { class: 'chip-info', text: 'Entrada com Google' })))),

    h('section', { class: 'about-sec' },
      h('h3', { text: 'O que o app faz' }),
      h('div', { class: 'feat-grid' },
        feature('📊', 'Resumo do mês', 'Renda, comprometido e sobra, com meta de uso da renda e o quanto já foi pago.'),
        feature('👥', 'Meu e Casal', 'Veja só a sua parte ou tudo junto, sem misturar o que é de cada um.'),
        feature('🤝', 'Contas divididas', 'Um lançamento só, com a parte de cada pessoa. Cada um marca a própria parte como paga.'),
        feature('🔒', 'Lançamentos privados', 'Itens marcados como privados ficam escondidos da outra pessoa.'),
        feature('📈', 'Análises', 'Ritmo do mês, próximos 12 meses, proporção entre os dois e peso dos custos fixos.'),
        feature('🎉', 'Pago e recebido', 'Marque o que já foi pago ou recebido. Quando tudo do mês estiver quitado, tem comemoração.'))),

    h('div', { class: 'about-cols' },
      h('section', { class: 'about-sec' },
        h('h3', { text: 'Seus dados e segurança' }),
        h('ul', { class: 'tick-list' },
          secure('Guardados na nuvem', 'Ficam em banco de dados na Cloudflare, não no celular. Trocou de aparelho, é só entrar de novo.'),
          secure('Acesso restrito', 'Só entram as contas Google autorizadas para o casal. Qualquer outra é recusada pelo servidor.'),
          secure('Sem senha para decorar', 'O login é feito pelo Google, que cuida da senha e da verificação.'),
          secure('Sessão por 30 dias', 'Depois disso o app pede o login de novo. Para sair antes, use o botão Sair no Perfil.'),
          secure('No aparelho', 'Fica só a casca do app (telas e ícones). Nenhum valor financeiro é guardado no celular.'))),

      h('section', { class: 'about-sec' },
        h('h3', { text: 'Como usar' }),
        h('ol', { class: 'step-list' },
          step(1, 'Lance a renda', 'Toque no + e escolha Renda. O salário pode se repetir todo mês.'),
          step(2, 'Lance as contas', 'Fixas (internet, aluguel), parceladas ou gastos avulsos. Informe o total ou a parcela.'),
          step(3, 'Planeje à frente', 'Use as setas do mês para lançar o que vem. Os meses seguintes já refletem.'),
          step(4, 'Marque como pago', 'Toque no círculo ao lado do lançamento quando pagar ou receber.'),
          step(5, 'Confira as Análises', 'Veja o ritmo do mês e se algum mês à frente está apertado.')))),

    h('footer', { class: 'about-foot' },
      h('span', {}, 'Conectado como ', h('b', { text: state.user.name })),
      h('span', { class: 'muted', text: 'Couple Bank · versão 1.0' })));
}

// ---------- Perfil ----------

function renderPerfil() {
  const root = $('#view-perfil');
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const avatar = await resizeAvatar(file);
      await api('/api/avatar', { method: 'PUT', body: { avatar } });
      state.user.avatar = avatar;
      render();
      toast('Foto atualizada ✨');
    } catch (err) {
      toast(err.message || 'Não consegui usar essa foto.');
    }
  });

  const slider = h('input', { class: 'slider', type: 'range', min: '30', max: '100', step: '5', value: String(state.settings.limit_pct), 'aria-label': 'Meta de comprometimento da renda' });
  const sliderLabel = h('b', { text: `${state.settings.limit_pct}%` });
  slider.addEventListener('input', () => { sliderLabel.textContent = `${slider.value}%`; });
  slider.addEventListener('change', async () => {
    try {
      state.settings = await api('/api/settings', { method: 'PUT', body: { limit_pct: Number(slider.value) } });
      toast('Meta salva');
    } catch (err) { toast(err.message); }
  });

  root.replaceChildren(
    h('div', { class: 'card profile-head' },
      avatarEl(state.user, true),
      h('strong', { text: state.user.name }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', text: 'Trocar foto', onclick: () => fileInput.click() }),
        h('button', { class: 'btn', type: 'button', text: 'Remover', disabled: !state.user.avatar, onclick: async () => {
          await api('/api/avatar', { method: 'PUT', body: { avatar: null } });
          state.user.avatar = null;
          render();
        } })),
      fileInput),
    h('div', { class: 'card' },
      h('h3', { text: 'Meta de comprometimento da renda' }),
      h('p', {}, 'Avisar quando os gastos passarem de ', sliderLabel, ' da renda.'),
      slider,
      h('p', { class: 'hint', text: 'Dica: quem quer sobrar para guardar costuma usar entre 60% e 70%.' })),
    h('div', { class: 'card' },
      h('h3', { text: 'Instalar no celular' }),
      h('ol', { class: 'steps' },
        h('li', { text: 'Android (Chrome): abra o endereço, toque em ⋮ e em “Instalar app”.' }),
        h('li', { text: 'iPhone (Safari): abra o endereço, toque em Compartilhar e em “Adicionar à Tela de Início”.' }),
        h('li', { text: 'Pronto: aparece um ícone como qualquer aplicativo.' }))),
    h('button', { class: 'btn danger', type: 'button', text: 'Sair', onclick: async () => {
      try { await api('/api/logout', { method: 'POST' }); await googleSignOut(); } catch { /* já deslogada */ }
      state.user = null;
      showAuth(false);
    } }));
}

// Recorta no centro (quadrado), reduz para 256px e comprime: foto leve e sem metadados (GPS etc.).
async function resizeAvatar(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma foto JPG, PNG ou WebP.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Foto muito grande.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = 256;
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- Formulário de lançamento ----------

const KIND_CFG = {
  expense: { amount: 'Valor', monthsLabel: null, start: 'Mês do gasto', method: true },
  installment: { amount: 'Valor da parcela', monthsLabel: 'Nº de parcelas', monthsRequired: true, start: 'Mês da 1ª parcela', method: true },
  fixed: { amount: 'Valor por mês', monthsLabel: 'Duração (meses)', monthsHint: 'vazio = sem fim', start: 'A partir de', method: true },
  income: { amount: 'Valor', monthsLabel: 'Duração (meses)', monthsHint: 'vazio = todo mês', start: 'A partir de', method: false },
};

function fillFormStatics() {
  const seg = $('#kind-seg');
  seg.replaceChildren(...Object.entries(KIND_LABEL).map(([k, label]) => h('button', {
    type: 'button', role: 'radio', 'data-kind': k, 'aria-checked': 'false', text: label,
    onclick: () => setKind(k),
  })));
  const sel = $('#entry-form [name=category]');
  sel.replaceChildren(...state.categories.filter((c) => c !== 'Renda').map((c) => h('option', { value: c, text: c })));
  const methods = new Set(['Nubank', 'Pix', 'Débito', 'Dinheiro']);
  for (const e of state.entries) if (e.method) methods.add(e.method);
  $('#methods').replaceChildren(...[...methods].map((m) => h('option', { value: m })));
}

function splitPartnerName() { return state.partner ? state.partner.name : 'o outro'; }

function updateSplitUI() {
  const f = $('#entry-form');
  const priv = f.is_private.checked;
  const income = state.kind === 'income';
  $('#f-split').hidden = income || priv;
  const on = f.split_on.checked && !income && !priv;
  $('#split-detail').hidden = !on;
  const pct = Number(f.split_pct.value);
  const ok = Number.isInteger(pct) && pct >= 1 && pct <= 99;
  const total = parseBRL(f.amount.value);
  const who = state.editingEntry ? state.editingEntry.created_by || 'quem lançou' : state.user.name;
  $('#split-label').textContent = `Parte de ${who} (%)`;
  $('#split-hint').textContent = ok
    ? `${splitPartnerName()} fica com ${100 - pct}%${total ? `: ${formatBRL(total - Math.round((total * pct) / 100))} por mês` : ''}.`
    : 'Informe um número de 1 a 99.';
}
$('#entry-form').addEventListener('input', updateSplitUI);
$('#entry-form').addEventListener('change', updateSplitUI);

function setKind(kind) {
  state.kind = kind;
  const cfg = KIND_CFG[kind];
  for (const b of document.querySelectorAll('#kind-seg button')) b.setAttribute('aria-checked', String(b.dataset.kind === kind));
  $('#amount-label').textContent = cfg.amount;
  $('#start-label').textContent = cfg.start;
  $('#f-months').hidden = !cfg.monthsLabel;
  if (cfg.monthsLabel) {
    $('#months-label').textContent = cfg.monthsLabel;
    $('#entry-form [name=months]').placeholder = cfg.monthsHint || 'Ex.: 10';
  }
  $('#f-method').hidden = !cfg.method;
  $('#f-category').hidden = kind === 'income';
  updateTotalHint();
  updateSplitUI();
}

function updateTotalHint() {
  const f = $('#entry-form');
  const hint = $('#total-hint');
  const cents = parseBRL(f.amount.value);
  const n = Number(f.months.value);
  const show = state.kind === 'installment' && cents && n >= 2;
  $('#f-istotal').hidden = state.kind !== 'installment';
  hint.hidden = !show;
  if (show) {
    hint.textContent = f.is_total.checked
      ? `Parcela de ${formatBRL(Math.round(cents / n))} por mês, em ${n}x`
      : `Total da compra: ${formatBRL(cents * n)} em ${n}x`;
  }
}
$('#entry-form').addEventListener('input', updateTotalHint);

function openEntry(entry) {
  const f = $('#entry-form');
  f.reset();
  fillFormStatics();
  $('#entry-error').textContent = '';
  state.editingId = entry ? entry.id : null;
  state.editingEntry = entry || null;
  $('#f-private').hidden = !state.user.owner;
  f.split_on.checked = Boolean(entry && entry.split_pct);
  f.split_pct.value = entry && entry.split_pct ? String(entry.split_pct) : '50';
  f.is_private.checked = Boolean(entry && entry.is_private);
  f.is_total.checked = false;
  $('#entry-title').textContent = entry ? 'Editar lançamento' : 'Novo lançamento';
  $('#entry-delete').hidden = !entry;
  f.start_month.value = entry ? entry.start_month : state.month;
  if (entry) {
    f.description.value = entry.description;
    f.amount.value = (entry.amount_cents / 100).toFixed(2).replace('.', ',');
    f.method.value = entry.method;
    f.category.value = entry.category;
    f.note.value = entry.note;
    f.months.value = entry.kind === 'expense' || entry.months === null ? '' : String(entry.months);
  }
  setKind(entry ? entry.kind : 'expense');
  $('#entry-dialog').showModal();
}

$('#entry-close').addEventListener('click', () => $('#entry-dialog').close());
$('#entry-dialog').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });

$('#entry-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const err = $('#entry-error');
  err.textContent = '';
  const kind = state.kind;
  const cfg = KIND_CFG[kind];

  let amount = parseBRL(f.amount.value);
  if (!f.description.value.trim()) return void (err.textContent = 'Escreva uma descrição.');
  if (!amount || amount <= 0) return void (err.textContent = 'Informe um valor válido, como 52,90.');
  if (!/^\d{4}-\d{2}$/.test(f.start_month.value)) return void (err.textContent = 'Escolha o mês.');

  let months = null;
  if (kind === 'expense') months = 1;
  else {
    const raw = f.months.value.trim();
    if (raw) {
      months = Number(raw);
      if (!Number.isInteger(months) || months < 1) return void (err.textContent = 'Número de meses inválido.');
    }
    if (cfg.monthsRequired && (months === null || months < 2)) return void (err.textContent = 'Informe o número de parcelas (2 ou mais).');
  }

  if (kind === 'installment' && f.is_total.checked && amount && months) amount = Math.round(amount / months);
  if (!amount || amount <= 0) return void (err.textContent = 'Informe um valor válido, como 52,90.');

  const body = {
    kind,
    description: f.description.value.trim(),
    amount_cents: amount,
    method: cfg.method ? f.method.value.trim() : '',
    category: kind === 'income' ? 'Renda' : f.category.value,
    start_month: f.start_month.value,
    months,
    note: f.note.value.trim(),
    split_pct: null,
    is_private: state.user.owner && f.is_private.checked,
  };
  if (f.split_on.checked && kind !== 'income' && !body.is_private) {
    const pct = Number(f.split_pct.value);
    if (!Number.isInteger(pct) || pct < 1 || pct > 99) return void (err.textContent = 'A divisão deve ser entre 1% e 99%.');
    body.split_pct = pct;
  }

  const save = $('#entry-save');
  save.disabled = true;
  try {
    if (state.editingId) await api(`/api/entries/${state.editingId}`, { method: 'PUT', body });
    else await api('/api/entries', { method: 'POST', body });
    $('#entry-dialog').close();
    await reloadEntries();
    toast('Salvo ✓');
  } catch (e) {
    err.textContent = e.message;
  } finally {
    save.disabled = false;
  }
});

$('#entry-delete').addEventListener('click', async () => {
  if (!state.editingId || !confirm('Excluir este lançamento? Isso apaga todos os meses dele.')) return;
  try {
    await api(`/api/entries/${state.editingId}`, { method: 'DELETE' });
    $('#entry-dialog').close();
    await reloadEntries();
    toast('Excluído');
  } catch (e) { $('#entry-error').textContent = e.message; }
});

// ---------- Início ----------

async function enterWith(user) {
  state.user = user;
  $('#splash').classList.add('out');
  await startApp();
  setTimeout(() => { $('#splash').hidden = true; }, 450);
}

async function finishGoogle(idToken) {
  if (!idToken) return;
  const { user } = await api('/api/google', { method: 'POST', body: { idToken } });
  await enterWith(user);
}

$('#splash').addEventListener('click', async () => {
  const err = $('#splash-error');
  err.textContent = '';
  try {
    let user = null;
    try { user = (await api('/api/me')).user; } catch { /* sem sessão: pede o Google */ }
    if (user) return await enterWith(user);
    if (!googleConfigured()) { err.textContent = 'Login com Google ainda não configurado.'; return; }
    await finishGoogle(await googleIdToken());
  } catch (e) {
    err.textContent = e.status === 403 ? e.message : 'Não foi possível entrar. Toque de novo.';
  }
});

preloadGoogle();
pendingRedirectToken().then(finishGoogle).catch(() => {});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
