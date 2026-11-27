// Regras financeiras do app (sem DOM, testável no Node).

export const KIND_LABEL = {
  expense: 'Gasto',
  installment: 'Parcelado',
  fixed: 'Conta fixa',
  income: 'Renda',
};

export const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

export function addMonths(m, n) {
  const idx = monthIndex(m) + n;
  const y = Math.floor(idx / 12);
  return `${String(y).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(m) {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// Este lançamento cai no mês `month`? Devolve { n, of } (parcela n de `of`) ou null.
export function occurrence(entry, month) {
  const offset = monthIndex(month) - monthIndex(entry.start_month);
  if (offset < 0) return null;
  if (entry.months !== null && entry.months !== undefined && offset >= entry.months) return null;
  return { n: offset + 1, of: entry.months ?? null };
}

// Quanto do valor do lançamento conta para `userId` (em centavos). A parte do parceiro é o que sobra,
// assim as duas partes sempre somam exatamente o valor total.
export function shareOf(entry, userId) {
  const mine = entry.owner_id === userId;
  if (entry.kind === 'income') return mine ? entry.amount_cents : 0;
  if (entry.split_pct === null || entry.split_pct === undefined) return mine ? entry.amount_cents : 0;
  const ownerPart = Math.round((entry.amount_cents * entry.split_pct) / 100);
  return mine ? ownerPart : entry.amount_cents - ownerPart;
}

// scope: null/undefined = tudo que está visível (casal); { userId } = só a parte dessa pessoa.
export function summarize(entries, month, scope = null, payments = []) {
  let income = 0;
  let committed = 0;
  let paid = 0; // gastos já pagos (a sua parte, ou a soma das partes pagas no "Casal")
  let received = 0; // rendas já recebidas
  const payers = new Map(); // id do lançamento -> quem marcou neste mês
  for (const p of payments) {
    if (p.month !== month) continue;
    if (!payers.has(p.entry_id)) payers.set(p.entry_id, []);
    payers.get(p.entry_id).push(p.user_id);
  }
  const byMethod = new Map();
  const byCategory = new Map();
  const items = [];

  for (const e of entries) {
    const occ = occurrence(e, month);
    if (!occ) continue;
    const cents = scope ? shareOf(e, scope.userId) : e.amount_cents;
    const who = payers.get(e.id) || [];
    const doneCents = scope ? (who.includes(scope.userId) ? cents : 0) : who.reduce((t, uid) => t + shareOf(e, uid), 0);
    items.push({ ...e, occ, share_cents: cents, paid_by: who });
    if (cents === 0) continue;
    if (e.kind === 'income') received += doneCents;
    else paid += doneCents;
    if (e.kind === 'income') {
      income += cents;
      continue;
    }
    committed += cents;
    const method = e.method || 'Sem forma definida';
    byMethod.set(method, (byMethod.get(method) || 0) + cents);
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + cents);
  }

  const sortDesc = (map) => [...map.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents);
  return {
    income,
    committed,
    paid,
    toPay: committed - paid,
    received,
    leftover: income - committed,
    pct: income > 0 ? (committed / income) * 100 : null,
    byMethod: sortDesc(byMethod),
    byCategory: sortDesc(byCategory),
    items,
  };
}

// level: none | ok | warn | danger
export function assess(income, committed, limitPct) {
  if (income <= 0) {
    return { level: 'none', title: 'Cadastre sua renda', text: 'Adicione seu salário para eu mostrar quanto da sua renda já está comprometido.' };
  }
  const pct = (committed / income) * 100;
  const limit = (income * limitPct) / 100;
  if (committed > income) {
    return { level: 'danger', title: 'Passou da renda', text: `Você já comprometeu mais do que ganha neste mês (faltam ${formatBRL(committed - income)}). Pare e revise antes de gastar mais.` };
  }
  if (committed > limit) {
    return { level: 'warn', title: 'Acima da sua meta', text: `Você está em ${pct.toFixed(0)}% da renda, acima da meta de ${limitPct}%. Só restam ${formatBRL(income - committed)} livres.` };
  }
  return { level: 'ok', title: 'Dentro da meta', text: `Você está em ${pct.toFixed(0)}% da renda, dentro da meta de ${limitPct}%. Ainda cabem ${formatBRL(limit - committed)} até a meta.` };
}

// "E se eu gastar mais X?"
export function simulate(income, committed, extra, limitPct) {
  const after = committed + extra;
  return { after, leftover: income - after, pct: income > 0 ? (after / income) * 100 : null, assessment: assess(income, after, limitPct) };
}

// Quanto dá para gastar por dia até o fim do mês (só para o mês corrente).
export function dailyBudget(leftover, month, now = new Date()) {
  if (month !== currentMonth(now) || leftover <= 0) return null;
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  return { perDay: Math.floor(leftover / daysLeft), daysLeft };
}

export function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Aceita "52,90", "1.234,56", "52.90", "R$ 78", "500". Devolve centavos (inteiro) ou null.
export function parseBRL(text) {
  if (typeof text !== 'string') return null;
  let s = text.replace(/[R$\s]/g, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // O último separador é o decimal; o outro é milhar.
    const dec = Math.max(lastComma, lastDot);
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else if (lastComma > -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > -1) {
    const parts = s.split('.');
    const looksThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    s = looksThousands ? parts.join('') : s;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

// Variação percentual contra o período anterior (null se não há base de comparação).
export function deltaPct(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

// Categorias: mês atual x mês anterior (na mesma visão), ordenadas pela maior das duas.
export function categoryCompare(entries, month, scope, payments = []) {
  const cur = summarize(entries, month, scope, payments).byCategory;
  const prev = summarize(entries, addMonths(month, -1), scope, payments).byCategory;
  const map = new Map();
  for (const r of cur) map.set(r.name, { name: r.name, cur: r.cents, prev: 0 });
  for (const r of prev) {
    const x = map.get(r.name) || { name: r.name, cur: 0, prev: 0 };
    x.prev = r.cents;
    map.set(r.name, x);
  }
  return [...map.values()].sort((a, b) => Math.max(b.cur, b.prev) - Math.max(a.cur, a.prev));
}

// Parcelas e contas com prazo que terminam nos próximos `horizon` meses: quanto liberam e a partir de quando.
export function endingCommitments(entries, month, scope, horizon = 6) {
  const out = [];
  for (const e of entries) {
    if (e.kind === 'income' || e.kind === 'expense' || e.months === null || e.months === undefined) continue;
    const last = addMonths(e.start_month, e.months - 1);
    const d = monthIndex(last) - monthIndex(month);
    if (d < 0 || d > horizon - 1) continue;
    const cents = scope ? shareOf(e, scope.userId) : e.amount_cents;
    if (cents > 0) out.push({ description: e.description, last, free_from: addMonths(last, 1), cents });
  }
  return out.sort((a, b) => monthIndex(a.last) - monthIndex(b.last));
}

// ---------- Análises ----------

// ok | warn | danger conforme o uso da renda e a meta definida.
export function levelOf(pct, limitPct) {
  if (pct === null) return 'none';
  if (pct > 100) return 'danger';
  if (pct > limitPct) return 'warn';
  return 'ok';
}

// Quanto da meta já foi usada: >= 0.8 "perto", >= 1 "estourou".
export function goalAlert(income, committed, limitPct) {
  if (income <= 0) return null;
  const used = committed / ((income * limitPct) / 100);
  if (committed > income) return { level: 'danger', title: 'Passou da renda', used };
  if (used >= 1) return { level: 'warn', title: 'Meta estourada', used };
  if (used >= 0.8) return { level: 'soon', title: 'Perto da meta', used };
  return { level: 'ok', title: 'Folga na meta', used };
}

// Ritmo do mês: quanto do mês já passou x quanto das contas já foi pago. Só faz sentido no mês corrente.
export function paceOfMonth(summary, month, now = new Date()) {
  if (month !== currentMonth(now)) return null;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate() / days;
  const paidPct = summary.committed > 0 ? summary.paid / summary.committed : 0;
  let status = 'ontrack';
  if (summary.committed > 0 && summary.toPay <= 0) status = 'done';
  else if (paidPct >= elapsed + 0.15) status = 'ahead';
  else if (paidPct <= elapsed - 0.25) status = 'behind';
  return { elapsed, paidPct, status, daysLeft: days - now.getDate() + 1 };
}

// Linha do tempo: uso da renda mês a mês, meses de risco e onde o aperto alivia.
export function timeline(entries, startMonth, n, scope, payments, limitPct) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const m = addMonths(startMonth, i);
    const sm = summarize(entries, m, scope, payments);
    rows.push({ m, income: sm.income, committed: sm.committed, pct: sm.pct, level: levelOf(sm.pct, limitPct) });
  }
  const risk = rows.filter((r) => r.pct !== null && r.pct >= 90);
  let relief = null;
  for (let i = 1; i < rows.length; i += 1) {
    const drop = rows[i - 1].committed - rows[i].committed;
    if (drop > 0 && (!relief || drop > relief.cents)) relief = { m: rows[i].m, cents: drop };
  }
  return { rows, risk, relief };
}

// Proporção justa: parte de cada um na renda do casal x parte de cada um nas contas.
export function fairness(entries, month, idA, idB, payments = []) {
  const a = summarize(entries, month, { userId: idA }, payments);
  const b = summarize(entries, month, { userId: idB }, payments);
  const inc = a.income + b.income;
  const cost = a.committed + b.committed;
  if (inc <= 0 || cost <= 0) return null;
  const incA = a.income / inc;
  const costA = a.committed / cost;
  return { incA, incB: 1 - incA, costA, costB: 1 - costA, gap: costA - incA, a, b };
}

// Contas divididas deste mês e quanto cada um ainda tem a pagar da própria parte.
export function openSplits(entries, month, payments, idA, idB) {
  const paidBy = new Map();
  for (const p of payments) {
    if (p.month !== month) continue;
    if (!paidBy.has(p.entry_id)) paidBy.set(p.entry_id, new Set());
    paidBy.get(p.entry_id).add(p.user_id);
  }
  const rows = [];
  for (const e of entries) {
    if (e.kind === 'income' || e.split_pct === null || e.split_pct === undefined || !occurrence(e, month)) continue;
    const who = paidBy.get(e.id) || new Set();
    rows.push({
      id: e.id, description: e.description,
      a: shareOf(e, idA), b: shareOf(e, idB),
      paidA: who.has(idA), paidB: who.has(idB),
    });
  }
  return rows;
}

// Custos fixos (contas fixas e parcelas) x variáveis (gastos avulsos) na visão escolhida.
export function fixedWeight(entries, month, scope) {
  let fixed = 0;
  let variable = 0;
  let income = 0;
  for (const e of entries) {
    if (!occurrence(e, month)) continue;
    const cents = scope ? shareOf(e, scope.userId) : e.amount_cents;
    if (e.kind === 'income') income += cents;
    else if (e.kind === 'expense') variable += cents;
    else fixed += cents;
  }
  return { fixed, variable, income, fixedPct: income > 0 ? (fixed / income) * 100 : null };
}

// Texto do estado do outro: "online", "visto há 12 min", "visto há 3 h", "visto em 20/11" ou "offline".
export function lastSeenText(lastSeenSec, online, nowSec = Date.now() / 1000) {
  if (online) return 'online';
  if (!lastSeenSec) return 'offline';
  const d = Math.max(0, nowSec - lastSeenSec);
  if (d < 3600) return `visto há ${Math.max(1, Math.round(d / 60))} min`;
  if (d < 86400) return `visto há ${Math.round(d / 3600)} h`;
  const dt = new Date(lastSeenSec * 1000);
  return `visto em ${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
