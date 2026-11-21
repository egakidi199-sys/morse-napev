import { CHARS, GROUPS, BY_CHAR, BY_CODE } from './data.js';
import {
  emptyProgress, record, stat, unlockedGroupCount, unlockedChars, pickNext, makeOptions, MASTERED_BOX,
} from './srs.js';
import { Sounder } from './audio.js';
import { canInstall, promptInstall, onInstallChange, iosHintText } from './install.js';
import { unitMs, classify, letterGapMs, charGapMs, adaptKeyer } from './keyer.js';
import {
  GROUP_SIZE, POOLS, poolChars, makeGroups, normalizeInput, alignGroup, ladderStep, charsPerMinute, wpmToCpm, isEraseCode,
} from './groups.js';

const STORE_KEY = 'morse-napev.v1';
const SESSION_LEN = 20;

const DEFAULT_SETTINGS = {
  charWpm: 18, // скорость кода при приёме
  napevWpm: 7, // медленный темп напева
  keyWpm: 8, // скорость ручной передачи
  freq: 650,
  volume: 0.6,
  showLatin: true,
  grpPool: 'learned', // набор знаков для групп
  grpCount: 10, // число групп
  grpSpeed: 'fixed', // 'fixed' – своя скорость, 'race' – на скорость
  grpRxWpm: 12, // скорость приёма групп
  grpGap: 1.5, // растяжение пауз между знаками при приёме
  grpTxWpm: 8, // скорость ключа при передаче групп
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw) {
      return {
        settings: { ...DEFAULT_SETTINGS, ...raw.settings },
        progress: { ...emptyProgress(), ...raw.progress, best: { ...raw.progress?.best } },
      };
    }
  } catch { /* хранилище недоступно */ }
  return { settings: { ...DEFAULT_SETTINGS }, progress: emptyProgress() };
}

const saved = load();
const state = {
  tab: 'learn',
  settings: saved.settings,
  progress: saved.progress,
  learn: { group: 0, idx: 0 },
  rx: null,
  tx: null,
  grp: { mode: 'rx', run: null },
};

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings: state.settings, progress: state.progress }));
  } catch { /* приватный режим и т.п. */ }
}

const sounder = new Sounder();
sounder.freq = state.settings.freq;
sounder.setVolume(state.settings.volume);

const $view = document.getElementById('view');
const timers = new Set();
function after(ms, fn) {
  const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
}
function clearTimers() {
  timers.forEach(clearTimeout);
  timers.clear();
}

// ---------- мелкие помощники DOM ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function mount(...kids) {
  $view.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

function codeEl(code, cls = '') {
  return h('div', { class: `code ${cls}`, 'aria-label': code.replace(/\./g, 'точка ').replace(/-/g, 'тире ') },
    [...code].map((s, i) => h('span', { class: s === '.' ? 'sym dot' : 'sym dash', 'data-i': i })));
}

function napevEl(ch) {
  const c = BY_CHAR[ch];
  return h('div', { class: 'napev' },
    c.napev.map((syl, i) => h('span', { class: c.code[i] === '-' ? 'syl long' : 'syl short', 'data-i': i }, syl)));
}

function highlight(root, i) {
  root.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === i));
}

function playNapev(ch, root) {
  sounder.playCode(BY_CHAR[ch].code, {
    wpm: state.settings.napevWpm,
    onSymbol: (i) => root && highlight(root, i),
    onEnd: () => root && highlight(root, -1),
  });
}

function playCode(ch, root) {
  sounder.playCode(BY_CHAR[ch].code, {
    wpm: state.settings.charWpm,
    onSymbol: (i) => root && highlight(root, i),
    onEnd: () => root && highlight(root, -1),
  });
}

function latinEl(ch) {
  const lat = BY_CHAR[ch].lat;
  // Совпадающие по начертанию (А/A, Е/E…) не показываем.
  if (!state.settings.showLatin || !lat || lat === ch || 'AEKMOT'.includes(lat)) return null;
  return h('div', { class: 'latin' }, `лат. ${lat}`);
}

// ---------- Учить ----------

function renderLearn() {
  const unlocked = unlockedGroupCount(state.progress);
  const L = state.learn;
  const group = GROUPS[L.group];
  const ch = group.chars[L.idx];
  const c = BY_CHAR[ch];

  const card = h('div', { class: 'card learn-card' },
    h('div', { class: 'big-letter' }, ch),
    latinEl(ch),
    codeEl(c.code, 'code-big'),
    napevEl(ch),
  );

  const go = (d) => {
    L.idx = (L.idx + d + group.chars.length) % group.chars.length;
    render();
    const root = $view.querySelector('.learn-card');
    playNapev(group.chars[L.idx], root);
  };

  mount(
    h('div', { class: 'chips', role: 'tablist' },
      GROUPS.map((g, i) => h('button', {
        class: `chip ${i === L.group ? 'active' : ''}`,
        disabled: i >= unlocked,
        title: i >= unlocked ? 'Откроется, когда выучите предыдущие группы на слух' : g.name,
        onclick: () => { L.group = i; L.idx = 0; render(); },
      }, i >= unlocked ? '🔒 ' : '', `${i + 1}`))),
    h('div', { class: 'group-title' }, `${group.name}: ${group.chars.join(' ')}`),
    card,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => go(-1), 'aria-label': 'Предыдущий знак' }, '←'),
      h('button', { class: 'btn primary', onclick: () => playNapev(ch, card) }, '▶ Напев'),
      h('button', { class: 'btn', onclick: () => playCode(ch, card) }, '▶ Код'),
      h('button', { class: 'btn ghost', onclick: () => go(1), 'aria-label': 'Следующий знак' }, '→'),
    ),
    h('div', { class: 'counter' }, `${L.idx + 1} / ${group.chars.length}`),
    h('div', { class: 'mini-table' },
      group.chars.map((x, i) => h('button', {
        class: `mini ${i === L.idx ? 'active' : ''}`,
        onclick: () => { L.idx = i; render(); playNapev(x, $view.querySelector('.learn-card')); },
      }, h('b', {}, x), codeEl(BY_CHAR[x].code, 'code-tiny')))),
    h('p', { class: 'tip' },
      'Пропойте напев вслух. Долгий слог («даа», «коо») – тире, короткий («и», «ти») – точка. ',
      'Когда ритм напева узнаётся сам, переходите к приёму на слух.'),
    h('button', { class: 'btn wide primary', onclick: () => switchTab('rx') }, 'Тренировать приём →'),
  );
}

// ---------- Приём на слух ----------

function newRxSession() {
  return { n: 0, correct: 0, errors: [], q: null, done: false, unlockedBefore: unlockedGroupCount(state.progress) };
}

function nextRxQuestion() {
  const S = state.rx;
  const pool = unlockedChars(state.progress);
  const answer = pickNext(state.progress, 'rx', pool, Math.random, S.q?.answer);
  S.q = { answer, options: makeOptions(answer, pool, Math.min(4, pool.length)), picked: null, hint: false };
  render();
  after(250, () => playCode(answer));
}

function answerRx(ch) {
  const S = state.rx;
  const q = S.q;
  if (!q || q.picked) return;
  q.picked = ch;
  const ok = ch === q.answer;
  S.n += 1;
  if (ok && !q.hint) S.correct += 1;
  if (!ok) S.errors.push({ answer: q.answer, picked: ch });
  state.progress = record(state.progress, 'rx', q.answer, ok ? (q.hint ? 'hint' : 'ok') : 'bad');
  save();
  sounder.blip(ok);
  render();
  if (ok) after(1100, advanceRx);
  else after(500, () => playNapev(q.answer, $view.querySelector('.reveal')));
}

function advanceRx() {
  const S = state.rx;
  if (!S || !S.q?.picked) return;
  clearTimers();
  if (S.n >= SESSION_LEN) {
    S.done = true;
    S.q = null;
    render();
  } else {
    nextRxQuestion();
  }
}

function renderRx() {
  if (!state.rx) {
    state.rx = newRxSession();
    nextRxQuestion();
    return;
  }
  const S = state.rx;

  if (S.done) {
    const unlockedNow = unlockedGroupCount(state.progress);
    const newGroup = unlockedNow > S.unlockedBefore ? GROUPS[unlockedNow - 1] : null;
    mount(
      h('div', { class: 'card summary' },
        h('div', { class: 'score' }, `${S.correct} / ${SESSION_LEN}`),
        h('div', {}, 'верных ответов без подсказок'),
        newGroup && h('div', { class: 'unlock' }, `Открыта новая группа: ${newGroup.name} (${newGroup.chars.join(' ')})`),
        S.errors.length > 0 && h('div', { class: 'errors' },
          h('div', { class: 'label' }, 'Ошибки:'),
          S.errors.map((e) => h('div', { class: 'err-row' },
            h('b', {}, e.answer), codeEl(BY_CHAR[e.answer].code, 'code-tiny'),
            h('span', { class: 'muted' }, `вы ответили ${e.picked}`)))),
      ),
      newGroup && h('button', { class: 'btn wide', onclick: () => {
        state.learn = { group: unlockedNow - 1, idx: 0 };
        switchTab('learn');
      } }, 'Изучить новую группу'),
      h('button', { class: 'btn wide primary', onclick: () => { state.rx = newRxSession(); nextRxQuestion(); } }, 'Ещё сессия'),
    );
    return;
  }

  const q = S.q;
  const picked = q.picked;
  const ok = picked === q.answer;

  mount(
    h('div', { class: 'session-bar' },
      h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${(S.n / SESSION_LEN) * 100}%` })),
      h('span', {}, `${S.n} / ${SESSION_LEN}`)),
    h('div', { class: 'card listen' },
      picked
        ? h('div', { class: `reveal ${ok ? 'ok' : 'bad'}` },
          h('div', { class: 'big-letter' }, q.answer),
          latinEl(q.answer),
          codeEl(BY_CHAR[q.answer].code, 'code-big'),
          napevEl(q.answer))
        : h('div', { class: 'ask' },
          h('div', { class: 'ear' }, '?'),
          q.hint ? codeEl(BY_CHAR[q.answer].code, 'code-big') : h('div', { class: 'muted' }, 'Какой знак прозвучал?')),
    ),
    h('div', { class: 'options' },
      q.options.map((ch) => h('button', {
        class: `opt ${picked && ch === q.answer ? 'right' : ''} ${picked === ch && !ok ? 'wrong' : ''}`,
        disabled: !!picked,
        onclick: () => answerRx(ch),
      }, ch))),
    picked
      ? h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => playNapev(q.answer, $view.querySelector('.reveal')) }, '▶ Напев'),
        h('button', { class: 'btn primary', onclick: advanceRx }, 'Дальше →'))
      : h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => playCode(q.answer) }, '⟲ Повторить'),
        h('button', { class: 'btn ghost', disabled: q.hint, onclick: () => { q.hint = true; render(); } }, '👁 Показать код')),
  );
}

// ---------- Передача ключом ----------

function newTxTarget(avoid) {
  const pool = unlockedChars(state.progress);
  const target = pickNext(state.progress, 'tx', pool, Math.random, avoid);
  state.tx = { target, presses: [], result: null, downAt: null, showHint: stat(state.progress, 'tx', target).box < 2, total: state.tx?.total || 0, good: state.tx?.good || 0 };
}

let gapTimer = null;

function keyDown() {
  const T = state.tx;
  if (!T || T.downAt != null) return;
  if (T.result) {
    if (T.result === 'ok') return;
    T.result = null; // новая попытка после ошибки
    T.presses = [];
  }
  clearTimeout(gapTimer);
  T.downAt = performance.now();
  sounder.keyDown();
  document.querySelector('.key')?.classList.add('down');
}

function keyUp() {
  const T = state.tx;
  if (!T || T.downAt == null) return;
  const dur = performance.now() - T.downAt;
  T.downAt = null;
  sounder.keyUp();
  document.querySelector('.key')?.classList.remove('down');
  const unit = unitMs(state.settings.keyWpm);
  T.presses.push(classify(dur, unit));
  updateTxLive();
  clearTimeout(gapTimer);
  gapTimer = setTimeout(finishTxLetter, letterGapMs(unit));
}

function finishTxLetter() {
  const T = state.tx;
  if (!T || !T.presses.length || T.result) return;
  const sent = T.presses.join('');
  const ok = sent === BY_CHAR[T.target].code;
  T.result = ok ? 'ok' : 'bad';
  T.sent = sent;
  T.total += 1;
  if (ok) T.good += 1;
  state.progress = record(state.progress, 'tx', T.target, ok ? (T.showHint ? 'hint' : 'ok') : 'bad');
  save();
  sounder.blip(ok);
  render();
  if (ok) after(1000, () => { newTxTarget(T.target); render(); });
}

function updateTxLive() {
  const live = document.querySelector('.tx-live');
  if (live) live.replaceChildren(codeEl(state.tx.presses.join(''), 'code-big'));
}

function renderTx() {
  if (!state.tx || !state.tx.target) newTxTarget();
  const T = state.tx;
  const c = BY_CHAR[T.target];
  const sentChar = T.sent ? BY_CODE[T.sent]?.ch : null;

  let status;
  if (T.result === 'ok') status = h('div', { class: 'status ok' }, '✓ Верно');
  else if (T.result === 'bad') {
    status = h('div', { class: 'status bad' },
      `✗ Получилось ${sentChar ? `«${sentChar}»` : 'не знак'}. Нажмите ключ, чтобы повторить.`);
  } else status = h('div', { class: 'status muted' }, 'Нажимайте ключ: короткое касание – точка, удержание – тире');

  const key = h('button', { class: 'key', 'aria-label': 'Телеграфный ключ' }, 'КЛЮЧ');
  key.addEventListener('pointerdown', (e) => { e.preventDefault(); key.setPointerCapture?.(e.pointerId); keyDown(); });
  key.addEventListener('pointerup', (e) => { e.preventDefault(); keyUp(); });
  key.addEventListener('pointercancel', keyUp);
  key.addEventListener('contextmenu', (e) => e.preventDefault());

  const card = h('div', { class: 'card tx-card' },
    h('div', { class: 'tx-head' },
      h('div', { class: 'big-letter' }, T.target),
      latinEl(T.target)),
    T.showHint
      ? h('div', { class: 'tx-hint' }, codeEl(c.code, 'code-mid'), napevEl(T.target))
      : h('button', { class: 'btn ghost small', onclick: () => { T.showHint = true; render(); } }, '👁 Подсказка'),
    h('div', { class: 'tx-live-wrap' }, h('div', { class: 'label' }, 'Вы передаёте'),
      h('div', { class: 'tx-live' }, codeEl(T.presses.join(''), 'code-big'))),
    status,
  );

  mount(
    h('div', { class: 'session-bar' }, h('span', {}, `Верно: ${T.good} из ${T.total}`),
      h('span', { class: 'muted' }, `${state.settings.keyWpm} сл/мин`)),
    card,
    key,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => playNapev(T.target, card.querySelector('.tx-hint')) }, '▶ Как звучит'),
      h('button', { class: 'btn ghost', onclick: () => { clearTimeout(gapTimer); clearTimers(); newTxTarget(T.target); render(); } }, 'Другой знак →')),
    h('p', { class: 'tip' }, 'На компьютере ключом служит пробел.'),
  );
}

// ---------- Группы по 5 знаков ----------

let grpGapTimer = null;

function speedLabel(wpm) {
  return `${wpm} сл/мин · ≈${wpmToCpm(wpm)} зн/мин`;
}

function setBest(key, value) {
  state.progress = { ...state.progress, best: { ...state.progress.best, [key]: value } };
  save();
}

function startGroups() {
  const G = state.grp;
  const s = state.settings;
  clearTimers();
  clearTimeout(grpGapTimer);
  const groups = makeGroups(poolChars(s.grpPool, unlockedChars(state.progress)), s.grpCount);
  const race = s.grpSpeed === 'race';
  if (G.mode === 'rx') {
    G.run = {
      kind: 'rx', race, groups, i: 0, wpm: s.grpRxWpm, startWpm: s.grpRxWpm, bestWpm: 0,
      results: [], phase: 'listen', replayed: false, delta: 0, root: null, input: null,
    };
    render();
    playRxGroup();
  } else {
    G.run = {
      kind: 'tx', race, groups, text: groups.join(''), sent: [], presses: [], unit: unitMs(s.grpTxWpm),
      downAt: null, startAt: null, lastUpAt: null, endAt: null, done: false, root: null,
    };
    render();
  }
}

function stopGroups() {
  clearTimers();
  clearTimeout(grpGapTimer);
  sounder.stop();
  sounder.keyUp();
  state.grp.run = null;
  render();
}

// Ячейки сверки: сверху переданный знак, снизу принятый.
function pairsEl(cells) {
  return h('div', { class: 'pairs' }, cells.map((c) => {
    const st = c.cls || (c.t === c.g ? 'ok' : c.t == null ? 'extra' : c.g == null ? 'miss' : 'bad');
    return h('span', { class: `pair ${st}` }, h('b', {}, c.t ?? ' '), h('i', {}, c.g ?? '_'));
  }));
}

function blankEl(groupsCells) {
  return h('div', { class: 'blank' }, groupsCells.map((cells) => h('div', { class: 'grp' }, pairsEl(cells))));
}

// --- приём групп ---

function playRxGroup(replay = false) {
  const R = state.grp.run;
  if (!R || R.kind !== 'rx' || R.done) return;
  if (replay) {
    if (R.phase === 'listen') R.replayed = true;
  } else {
    R.phase = 'listen';
    R.replayed = false;
    if (R.input) R.input.value = '';
    updateRx();
  }
  sounder.playSequence([...R.groups[R.i]].map((ch) => BY_CHAR[ch].code), { wpm: R.wpm, gapScale: state.settings.grpGap });
  R.input?.focus();
}

function checkRx(raw) {
  const R = state.grp.run;
  if (!R || R.kind !== 'rx' || R.phase !== 'listen') return;
  const got = normalizeInput(raw).slice(0, GROUP_SIZE);
  const target = R.groups[R.i];
  const { cells, errors } = alignGroup(target, got);
  R.results.push({ target, got, cells, errors, wpm: R.wpm });
  if (errors === 0 && !R.replayed) R.bestWpm = Math.max(R.bestWpm, R.wpm);
  const before = R.wpm;
  if (R.race && !(R.replayed && errors === 0)) R.wpm = ladderStep(R.wpm, errors);
  R.delta = R.wpm - before;
  R.phase = 'shown';
  sounder.stop();
  sounder.blip(errors === 0);
  if (R.input) R.input.value = '';
  updateRx();
  if (errors === 0) after(900, nextRx);
}

function nextRx() {
  const R = state.grp.run;
  if (!R || R.kind !== 'rx' || R.phase !== 'shown') return;
  clearTimers();
  R.i += 1;
  if (R.i >= R.groups.length) finishRx();
  else playRxGroup();
}

function finishRx() {
  const R = state.grp.run;
  if (!R || R.done) return;
  clearTimers();
  sounder.stop();
  R.done = true;
  R.prevBest = state.progress.best.grpRx || 0;
  if (R.bestWpm > R.prevBest) setBest('grpRx', R.bestWpm);
  render();
}

function rxView(R) {
  if (R.root && $view.contains(R.root)) { updateRx(); return; }
  const input = h('input', {
    class: 'grp-input', type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'characters',
    spellcheck: 'false', enterkeyhint: 'next', lang: 'ru', maxlength: 12, 'aria-label': 'Принятая группа',
  });
  input.addEventListener('input', (e) => {
    if (e.isComposing) return;
    if (R.phase !== 'listen') { input.value = ''; return; }
    const v = normalizeInput(input.value);
    input.value = v;
    if (v.length >= GROUP_SIZE) checkRx(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (R.phase === 'listen') checkRx(input.value);
    else nextRx();
  });
  R.input = input;
  R.root = h('div', { class: 'grp-run' },
    h('div', { class: 'session-bar' },
      h('div', { class: 'bar' }, h('div', { class: 'fill' })),
      h('span', { class: 'grp-count' })),
    h('div', { class: 'grp-speed muted' }),
    h('div', { class: 'card grp-card' }, h('div', { class: 'grp-status' }), input),
    h('div', { class: 'row grp-actions' }),
    h('div', { class: 'grp-done' }),
    h('button', { class: 'btn ghost wide', onclick: () => (R.results.length ? finishRx() : stopGroups()) }, 'Закончить'),
  );
  mount(R.root);
  updateRx();
  input.focus();
}

function updateRx() {
  const R = state.grp.run;
  if (!R?.root) return;
  const q = (sel) => R.root.querySelector(sel);
  const n = R.groups.length;
  q('.fill').style.width = `${(R.results.length / n) * 100}%`;
  q('.grp-count').textContent = `Группа ${Math.min(R.i + 1, n)} / ${n}`;
  q('.grp-speed').textContent = `${R.race ? 'На скорость: ' : ''}${speedLabel(R.wpm)}`;

  const last = R.results[R.i];
  if (R.phase === 'listen') {
    q('.grp-status').replaceChildren(h('div', { class: 'muted' }, 'Слушайте и печатайте знаки группы'));
    R.input.placeholder = '• • • • •';
    q('.grp-actions').replaceChildren(
      h('button', { class: 'btn', onclick: () => playRxGroup(true) }, '⟲ Повторить'),
      h('button', { class: 'btn primary', onclick: () => checkRx(R.input.value) }, 'Готово'));
  } else {
    const msg = last.errors === 0 ? '✓ Без ошибок' : `Ошибок: ${last.errors}`;
    const delta = R.delta > 0 ? ` · скорость ↑ ${R.wpm}` : R.delta < 0 ? ` · скорость ↓ ${R.wpm}` : '';
    q('.grp-status').replaceChildren(
      h('div', { class: 'grp-result' }, pairsEl(last.cells)),
      h('div', { class: `status ${last.errors === 0 ? 'ok' : 'bad'}` }, msg + delta));
    R.input.placeholder = 'Enter – дальше';
    q('.grp-actions').replaceChildren(
      h('button', { class: 'btn', onclick: () => playRxGroup(true) }, '▶ Прослушать'),
      h('button', { class: 'btn primary', onclick: nextRx }, 'Дальше →'));
  }
  const done = R.results.slice(0, R.phase === 'shown' ? R.i : R.results.length);
  q('.grp-done').replaceChildren(done.length ? blankEl(done.map((r) => r.cells)) : '');
}

function rxSummary(R) {
  const total = R.results.length * GROUP_SIZE;
  const errs = R.results.reduce((a, r) => a + Math.min(r.errors, GROUP_SIZE), 0);
  const acc = total ? Math.round(((total - errs) / total) * 100) : 0;
  const missed = {};
  R.results.forEach((r) => r.cells.forEach((c) => { if (c.t && c.t !== c.g) missed[c.t] = (missed[c.t] || 0) + 1; }));
  const top = Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 6);
  mount(
    h('div', { class: 'card summary' },
      h('div', { class: 'score' }, `${acc} %`),
      h('div', {}, `точность приёма, ${R.results.length} гр. (${total} зн.)`),
      R.race
        ? h('div', { class: 'muted' }, `Скорость: ${R.startWpm} → ${R.wpm} сл/мин`)
        : h('div', { class: 'muted' }, speedLabel(R.startWpm)),
      R.bestWpm > 0 && h('div', {}, `Лучшая группа без ошибок: ${speedLabel(R.bestWpm)}`),
      R.bestWpm > R.prevBest && h('div', { class: 'unlock' }, `Новый рекорд: ${R.bestWpm} сл/мин`),
      top.length > 0 && h('div', { class: 'muted' }, `Чаще ошибки: ${top.map(([ch, k]) => `${ch} ×${k}`).join(', ')}`),
      blankEl(R.results.map((r) => r.cells))),
    h('button', { class: 'btn wide primary', onclick: startGroups }, 'Ещё раз'),
    h('button', { class: 'btn wide', onclick: stopGroups }, 'Настройки'),
  );
}

// --- передача групп ---

function grpKeyDown() {
  const R = state.grp.run;
  if (!R || R.kind !== 'tx' || R.done || R.downAt != null) return;
  clearTimeout(grpGapTimer);
  R.downAt = performance.now();
  if (R.startAt == null) R.startAt = R.downAt;
  sounder.keyDown();
  R.root?.querySelector('.key')?.classList.add('down');
}

function grpKeyUp() {
  const R = state.grp.run;
  if (!R || R.kind !== 'tx' || R.downAt == null) return;
  const now = performance.now();
  const dur = now - R.downAt;
  R.downAt = null;
  R.lastUpAt = now;
  sounder.keyUp();
  R.root?.querySelector('.key')?.classList.remove('down');
  if (R.done) return;
  if (R.race) {
    const a = adaptKeyer(R.unit, dur);
    R.presses.push(a.sym);
    R.unit = a.unit;
  } else {
    R.presses.push(classify(dur, R.unit));
  }
  updateTx();
  clearTimeout(grpGapTimer);
  grpGapTimer = setTimeout(grpFinishChar, charGapMs(R.unit));
}

function flushPresses(R) {
  if (!R.presses.length) return;
  const code = R.presses.join('');
  R.presses = [];
  if (isEraseCode(code)) {
    R.sent.pop();
  } else {
    R.sent.push(BY_CODE[code]?.ch || '?');
    R.endAt = R.lastUpAt;
  }
}

function grpFinishChar() {
  const R = state.grp.run;
  if (!R || R.kind !== 'tx' || R.done || R.downAt != null) return;
  flushPresses(R);
  updateTx();
  if (R.sent.length >= R.text.length) finishTx();
}

function eraseTx() {
  const R = state.grp.run;
  if (!R || R.done) return;
  clearTimeout(grpGapTimer);
  if (R.presses.length) R.presses = [];
  else R.sent.pop();
  updateTx();
}

function finishTx() {
  const R = state.grp.run;
  if (!R || R.kind !== 'tx' || R.done) return;
  clearTimeout(grpGapTimer);
  flushPresses(R);
  sounder.keyUp();
  R.downAt = null;
  R.done = true;
  const total = R.text.length;
  R.errors = [...R.text].filter((ch, i) => R.sent[i] !== ch).length;
  R.accuracy = Math.round(((total - R.errors) / total) * 100);
  R.cpm = R.startAt != null && R.endAt ? charsPerMinute(R.sent.length, R.endAt - R.startAt) : 0;
  R.prevBest = state.progress.best.grpTx || 0;
  // Рекорд засчитывается только при точности от 90 %.
  if (R.accuracy >= 90 && R.cpm > R.prevBest) setBest('grpTx', R.cpm);
  sounder.blip(R.errors === 0);
  render();
}

function txCells(R) {
  return R.groups.map((g, gi) => [...g].map((t, k) => {
    const i = gi * GROUP_SIZE + k;
    const got = R.sent[i];
    if (got == null) return { t, g: null, cls: !R.done && i === R.sent.length ? 'cur' : R.done ? 'miss' : 'todo' };
    return { t, g: got };
  }));
}

function txView(R) {
  if (R.root && $view.contains(R.root)) { updateTx(); return; }
  const key = h('button', { class: 'key', 'aria-label': 'Телеграфный ключ' }, 'КЛЮЧ');
  key.addEventListener('pointerdown', (e) => { e.preventDefault(); key.setPointerCapture?.(e.pointerId); grpKeyDown(); });
  key.addEventListener('pointerup', (e) => { e.preventDefault(); grpKeyUp(); });
  key.addEventListener('pointercancel', grpKeyUp);
  key.addEventListener('contextmenu', (e) => e.preventDefault());
  R.root = h('div', { class: 'grp-run' },
    h('div', { class: 'session-bar' }, h('span', { class: 'grp-count' }), h('span', { class: 'grp-speed muted' })),
    h('div', { class: 'grp-blank' }),
    h('div', { class: 'tx-live-wrap' }, h('div', { class: 'label' }, 'Текущий знак'), h('div', { class: 'tx-live' })),
    key,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: eraseTx }, '⌫ Стереть'),
      h('button', { class: 'btn primary', onclick: finishTx }, 'Готово')),
    h('p', { class: 'tip' }, 'Передавайте группы подряд, между знаками пауза. Шесть точек подряд стирают знак. На компьютере ключом служит пробел.'),
  );
  mount(R.root);
  updateTx();
}

function updateTx() {
  const R = state.grp.run;
  if (!R?.root) return;
  const q = (sel) => R.root.querySelector(sel);
  q('.grp-count').textContent = `Передано ${R.sent.length} / ${R.text.length}`;
  const keyWpm = Math.round(1200 / R.unit);
  const live = R.startAt != null && R.endAt ? charsPerMinute(R.sent.length, R.endAt - R.startAt) : 0;
  q('.grp-speed').textContent = R.race
    ? `темп ${live || '–'} зн/мин · ключ ≈${keyWpm} сл/мин`
    : `ключ ${keyWpm} сл/мин`;
  q('.grp-blank').replaceChildren(blankEl(txCells(R)));
  q('.tx-live').replaceChildren(codeEl(R.presses.join(''), 'code-mid'));
}

function txSummary(R) {
  mount(
    h('div', { class: 'card summary' },
      h('div', { class: 'score' }, `${R.accuracy} %`),
      h('div', {}, `точность передачи, ${R.text.length - R.errors} из ${R.text.length} знаков`),
      R.cpm > 0 && h('div', {}, `Скорость: ${R.cpm} зн/мин (≈${Math.round(R.cpm / 5)} сл/мин)`),
      R.accuracy >= 90 && R.cpm > R.prevBest && h('div', { class: 'unlock' }, `Новый рекорд: ${R.cpm} зн/мин`),
      R.accuracy < 90 && R.cpm > 0 && h('div', { class: 'muted' }, 'Рекорд засчитывается при точности от 90 %'),
      blankEl(txCells(R))),
    h('button', { class: 'btn wide primary', onclick: startGroups }, 'Ещё раз'),
    h('button', { class: 'btn wide', onclick: stopGroups }, 'Настройки'),
  );
}

// --- выбор режима ---

function groupsSetup() {
  const G = state.grp;
  const s = state.settings;
  const isRx = G.mode === 'rx';
  const race = s.grpSpeed === 'race';
  const set = (k, v) => { s[k] = v; save(); render(); };
  const chipRow = (opts, key) => h('div', { class: 'chips wrap' },
    opts.map(([v, label]) => h('button', { class: `chip ${s[key] === v ? 'active' : ''}`, onclick: () => set(key, v) }, label)));
  const best = isRx ? state.progress.best.grpRx : state.progress.best.grpTx;
  let hint;
  if (isRx) {
    hint = race
      ? 'После группы без ошибок скорость растёт на 1 сл/мин, после двух и более ошибок снижается.'
      : 'Все группы звучат на выбранной скорости.';
  } else {
    hint = race
      ? 'Ключ подстраивается под ваш темп, засекается скорость передачи.'
      : 'Ключ настроен на выбранную скорость: держите ровный темп.';
  }

  mount(
    h('div', { class: 'chips' },
      [['rx', '◉ Приём'], ['tx', '▬ Передача']].map(([m, l]) => h('button', {
        class: `chip seg ${G.mode === m ? 'active' : ''}`, onclick: () => { G.mode = m; render(); },
      }, l))),
    h('p', { class: 'tip' }, isRx
      ? 'Звучат группы по 5 случайных знаков, как в радиограмме. Печатайте принятое: группа проверяется после пятого знака.'
      : 'На экране радиограмма из групп по 5 знаков. Передайте её ключом подряд, приложение расшифрует и сверит.'),
    h('div', { class: 'card settings' },
      h('div', { class: 'label' }, 'Знаки'),
      chipRow(Object.entries(POOLS).map(([k, l]) => [k, k === 'learned' ? `${l} (${unlockedChars(state.progress).length})` : l]), 'grpPool'),
      h('div', { class: 'label' }, 'Число групп'),
      chipRow([5, 10, 15, 20].map((n) => [n, String(n)]), 'grpCount'),
      h('div', { class: 'label' }, 'Скорость'),
      chipRow([['fixed', 'Своя'], ['race', 'На скорость']], 'grpSpeed'),
      h('div', { class: 'tip' }, hint),
      isRx
        ? slider(race ? 'Начальная скорость' : 'Скорость', 'grpRxWpm', 5, 40, 1, speedLabel)
        : slider(race ? 'Начальный темп ключа' : 'Скорость ключа', 'grpTxWpm', 4, 25, 1, speedLabel),
      isRx && slider('Паузы между знаками', 'grpGap', 1, 3, 0.5, (v) => (v === 1 ? 'как в коде' : `длиннее ×${v}`)),
    ),
    best ? h('div', { class: 'muted' }, `Рекорд: ${isRx ? `${best} сл/мин без ошибок` : `${best} зн/мин`}`) : null,
    h('button', { class: 'btn wide primary', onclick: () => { sounder.ensure(); startGroups(); } }, 'Начать'),
  );
}

function renderGroups() {
  const R = state.grp.run;
  if (!R) groupsSetup();
  else if (R.done) (R.kind === 'rx' ? rxSummary : txSummary)(R);
  else if (R.kind === 'rx') rxView(R);
  else txView(R);
}

// ---------- Прогресс и настройки ----------

function slider(label, key, min, max, step, fmt, onChange) {
  const out = h('output', {}, fmt(state.settings[key]));
  const input = h('input', {
    type: 'range', min, max, step, value: state.settings[key],
    oninput: (e) => {
      state.settings[key] = Number(e.target.value);
      out.textContent = fmt(state.settings[key]);
      onChange?.();
      save();
    },
  });
  return h('label', { class: 'setting' }, h('span', {}, label), input, out);
}

function renderProgress() {
  const unlocked = unlockedGroupCount(state.progress);
  const all = CHARS.map((c) => stat(state.progress, 'rx', c.ch));
  const mastered = all.filter((s) => s.box >= MASTERED_BOX).length;
  const ok = all.reduce((a, s) => a + s.ok, 0);
  const bad = all.reduce((a, s) => a + s.bad, 0);

  mount(
    h('div', { class: 'card stats' },
      h('div', {}, h('b', {}, mastered), ` из ${CHARS.length} знаков выучено на слух`),
      h('div', { class: 'muted' }, ok + bad > 0 ? `Точность приёма ${Math.round((ok / (ok + bad)) * 100)} % (${ok + bad} ответов)` : 'Ответов пока нет')),
    GROUPS.map((g, gi) => h('div', { class: `pgroup ${gi >= unlocked ? 'locked' : ''}` },
      h('div', { class: 'pgroup-title' }, gi >= unlocked ? '🔒 ' : '', `${gi + 1}. ${g.name}`),
      h('div', { class: 'tiles' }, g.chars.map((ch) => {
        const rx = stat(state.progress, 'rx', ch).box;
        const tx = stat(state.progress, 'tx', ch).box;
        return h('div', { class: `tile lvl${rx}`, title: `Приём: ${rx}/5, передача: ${tx}/5` },
          h('b', {}, ch),
          h('div', { class: 'pips' }, [0, 1, 2, 3, 4].map((i) => h('i', { class: i < tx ? 'on' : '' }))));
      })))),
    h('p', { class: 'tip' }, 'Цвет плитки – уровень приёма на слух, точки внизу – уровень передачи. Следующая группа открывается, когда все знаки открытых групп выучены на слух.'),

    h('h2', {}, 'Настройки'),
    h('div', { class: 'card settings' },
      slider('Скорость приёма', 'charWpm', 8, 30, 1, (v) => `${v} сл/мин`),
      slider('Темп напева', 'napevWpm', 4, 12, 1, (v) => `${v} сл/мин`),
      slider('Скорость ключа', 'keyWpm', 4, 20, 1, (v) => `${v} сл/мин`),
      slider('Тон', 'freq', 400, 1000, 10, (v) => `${v} Гц`, () => { sounder.freq = state.settings.freq; }),
      slider('Громкость', 'volume', 0.1, 1, 0.05, (v) => `${Math.round(v * 100)} %`, () => sounder.setVolume(state.settings.volume)),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: state.settings.showLatin, onchange: (e) => { state.settings.showLatin = e.target.checked; save(); } }),
        'Показывать латинскую букву'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: state.progress.unlockAll, onchange: (e) => { state.progress = { ...state.progress, unlockAll: e.target.checked }; save(); render(); } }),
        'Открыть все группы сразу'),
      h('button', { class: 'btn', onclick: () => { sounder.ensure(); playCode('А'); } }, '▶ Проверить звук'),
    ),
    canInstall() && h('button', { class: 'btn wide', onclick: async () => {
      if (await promptInstall() === 'ios') alert(iosHintText());
    } }, '⤓ Установить приложение'),
    h('button', { class: 'btn wide danger', onclick: () => {
      if (confirm('Сбросить весь прогресс? Настройки останутся.')) {
        state.progress = emptyProgress();
        state.rx = null;
        state.tx = null;
        save();
        render();
      }
    } }, 'Сбросить прогресс'),
    h('details', { class: 'about' },
      h('summary', {}, 'О методе напевов'),
      h('p', {}, 'Напевы придумали для быстрого обучения радистов: каждому знаку соответствует фраза, где число слогов равно числу посылок. Слоги с протяжной гласной звучат как тире, короткие как точки. «Ай-даа» – это А (· –), «Маа-маа» – М (– –).'),
      h('p', {}, 'Главное правило: запоминать ритм на слух, а не картинку из точек. Поэтому в приёме код сначала звучит, а точки и тире показываются только по запросу.')),
  );
}

// ---------- каркас ----------

function render() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
  if (state.tab === 'learn') renderLearn();
  else if (state.tab === 'rx') renderRx();
  else if (state.tab === 'tx') renderTx();
  else if (state.tab === 'groups') renderGroups();
  else renderProgress();
}

function switchTab(tab) {
  clearTimers();
  clearTimeout(gapTimer);
  clearTimeout(grpGapTimer);
  sounder.stop();
  sounder.keyUp();
  if (state.tx) state.tx.downAt = null;
  if (state.grp.run) state.grp.run.downAt = null;
  state.tab = tab;
  render();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  sounder.ensure();
  switchTab(t.dataset.tab);
}));

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input')) return;
  if (state.tab === 'tx' && e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) keyDown();
    return;
  }
  const G = state.grp.run;
  if (state.tab === 'groups' && G && !G.done) {
    if (G.kind === 'tx' && e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) grpKeyDown();
      return;
    }
    if (G.kind === 'rx' && G.phase === 'shown' && e.key === 'Enter') { nextRx(); return; }
  }
  if (state.tab === 'rx' && state.rx?.q) {
    const q = state.rx.q;
    const k = e.key.toUpperCase();
    if (!q.picked && q.options.includes(k)) { answerRx(k); return; }
    if (q.picked && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); advanceRx(); return; }
    if (!q.picked && e.code === 'Space') { e.preventDefault(); playCode(q.answer); }
  }
});
document.addEventListener('keyup', (e) => {
  if (state.tab === 'tx' && e.code === 'Space') { e.preventDefault(); keyUp(); }
  if (state.tab === 'groups' && e.code === 'Space' && state.grp.run?.kind === 'tx') { e.preventDefault(); grpKeyUp(); }
});
window.addEventListener('blur', () => {
  if (state.tx?.downAt != null) keyUp();
  if (state.grp.run?.downAt != null) grpKeyUp();
});

render();
onInstallChange(() => { if (state.tab === 'progress') render(); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
