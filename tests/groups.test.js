import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BY_CHAR } from '../js/data.js';
import {
  GROUP_SIZE, poolChars, makeGroups, normalizeInput, alignGroup, ladderStep, charsPerMinute, isEraseCode,
} from '../js/groups.js';
import { adaptKeyer, unitMs } from '../js/keyer.js';

test('наборы знаков', () => {
  assert.deepEqual(poolChars('digits', []), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
  assert.ok(poolChars('letters', []).every((ch) => !/\d/.test(ch)));
  assert.equal(poolChars('all', []).length, Object.keys(BY_CHAR).length);
  assert.deepEqual(poolChars('learned', ['Е', 'Т']), ['Е', 'Т']);
});

test('группы по 5 знаков из набора, без повторов подряд', () => {
  const pool = ['Е', 'Т', 'И'];
  const groups = makeGroups(pool, 20);
  assert.equal(groups.length, 20);
  const flat = groups.join('');
  assert.ok(groups.every((g) => g.length === GROUP_SIZE));
  assert.ok([...flat].every((ch) => pool.includes(ch)));
  for (let i = 1; i < flat.length; i++) assert.notEqual(flat[i], flat[i - 1]);
  assert.equal(makeGroups(['Е'], 1)[0], 'ЕЕЕЕЕ');
});

test('ввод: регистр, Ё, латиница по морзе-соответствию, мусор', () => {
  assert.equal(normalizeInput('абв ё'), 'АБВЕ');
  assert.equal(normalizeInput('wq1-x'), 'ВЩ1Ь');
});

test('сверка с выравниванием', () => {
  assert.equal(alignGroup('АБВГД', 'АБВГД').errors, 0);
  const miss = alignGroup('АБВГД', 'АВГД');
  assert.equal(miss.errors, 1);
  assert.deepEqual(miss.cells[1], { t: 'Б', g: null });
  const sub = alignGroup('АБВГД', 'АБХГД');
  assert.equal(sub.errors, 1);
  assert.deepEqual(sub.cells[2], { t: 'В', g: 'Х' });
  assert.equal(alignGroup('АБВГД', '').errors, 5);
});

test('лесенка скорости', () => {
  assert.equal(ladderStep(12, 0), 13);
  assert.equal(ladderStep(12, 1), 12);
  assert.equal(ladderStep(12, 3), 11);
  assert.equal(ladderStep(40, 0), 40);
  assert.equal(ladderStep(5, 5), 5);
});

test('знаки в минуту и знак ошибки', () => {
  assert.equal(charsPerMinute(50, 60000), 50);
  assert.equal(charsPerMinute(25, 30000), 50);
  assert.equal(charsPerMinute(5, 0), 0);
  assert.ok(isEraseCode('......'));
  assert.ok(!isEraseCode('.....'));
});

test('адаптивный ключ подстраивается под медленный темп', () => {
  let unit = unitMs(20); // 60 мс
  const slowDot = 200;
  for (let i = 0; i < 12; i++) unit = adaptKeyer(unit, i % 2 ? slowDot : slowDot * 3).unit;
  assert.ok(Math.abs(unit - slowDot) < 30, `unit=${unit}`);
  assert.equal(adaptKeyer(unit, slowDot).sym, '.');
  assert.equal(adaptKeyer(unit, slowDot * 3).sym, '-');
});
