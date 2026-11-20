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

export function decodePresses(pressDurations, unit) {
  return pressDurations.map((d) => classify(d, unit)).join('');
}
