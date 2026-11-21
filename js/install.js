// Предложение установить приложение на главный экран.
// Chrome/Edge/Android: системный диалог через beforeinstallprompt (событие ловится ещё в index.html).
// iOS: события нет, показывается подсказка «Поделиться → На экран Домой».

const KEY = 'morse-napev.install'; // 'dismissed' | 'installed'

let deferred = window.__installPrompt || null;
const listeners = new Set();

function getFlag() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function setFlag(v) {
  try { localStorage.setItem(KEY, v); } catch { /* хранилище недоступно */ }
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export function isIos() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Можно ли сейчас предложить установку (системным диалогом или инструкцией для iOS).
export function canInstall() {
  if (isStandalone()) return false;
  return !!deferred || isIos();
}

export function onInstallChange(fn) {
  listeners.add(fn);
}
function notify() {
  listeners.forEach((fn) => fn());
}

// Возвращает 'accepted' | 'dismissed' | 'ios' (нужна ручная установка).
export async function promptInstall() {
  if (!deferred) return isIos() ? 'ios' : 'dismissed';
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') setFlag('installed');
  hideBanner();
  notify();
  return outcome;
}

// ---------- баннер ----------

let banner = null;

function hideBanner() {
  banner?.remove();
  banner = null;
}

function el(tag, cls, text) {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text) x.textContent = text;
  return x;
}

export function iosHintText() {
  return 'Нажмите «Поделиться» ⬆︎ внизу или вверху браузера и выберите «На экран Домой».';
}

function showBanner() {
  if (banner || isStandalone() || getFlag()) return;
  const ios = !deferred && isIos();
  if (!deferred && !ios) return;

  banner = el('div', 'install-banner');
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Установка приложения');
  const icon = el('img', 'install-icon');
  icon.src = 'icons/icon-192.png';
  icon.alt = '';
  const text = el('div', 'install-text');
  text.append(el('b', '', 'Установить «Морзянку»?'),
    el('span', '', ios ? iosHintText() : 'Будет открываться с главного экрана и работать без интернета.'));
  const actions = el('div', 'install-actions');
  const later = el('button', 'btn ghost small', ios ? 'Понятно' : 'Не сейчас');
  later.addEventListener('click', () => { setFlag('dismissed'); hideBanner(); });
  actions.append(later);
  if (!ios) {
    const yes = el('button', 'btn primary small', 'Установить');
    yes.addEventListener('click', () => { promptInstall(); });
    actions.append(yes);
  }
  banner.append(icon, text, actions);
  document.body.append(banner);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  showBanner();
  notify();
});

window.addEventListener('appinstalled', () => {
  setFlag('installed');
  deferred = null;
  hideBanner();
  notify();
});

// iOS или событие уже пришло до загрузки модуля.
setTimeout(showBanner, 1200);
