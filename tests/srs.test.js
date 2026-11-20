import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUPS } from '../js/data.js';
import { emptyProgress, record, stat, unlockedGroupCount, pickNext, makeOptions } from '../js/srs.js';
import { classify, decodePresses, unitMs } from '../js/keyer.js';

test('верный ответ поднимает коробку, ошибка роняет', () => {
  let p = emptyProgress();
  for (let i = 0; i < 4; i++) p = record(p, 'rx', 'А', 'ok');
  assert.equal(stat(p, 'rx', 'А').box, 4);
  p = record(p, 'rx', 'А', 'bad');
  assert.equal(stat(p, 'rx', 'А').box, 1);
  p = record(p, 'rx', 'А', 'hint');
  assert.equal(stat(p, 'rx', 'А').box, 1);
});

test('вторая группа открывается после освоения первой', () => {
  let p = emptyProgress();
  assert.equal(unlockedGroupCount(p), 1);
  for (const ch of GROUPS[0].chars) for (let i = 0; i < 3; i++) p = record(p, 'rx', ch, 'ok');
  assert.equal(unlockedGroupCount(p), 2);
  assert.equal(unlockedGroupCount({ ...emptyProgress(), unlockAll: true }), GROUPS.length);
});

test('выбор не повторяет предыдущий знак и чаще берёт слабые', () => {
  let p = emptyProgress();
  for (let i = 0; i < 5; i++) p = record(p, 'rx', 'Е', 'ok');
  let e = 0;
  let seq = 0;
  const rng = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2000; i++) {
    const ch = pickNext(p, 'rx', ['Е', 'Т'], rng, null);
    if (ch === 'Е') e += 1;
  }
  assert.ok(e < 200, `Е выпало ${e} раз`);
  assert.equal(pickNext(p, 'rx', ['Е', 'Т'], rng, 'Т'), 'Е');
});

test('варианты ответа содержат правильный и не повторяются', () => {
  const pool = GROUPS[0].chars.concat(GROUPS[1].chars);
  for (let i = 0; i < 50; i++) {
    const o = makeOptions('А', pool, 4);
    assert.equal(o.length, 4);
    assert.ok(o.includes('А'));
    assert.equal(new Set(o).size, 4);
  }
});

test('ключ: короткое нажатие точка, длинное тире', () => {
  const u = unitMs(10); // 120 мс
  assert.equal(classify(100, u), '.');
  assert.equal(classify(380, u), '-');
  assert.equal(decodePresses([90, 400, 110], u), '.-.');
});
