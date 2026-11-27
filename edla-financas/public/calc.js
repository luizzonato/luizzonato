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

export function summarize(entries, month) {
  let income = 0;
  let committed = 0;
  const byMethod = new Map();
  const byCategory = new Map();
  const items = [];

  for (const e of entries) {
    const occ = occurrence(e, month);
    if (!occ) continue;
    items.push({ ...e, occ });
    if (e.kind === 'income') {
      income += e.amount_cents;
      continue;
    }
    committed += e.amount_cents;
    const method = e.method || 'Sem forma definida';
    byMethod.set(method, (byMethod.get(method) || 0) + e.amount_cents);
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + e.amount_cents);
  }

  const sortDesc = (map) => [...map.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents);
  return {
    income,
    committed,
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
