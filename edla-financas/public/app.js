import {
  KIND_LABEL, addMonths, currentMonth, monthLabel, summarize, assess, simulate, dailyBudget, formatBRL, parseBRL,
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
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
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

let authMode = 'login';

function showAuth(firstAccess) {
  $('#app').hidden = true;
  $('#auth').hidden = false;
  setAuthMode(firstAccess ? 'register' : 'login');
}

function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('#f-name').hidden = !reg;
  $('#f-invite').hidden = !reg;
  $('#auth-form [name=password]').autocomplete = reg ? 'new-password' : 'current-password';
  $('#auth-sub').textContent = reg ? 'Primeiro acesso: crie sua conta.' : 'Entre para ver suas finanças.';
  $('#auth-submit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#auth-toggle').textContent = reg ? 'Já tenho conta' : 'Primeiro acesso? Criar conta';
  $('#auth-error').textContent = '';
}

$('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));

$('#auth-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const btn = $('#auth-submit');
  btn.disabled = true;
  $('#auth-error').textContent = '';
  try {
    let data;
    if (authMode === 'register') {
      data = await api('/api/register', {
        method: 'POST',
        body: { name: f.get('name'), username: f.get('username'), password: f.get('password'), invite: f.get('invite') },
      });
    } else {
      data = await api('/api/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
    }
    ev.target.reset();
    state.user = data.user;
    await startApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- App ----------

async function startApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  const [{ entries, categories }, settings] = await Promise.all([api('/api/entries'), api('/api/settings')]);
  state.entries = entries;
  state.categories = categories;
  state.settings = settings;
  fillFormStatics();
  render();
}

async function reloadEntries() {
  const { entries } = await api('/api/entries');
  state.entries = entries;
  render();
}

function avatarEl(user, big = false) {
  if (user.avatar) return h('img', { class: `avatar${big ? ' big' : ''}`, src: user.avatar, alt: '' });
  return h('div', { class: `avatar${big ? ' big' : ''}`, 'aria-hidden': 'true', text: (user.name || '?').trim().charAt(0).toUpperCase() });
}

function render() {
  renderTop();
  const views = { resumo: renderResumo, lancamentos: renderLancamentos, perfil: renderPerfil };
  for (const name of Object.keys(views)) $(`#view-${name}`).hidden = name !== state.view;
  views[state.view]();
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.view === state.view);
  $('#fab').hidden = state.view === 'perfil';
}

function renderTop() {
  $('#top-avatar').replaceChildren(avatarEl(state.user));
  $('#hello-name').textContent = state.user.name.split(' ')[0];
  const label = monthLabel(state.month);
  $('#m-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); window.scrollTo(0, 0); }));
$('#top-avatar').addEventListener('click', () => { state.view = 'perfil'; render(); });
$('#m-prev').addEventListener('click', () => { state.month = addMonths(state.month, -1); render(); });
$('#m-next').addEventListener('click', () => { state.month = addMonths(state.month, 1); render(); });
$('#m-label').addEventListener('click', () => { state.month = currentMonth(); render(); });
$('#fab').addEventListener('click', () => openEntry(null));

// ---------- Resumo ----------

function renderResumo() {
  const root = $('#view-resumo');
  const s = summarize(state.entries, state.month);
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
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('small', { text: 'Renda' }), h('strong', { text: formatBRL(s.income) })),
      h('div', { class: 'stat' }, h('small', { text: 'Comprometido' }), h('strong', { text: formatBRL(s.committed) })),
      h('div', { class: 'stat left' }, h('small', { text: s.leftover < 0 ? 'Faltando' : 'Sobra' }), h('strong', { text: formatBRL(Math.abs(s.leftover)) }))),
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
  const sim = h('div', { class: 'card sim' }, h('h3', { text: 'E se eu gastar mais…?' }), simInput, simOut);

  root.replaceChildren(hero, sim,
    barsCard('Por cartão / forma de pagamento', s.byMethod, s.committed),
    barsCard('Por categoria', s.byCategory, s.committed));
  runSim();
}

function barsCard(title, rows, total) {
  const body = rows.length
    ? h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
      h('header', {}, h('span', { text: r.name }), h('b', { text: formatBRL(r.cents) })),
      h('div', { class: 'meter' }, h('i', { cssVars: { '--w': String(Math.round((r.cents / total) * 100)) } })))))
    : h('p', { class: 'empty', text: 'Nada lançado neste mês ainda. Toque no + para começar.' });
  return h('div', { class: 'card' }, h('h3', { text: title }), body);
}

// ---------- Lançamentos ----------

const KIND_ICON = { expense: '🛒', installment: '🧾', fixed: '🔁', income: '💰' };

function renderLancamentos() {
  const root = $('#view-lancamentos');
  const s = summarize(state.entries, state.month);
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
  const parts = [i.kind === 'income' ? 'Renda' : i.method || i.category, when, i.created_by && `por ${i.created_by}`].filter(Boolean);
  return h('button', { type: 'button', class: 'item', onclick: () => openEntry(i) },
    h('span', { class: `badge${i.kind === 'income' ? ' income' : ''}`, 'aria-hidden': 'true', text: KIND_ICON[i.kind] }),
    h('span', { class: 't' }, h('b', { text: i.description }), h('small', { text: parts.join(' · ') })),
    h('span', { class: `v${i.kind === 'income' ? ' income' : ''}`, text: `${i.kind === 'income' ? '+' : ''}${formatBRL(i.amount_cents)}` }));
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

  const pwForm = h('form', { class: 'sheet-form', novalidate: true },
    h('label', { class: 'field' }, 'Senha atual', h('input', { name: 'current', type: 'password', autocomplete: 'current-password', maxlength: '200' })),
    h('label', { class: 'field' }, 'Nova senha (mín. 8 caracteres)', h('input', { name: 'next', type: 'password', autocomplete: 'new-password', maxlength: '200' })),
    h('p', { class: 'error', role: 'alert' }),
    h('button', { class: 'btn', type: 'submit', text: 'Trocar senha' }));
  pwForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(pwForm);
    const err = $('.error', pwForm);
    err.textContent = '';
    try {
      await api('/api/password', { method: 'POST', body: { current: f.get('current'), next: f.get('next') } });
      pwForm.reset();
      toast('Senha trocada');
    } catch (e) { err.textContent = e.message; }
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
    h('div', { class: 'card' }, h('h3', { text: 'Segurança' }), pwForm),
    h('div', { class: 'card' },
      h('h3', { text: 'Instalar no celular' }),
      h('ol', { class: 'steps' },
        h('li', { text: 'Abra o endereço do app no Chrome.' }),
        h('li', { text: 'Toque nos três pontinhos ⋮ e em “Instalar app” (ou “Adicionar à tela inicial”).' }),
        h('li', { text: 'Pronto: aparece um ícone como qualquer aplicativo.' }))),
    h('button', { class: 'btn danger', type: 'button', text: 'Sair', onclick: async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch { /* já deslogada */ }
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
}

function updateTotalHint() {
  const f = $('#entry-form');
  const hint = $('#total-hint');
  const cents = parseBRL(f.amount.value);
  const n = Number(f.months.value);
  const show = state.kind === 'installment' && cents && n >= 2;
  hint.hidden = !show;
  if (show) hint.textContent = `Total da compra: ${formatBRL(cents * n)} em ${n}x`;
}
$('#entry-form').addEventListener('input', updateTotalHint);

function openEntry(entry) {
  const f = $('#entry-form');
  f.reset();
  fillFormStatics();
  $('#entry-error').textContent = '';
  state.editingId = entry ? entry.id : null;
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

  const amount = parseBRL(f.amount.value);
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

  const body = {
    kind,
    description: f.description.value.trim(),
    amount_cents: amount,
    method: cfg.method ? f.method.value.trim() : '',
    category: kind === 'income' ? 'Renda' : f.category.value,
    start_month: f.start_month.value,
    months,
    note: f.note.value.trim(),
  };

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

(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const me = await api('/api/me');
    state.user = me.user;
    await startApp();
  } catch (err) {
    if (err.status === 401) showAuth(Boolean(err.data && err.data.firstAccess));
    else {
      showAuth(false);
      $('#auth-error').textContent = 'Sem conexão com o servidor. Tente de novo.';
    }
  }
})();
