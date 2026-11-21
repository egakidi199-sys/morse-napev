// Тренировка группами по 5 знаков (как радиограммы): генерация, сверка, скорость.
import { CHARS, BY_CHAR } from './data.js';

export const GROUP_SIZE = 5;

export const POOLS = {
  learned: 'Открытые',
  letters: 'Буквы',
  digits: 'Цифры',
  all: 'Все',
};

const isDigit = (ch) => /\d/.test(ch);

export function poolChars(kind, unlocked) {
  if (kind === 'letters') return CHARS.filter((c) => !isDigit(c.ch)).map((c) => c.ch);
  if (kind === 'digits') return CHARS.filter((c) => isDigit(c.ch)).map((c) => c.ch);
  if (kind === 'all') return CHARS.map((c) => c.ch);
  return unlocked;
}

// Случайные группы; один и тот же знак не идёт дважды подряд.
export function makeGroups(pool, count, rng = Math.random, size = GROUP_SIZE) {
  const out = [];
  let prev = null;
  for (let g = 0; g < count; g++) {
    let s = '';
    for (let i = 0; i < size; i++) {
      const cand = pool.length > 1 ? pool.filter((ch) => ch !== prev) : pool;
      prev = cand[Math.floor(rng() * cand.length)];
      s += prev;
    }
    out.push(s);
  }
  return out;
}

// Латиница принимается по морзе-соответствию (W → В, Q → Щ…), Ё считается за Е.
const LATIN = Object.fromEntries(CHARS.filter((c) => c.lat && !isDigit(c.lat)).map((c) => [c.lat, c.ch]));

export function normalizeInput(s) {
  return [...s.toUpperCase().replace(/Ё/g, 'Е')]
    .map((x) => (BY_CHAR[x] ? x : LATIN[x]))
    .filter(Boolean)
    .join('');
}

// Посимвольная сверка с выравниванием (пропуски и лишние знаки не сдвигают всю группу).
// Возвращает ячейки { t, g }: t – переданный знак или null (лишний), g – принятый или null (пропуск).
export function alignGroup(target, got) {
  const a = [...target];
  const b = [...got];
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const cells = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      cells.push({ t: a[i - 1], g: b[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      cells.push({ t: a[i - 1], g: null });
      i--;
    } else {
      cells.push({ t: null, g: b[j - 1] });
      j--;
    }
  }
  cells.reverse();
  return { cells, errors: dp[a.length][b.length] };
}

// Режим «на скорость» в приёме: группа без ошибок – быстрее, две и больше ошибок – медленнее.
export function ladderStep(wpm, errors, { min = 5, max = 40 } = {}) {
  if (errors === 0) return Math.min(max, wpm + 1);
  if (errors >= 2) return Math.max(min, wpm - 1);
  return wpm;
}

// Знаков в минуту по числу знаков и времени.
export function charsPerMinute(chars, ms) {
  return ms > 0 ? Math.round((chars * 60000) / ms) : 0;
}

// Ориентировочный перевод слов в минуту (PARIS) в знаки в минуту.
export function wpmToCpm(wpm) {
  return Math.round(wpm * 5);
}

// Знак «ошибка» при передаче: шесть и больше точек подряд стирают последний знак.
export function isEraseCode(code) {
  return /^\.{6,}$/.test(code);
}
