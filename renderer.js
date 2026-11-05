// Barra superior. As barras de cada conta agora são telas próprias (bar.html).
const $ = id => document.getElementById(id);
const focusDock = $('focusDock');
const readJSON = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const names = readJSON('pokeidle-account-names', {});
const hidden = readJSON('pokeidle-account-hidden', {});
const savedTheme = readJSON('pokeidle-theme', null);

const DEFAULT_THEME = { bg:'#0b1120', bar:'#111827', card:'#172033', button:'#1e293b', accent:'#7c3aed', text:'#f8fafc' };
const ICON = {
  eyeOff: '<path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A16.8 16.8 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
};
const svg = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
const nameOf = i => names[i] || `Conta ${i}`;
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function saveHidden() { localStorage.setItem('pokeidle-account-hidden', JSON.stringify(hidden)); }

function applyTheme(theme, save = true) {
  const finalTheme = { ...DEFAULT_THEME, ...(theme || {}) };
  Object.entries(finalTheme).forEach(([key, value]) => document.documentElement.style.setProperty(`--${key}`, value));
  if (save) localStorage.setItem('pokeidle-theme', JSON.stringify(finalTheme));
}

let focusedIndex = null;

// ---------- Contas: tela principal e escondidas (tudo no mesmo lugar) ----------
// Cada conta tem um botão só. Clique = tela principal. Conta escondida fica apagada,
// com o ícone de olho cortado; clicar nela traz de volta. Clique direito = esconder/mostrar.
function buildFocusDock() {
  focusDock.innerHTML = '';
  for (let n = 1; n <= 4; n++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toolbar-btn focus-account-btn';
    btn.dataset.focusAccount = n;
    btn.innerHTML = `<span class="fd-n">${n}</span><span class="fd-l">${escapeHtml(nameOf(n))}</span><span class="fd-eye">${svg('eyeOff')}</span>`;
    focusDock.appendChild(btn);
  }
  const all = document.createElement('button');
  all.type = 'button'; all.className = 'toolbar-btn'; all.id = 'showAllAccounts';
  all.title = 'Voltar para o layout normal';
  all.innerHTML = `${svg('grid')}<span class="fd-l">Todas</span>`;
  focusDock.appendChild(all);
}
function setAccountHidden(i, value) {
  hidden[i] = value;
  saveHidden();
  refreshDock();
  window.pokeidle.toggleAccount(i, !value);
}
focusDock.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'showAllAccounts') { window.pokeidle.clearAccountFocus(); return; }
  const n = Number(btn.dataset.focusAccount);
  if (hidden[n] === true) setAccountHidden(n, false); // traz de volta para a grade
  else window.pokeidle.focusAccount(n);
});
focusDock.addEventListener('contextmenu', e => {
  const btn = e.target.closest('[data-focus-account]');
  if (!btn) return;
  e.preventDefault();
  const n = Number(btn.dataset.focusAccount);
  setAccountHidden(n, hidden[n] !== true);
});
function refreshDock() {
  document.querySelectorAll('[data-focus-account]').forEach(btn => {
    const n = Number(btn.dataset.focusAccount), h = hidden[n] === true;
    btn.classList.toggle('is-hidden', h);
    btn.classList.toggle('active', !h && focusedIndex === n);
    btn.title = h ? `${nameOf(n)} está escondida. Clique para mostrar de novo.`
                  : `Mostrar ${nameOf(n)} como tela principal (clique direito: esconder)`;
  });
  $('showAllAccounts')?.classList.toggle('active', focusedIndex == null);
}

function setLayoutActive(mode) {
  document.querySelectorAll('.toolbar-btn[data-layout]').forEach(b => b.classList.toggle('active', b.dataset.layout === mode));
  document.querySelector('.layout-group')?.setAttribute('data-mode', mode);
}

// ---------- Botões ----------
$('reloadAll').onclick = () => window.pokeidle.reloadAll();
$('checkUpdates').onclick = () => window.pokeidle.checkUpdates();
$('openExternal').onclick = () => window.pokeidle.openExternal();
$('openHuntingGuide').onclick = () => window.pokeidle.openHuntingGuide();
$('layoutGrid').onclick = () => window.pokeidle.setLayout('grid');
$('layoutRow').onclick = () => window.pokeidle.setLayout('row');
$('themeButton').onclick = () => window.pokeidle.toggleThemeWindow();
$('openTwitchChat').onclick = () => window.pokeidle.openTwitchChat();
$('echoButton').onclick = () => window.pokeidle.toggleEcho();
window.pokeidle.onEchoState(enabled => { $('echoButton').classList.toggle('active', enabled); $('echoButton').title = enabled ? 'Echo ativado: cliques em controles são replicados nas outras contas' : 'Echo desativado: clique para sincronizar controles entre contas'; });
window.pokeidle.getEchoState();

// ---------- HUD: menus, zoom global, tela cheia ----------
const PERF_LABEL = { normal: 'Normal', eco: 'Economia', ultra: 'ULTRA' };
function showMenu(name, btn) { const rc = btn.getBoundingClientRect(); window.pokeidle.hudMenu(name, rc.left, rc.bottom + 2); }
$('extButton').onclick = e => showMenu('ext', e.currentTarget);
$('extrasButton').onclick = e => showMenu('extras', e.currentTarget);
$('perfButton').onclick = e => showMenu('perf', e.currentTarget);
$('zoomOut').onclick = () => window.pokeidle.hudZoom(-10);
$('zoomIn').onclick = () => window.pokeidle.hudZoom(10);
$('zoomLabel').onclick = () => window.pokeidle.hudZoom(0);
$('fullscreenButton').onclick = () => window.pokeidle.hudFullscreen();
window.pokeidle.onHudState(({ perf, zoom }) => {
  $('perfLabel').textContent = PERF_LABEL[perf] || 'Normal';
  $('perfButton').classList.toggle('perf-on', perf !== 'normal');
  $('perfButton').classList.toggle('perf-ultra', perf === 'ultra');
  $('zoomLabel').textContent = `${zoom}%`;
});

// ---------- Eventos vindos do main ----------
window.pokeidle.onThemeUpdated(theme => applyTheme(theme, true));
window.pokeidle.onLayoutChanged(({ mode }) => setLayoutActive(mode));
window.pokeidle.onFocusAccountChanged(index => { focusedIndex = index == null ? null : Number(index); refreshDock(); });
// Conta escondida/mostrada pelo botão da própria barra (ou ao focar uma conta escondida).
window.pokeidle.onAccountHidden(({ index, hidden: h }) => { hidden[index] = !!h; saveHidden(); refreshDock(); });

// ---------- Início ----------
applyTheme(savedTheme, false);
window.pokeidle.syncTheme({ ...DEFAULT_THEME, ...(savedTheme || {}) });
buildFocusDock();
refreshDock();
// Passa ao main os nomes e as contas escondidas na sessão anterior.
window.pokeidle.initUiState({ names, hidden, legacyEco: localStorage.getItem('pokeidle-eco') === '1' });

window.pokeidle.onResourceState(state => { const el = $('resourceStatus'); if (el && Number.isFinite(state?.ramMb)) el.textContent = `RAM ${state.ramMb.toLocaleString('pt-BR')} MB`; });
