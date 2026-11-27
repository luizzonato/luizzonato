import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, occurrence, summarize, assess, simulate, parseBRL, formatBRL, dailyBudget } from '../public/calc.js';

const e = (o) => ({ id: 1, description: 'x', method: '', category: 'Outros', months: o.kind === 'expense' ? 1 : null, note: '', ...o });

test('addMonths atravessa o ano', () => {
  assert.equal(addMonths('2026-11', 1), '2026-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('occurrence: parcelas e meses fora do intervalo', () => {
  const p = e({ kind: 'installment', amount_cents: 7800, start_month: '2026-10', months: 3 });
  assert.equal(occurrence(p, '2026-09'), null);
  assert.deepEqual(occurrence(p, '2026-10'), { n: 1, of: 3 });
  assert.deepEqual(occurrence(p, '2026-12'), { n: 3, of: 3 });
  assert.equal(occurrence(p, '2027-01'), null);
  const f = e({ kind: 'fixed', amount_cents: 100, start_month: '2026-01' });
  assert.deepEqual(occurrence(f, '2030-05'), { n: 53, of: null });
});

test('summarize reproduz o exemplo da Edla', () => {
  const entries = [
    e({ kind: 'income', amount_cents: 300000, start_month: '2026-01', description: 'Salário' }),
    e({ kind: 'expense', amount_cents: 50000, start_month: '2026-11', method: 'Nubank', category: 'Cartão' }),
    e({ kind: 'fixed', amount_cents: 17000, start_month: '2026-06', months: 36, method: 'Empréstimo carro', category: 'Empréstimo' }),
    e({ kind: 'expense', amount_cents: 27800, start_month: '2026-11', method: 'Shopee', category: 'Empréstimo' }),
    e({ kind: 'installment', amount_cents: 7800, start_month: '2026-09', months: 10, method: 'Amazon', category: 'Compras' }),
    e({ kind: 'expense', amount_cents: 9999, start_month: '2026-10', method: 'Nubank' }), // outro mês
  ];
  const s = summarize(entries, '2026-11');
  assert.equal(s.income, 300000);
  assert.equal(s.committed, 50000 + 17000 + 27800 + 7800);
  assert.equal(s.leftover, 300000 - 102600);
  assert.ok(Math.abs(s.pct - 34.2) < 0.01);
  assert.equal(s.byMethod[0].name, 'Nubank');
});

test('assess: níveis', () => {
  assert.equal(assess(0, 100, 70).level, 'none');
  assert.equal(assess(100000, 50000, 70).level, 'ok');
  assert.equal(assess(100000, 80000, 70).level, 'warn');
  assert.equal(assess(100000, 120000, 70).level, 'danger');
});

test('simulate soma o gasto extra', () => {
  const r = simulate(100000, 60000, 20000, 70);
  assert.equal(r.after, 80000);
  assert.equal(r.leftover, 20000);
  assert.equal(r.assessment.level, 'warn');
});

test('parseBRL', () => {
  assert.equal(parseBRL('52,90'), 5290);
  assert.equal(parseBRL('1.234,56'), 123456);
  assert.equal(parseBRL('52.90'), 5290);
  assert.equal(parseBRL('R$ 78'), 7800);
  assert.equal(parseBRL('1.000'), 100000);
  assert.equal(parseBRL('1,234.56'), 123456);
  assert.equal(parseBRL('abc'), null);
  assert.equal(parseBRL(''), null);
  assert.equal(parseBRL('1,234'), null);
});

test('formatBRL', () => {
  assert.match(formatBRL(123456), /1\.234,56/);
});

test('dailyBudget só no mês corrente', () => {
  const now = new Date(2026, 10, 27); // 27/nov
  assert.deepEqual(dailyBudget(40000, '2026-11', now), { perDay: 10000, daysLeft: 4 });
  assert.equal(dailyBudget(40000, '2026-10', now), null);
  assert.equal(dailyBudget(-5, '2026-11', now), null);
});

import { shareOf, summarize as sum2 } from '../public/calc.js';
test('divisão: as duas partes somam o total e cada um vê a sua', () => {
  const e = { kind: 'fixed', amount_cents: 10001, start_month: '2026-12', months: 12, category: 'Outros', method: '', owner_id: 1, split_pct: 50 };
  assert.equal(shareOf(e, 1) + shareOf(e, 2), 10001);
  assert.equal(sum2([e], '2026-12', { userId: 1 }).committed, 5001);
  assert.equal(sum2([e], '2026-12', { userId: 2 }).committed, 5000);
  assert.equal(sum2([e], '2026-12').committed, 10001);
});
test('conta sem divisão conta só para quem lançou; renda é pessoal', () => {
  const g = { kind: 'fixed', amount_cents: 20000, start_month: '2026-12', months: null, category: 'Outros', method: '', owner_id: 1, split_pct: null };
  const r = { kind: 'income', amount_cents: 500000, start_month: '2026-12', months: null, category: 'Renda', method: '', owner_id: 2, split_pct: null };
  assert.equal(sum2([g, r], '2026-12', { userId: 2 }).committed, 0);
  assert.equal(sum2([g, r], '2026-12', { userId: 2 }).income, 500000);
  assert.equal(sum2([g, r], '2026-12', { userId: 1 }).income, 0);
});

test('pago: sua parte, soma do casal e recebido', () => {
  const d = { kind: 'fixed', amount_cents: 10000, start_month: '2026-12', months: null, category: 'Outros', method: '', owner_id: 1, split_pct: 50, id: 7 };
  const r = { kind: 'income', amount_cents: 300000, start_month: '2026-12', months: null, category: 'Renda', method: '', owner_id: 1, split_pct: null, id: 8 };
  const pays = [{ entry_id: 7, month: '2026-12', user_id: 1 }, { entry_id: 8, month: '2026-12', user_id: 1 }, { entry_id: 7, month: '2027-01', user_id: 2 }];
  const me = sum2([d, r], '2026-12', { userId: 1 }, pays);
  assert.equal(me.paid, 5000); assert.equal(me.toPay, 0); assert.equal(me.received, 300000);
  const her = sum2([d, r], '2026-12', { userId: 2 }, pays);
  assert.equal(her.paid, 0); assert.equal(her.toPay, 5000);
  const couple = sum2([d, r], '2026-12', null, pays);
  assert.equal(couple.paid, 5000); assert.equal(couple.toPay, 5000);
  assert.equal(sum2([d], '2027-01', { userId: 2 }, pays).toPay, 0); // pago em outro mês não vale
});

import { deltaPct, categoryCompare, endingCommitments } from '../public/calc.js';
test('comparativos: variação, categorias e compromissos que terminam', () => {
  assert.equal(deltaPct(150, 100), 50);
  assert.equal(deltaPct(5, 0), null);
  const base = { method: '', note: '', owner_id: 1, split_pct: null };
  const es = [
    { ...base, id: 1, kind: 'fixed', description: 'Net', amount_cents: 10000, category: 'Casa', start_month: '2026-10', months: null },
    { ...base, id: 2, kind: 'installment', description: 'Sofá', amount_cents: 20000, category: 'Casa', start_month: '2026-11', months: 3 },
    { ...base, id: 3, kind: 'expense', description: 'Pizza', amount_cents: 5000, category: 'Comida', start_month: '2026-12', months: 1 },
  ];
  const cc = categoryCompare(es, '2026-12', { userId: 1 });
  assert.deepEqual(cc.find((r) => r.name === 'Casa'), { name: 'Casa', cur: 30000, prev: 30000 });
  assert.deepEqual(cc.find((r) => r.name === 'Comida'), { name: 'Comida', cur: 5000, prev: 0 });
  const end = endingCommitments(es, '2026-12', { userId: 1 });
  assert.equal(end.length, 1);
  assert.equal(end[0].free_from, '2027-02');
  assert.equal(end[0].cents, 20000);
});

import { goalAlert, paceOfMonth, timeline, fairness, openSplits, fixedWeight } from '../public/calc.js';
test('análises: alerta de meta, ritmo, linha do tempo, equilíbrio, divididas e custos fixos', () => {
  assert.equal(goalAlert(100000, 85000, 100).level, 'soon');
  assert.equal(goalAlert(100000, 105000, 100).level, 'danger');
  assert.equal(goalAlert(0, 10, 70), null);

  const base = { method: '', note: '', category: 'Outros', split_pct: null };
  const es = [
    { ...base, id: 1, owner_id: 1, kind: 'income', description: 'Sal L', amount_cents: 600000, start_month: '2026-12', months: null },
    { ...base, id: 2, owner_id: 2, kind: 'income', description: 'Sal E', amount_cents: 400000, start_month: '2026-12', months: null },
    { ...base, id: 3, owner_id: 1, kind: 'fixed', description: 'Empréstimo', amount_cents: 200000, start_month: '2026-12', months: 2, split_pct: 50 },
    { ...base, id: 4, owner_id: 1, kind: 'expense', description: 'Pizza', amount_cents: 10000, start_month: '2026-12', months: 1 },
  ];
  const t = timeline(es, '2026-12', 3, null, [], 70);
  assert.equal(t.rows.length, 3);
  assert.ok(t.relief && t.relief.m === '2027-02'); // empréstimo termina em jan; some em fev
  const f = fairness(es, '2026-12', 1, 2);
  assert.ok(Math.abs(f.incA - 0.6) < 1e-9);
  const sp = openSplits(es, '2026-12', [{ entry_id: 3, month: '2026-12', user_id: 1 }], 1, 2);
  assert.equal(sp.length, 1); assert.equal(sp[0].a, 100000); assert.equal(sp[0].paidA, true); assert.equal(sp[0].paidB, false);
  const w = fixedWeight(es, '2026-12', { userId: 1 });
  assert.equal(w.fixed, 100000); assert.equal(w.variable, 10000); assert.equal(w.income, 600000);
  const hoje = new Date(2026, 11, 5);
  assert.equal(paceOfMonth({ committed: 100, paid: 0, toPay: 100 }, '2026-12', hoje).status, 'ontrack');
  assert.equal(paceOfMonth({ committed: 100, paid: 100, toPay: 0 }, '2026-12', hoje).status, 'done');
  assert.equal(paceOfMonth({ committed: 100, paid: 0, toPay: 100 }, '2026-11', hoje), null);
});
