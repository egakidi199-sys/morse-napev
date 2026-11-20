// Прогресс по системе Лейтнера: коробки 0..5, знак считается выученным с коробки 3.
import { GROUPS, BY_CHAR } from './data.js';

export const MAX_BOX = 5;
export const MASTERED_BOX = 3;

export function emptyProgress() {
  return { rx: {}, tx: {}, unlockAll: false };
}

export function stat(progress, mode, ch) {
  return progress[mode][ch] || { box: 0, ok: 0, bad: 0 };
}

// result: 'ok' | 'bad' | 'hint' (подсмотрел: без штрафа и без продвижения)
export function record(progress, mode, ch, result) {
  const s = { ...stat(progress, mode, ch) };
  if (result === 'ok') {
    s.ok += 1;
    s.box = Math.min(MAX_BOX, s.box + 1);
  } else if (result === 'bad') {
    s.bad += 1;
    s.box = s.box <= 1 ? 0 : 1;
  }
  return { ...progress, [mode]: { ...progress[mode], [ch]: s } };
}

export function isMastered(progress, mode, ch) {
  return stat(progress, mode, ch).box >= MASTERED_BOX;
}

// Сколько групп открыто: следующая открывается, когда все знаки открытых групп выучены на слух.
export function unlockedGroupCount(progress) {
  if (progress.unlockAll) return GROUPS.length;
  let n = 1;
  while (n < GROUPS.length) {
    const done = GROUPS.slice(0, n).every((g) => g.chars.every((ch) => isMastered(progress, 'rx', ch)));
    if (!done) break;
    n += 1;
  }
  return n;
}

export function unlockedChars(progress) {
  return GROUPS.slice(0, unlockedGroupCount(progress)).flatMap((g) => g.chars);
}

// Взвешенный выбор: чем ниже коробка, тем чаще знак попадается.
export function pickNext(progress, mode, pool, rng = Math.random, avoid = null) {
  const candidates = pool.length > 1 ? pool.filter((ch) => ch !== avoid) : pool;
  const weights = candidates.map((ch) => {
    const b = stat(progress, mode, ch).box;
    return (MAX_BOX + 1 - b) ** 2;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// Варианты ответа: правильный + похожие по звучанию знаки (ловушки), перемешанные.
export function makeOptions(answer, pool, count = 4, rng = Math.random) {
  const code = BY_CHAR[answer].code;
  const others = pool
    .filter((ch) => ch !== answer)
    .map((ch) => ({ ch, d: editDistance(code, BY_CHAR[ch].code) + rng() * 1.5 }))
    .sort((x, y) => x.d - y.d)
    .slice(0, count - 1)
    .map((x) => x.ch);
  const opts = [answer, ...others];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}
