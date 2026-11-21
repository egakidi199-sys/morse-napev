// Распознавание ручной передачи: нажатие короче порога – точка, длиннее – тире.

export function unitMs(wpm) {
  return 1200 / wpm; // стандарт PARIS
}

export function classify(pressMs, unit) {
  return pressMs < unit * 2 ? '.' : '-';
}

// Пауза, после которой буква считается законченной.
export function letterGapMs(unit) {
  return unit * 6;
}

// Пауза между знаками при сплошной передаче (норма 3 точки, внутри знака 1).
export function charGapMs(unit) {
  return unit * 2.5;
}

// Адаптивный ключ: длина точки подстраивается под темп передающего.
export function adaptKeyer(unit, pressMs, { min = unitMs(40), max = unitMs(4), rate = 0.25 } = {}) {
  const sym = classify(pressMs, unit);
  const sample = sym === '.' ? pressMs : pressMs / 3;
  const next = Math.min(max, Math.max(min, unit * (1 - rate) + sample * rate));
  return { sym, unit: next };
}

export function decodePresses(pressDurations, unit) {
  return pressDurations.map((d) => classify(d, unit)).join('');
}
