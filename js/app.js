import { CHARS, GROUPS, BY_CHAR, BY_CODE } from './data.js';
import {
  emptyProgress, record, stat, unlockedGroupCount, unlockedChars, pickNext, makeOptions, MASTERED_BOX,
} from './srs.js';
import { Sounder } from './audio.js';
import { unitMs, classify, letterGapMs } from './keyer.js';

const STORE_KEY = 'morse-napev.v1';
const SESSION_LEN = 20;

const DEFAULT_SETTINGS = {
  charWpm: 18, // скорость кода при приёме
  napevWpm: 7, // медленный темп напева
  keyWpm: 8, // скорость ручной передачи
  freq: 650,
  volume: 0.6,
  showLatin: true,
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (raw) {
      return {
        settings: { ...DEFAULT_SETTINGS, ...raw.settings },
        progress: { ...emptyProgress(), ...raw.progress },
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
  else renderProgress();
}

function switchTab(tab) {
  clearTimers();
  clearTimeout(gapTimer);
  sounder.stop();
  sounder.keyUp();
  if (state.tx) state.tx.downAt = null;
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
});
window.addEventListener('blur', () => { if (state.tx?.downAt != null) keyUp(); });

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
