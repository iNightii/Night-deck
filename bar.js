const idx = Number(new URLSearchParams(location.search).get('i'));
const $ = id => document.getElementById(id);
const ICO = p => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const FOCUS = ICO('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>');
const RESTORE = ICO('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>');
const VOL = ICO('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>');
const VOL_OFF = ICO('<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>');
let focused = null, muted = null, startedAt = null, running = true;

// "rodando há 45 min", "rodando há 11 h 10 min"
function upText() {
  if (!running) return '· desligada';
  if (!startedAt) return '';
  const min = Math.floor((Date.now() - startedAt) / 60000);
  if (min < 1) return '· rodando há menos de 1 min';
  if (min < 60) return `· rodando há ${min} min`;
  return `· rodando há ${Math.floor(min / 60)} h ${min % 60} min`;
}
function renderUp() { $('up').textContent = upText(); $('dot').classList.toggle('off', !running); }
setInterval(renderUp, 20000);

$('focusBtn').innerHTML = FOCUS;
$('muteBtn').innerHTML = VOL;
document.addEventListener('click', e => {
  const group = e.target.closest('[data-menu]');
  if (group) { const r = group.getBoundingClientRect(); window.barApi.menu(idx, group.dataset.menu, Math.round(r.left), Math.round(r.bottom)); return; }
  const btn = e.target.closest('[data-action]');
  if (btn) window.barApi.action(idx, btn.dataset.action);
});
window.barApi.onTheme(t => Object.entries(t || {}).forEach(([k, v]) => document.documentElement.style.setProperty(`--${k}`, v)));
window.barApi.onState(s => {
  if (s.name != null) { $('name').textContent = s.name; $('name').title = s.name; }
  if (s.zoom != null) $('zoom').textContent = `${s.zoom}%`;
  if (s.startedAt !== undefined) startedAt = s.startedAt;
  if (s.running !== undefined) running = s.running;
  renderUp();
  if (s.focused != null && s.focused !== focused) {
    focused = s.focused;
    const b = $('focusBtn');
    b.classList.toggle('on', focused);
    b.title = focused ? 'Voltar para o layout normal' : 'Expandir esta conta para ocupar a área principal';
    b.innerHTML = focused ? RESTORE : FOCUS;
  }
  if (s.muted != null && s.muted !== muted) {
    muted = s.muted;
    const b = $('muteBtn');
    b.classList.toggle('on', muted);
    b.title = muted ? 'Ativar o som desta conta' : 'Silenciar esta conta';
    b.innerHTML = muted ? VOL_OFF : VOL;
  }
});
