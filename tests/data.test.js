import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARS, GROUPS, BY_CHAR } from '../js/data.js';

test('у каждого знака слогов напева столько же, сколько посылок', () => {
  for (const c of CHARS) assert.equal(c.napev.length, c.code.length, c.ch);
});

test('коды уникальны и состоят из точек и тире', () => {
  const codes = CHARS.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[.-]+$/);
});

test('тире поётся долгим слогом: в слоге тире есть удвоенная гласная', () => {
  for (const c of CHARS) {
    c.napev.forEach((syl, i) => {
      if (c.code[i] === '-') assert.match(syl, /([аоуыэяёеиюй])\1/, `${c.ch}: «${syl}»`);
      else assert.doesNotMatch(syl, /([аоуыэяёеиюй])\1/, `${c.ch}: «${syl}»`);
    });
  }
});

test('группы покрывают все знаки ровно по одному разу', () => {
  const all = GROUPS.flatMap((g) => g.chars);
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, CHARS.length);
  for (const ch of all) assert.ok(BY_CHAR[ch], ch);
});
