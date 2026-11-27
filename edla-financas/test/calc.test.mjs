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
