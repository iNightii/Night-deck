const $ = id => document.getElementById(id);
let snap = null;
const rowEls = {};
const LABEL = { aguardando: 'Aguardando navegador', connected: 'No chat', connecting: 'Conectando', 'auth-failed': 'Login recusado', expirado: 'Expirou', 'sem-conta': 'Sem conta', desligado: 'Desligado' };

function applyTheme(t) { Object.entries(t || {}).forEach(([k, v]) => document.documentElement.style.setProperty(`--${k}`, v)); }
function say(level, text, account) { addLog({ t: new Date().toLocaleTimeString('pt-BR'), level, text, account }); }
function addLog(e) {
  const box = $('log'), d = document.createElement('div');
  if (e.level === 'ok' || e.level === 'erro') d.className = e.level;
  d.innerHTML = `<span class="t">${e.t}</span>`;
  d.append((e.account ? `[C${e.account}] ` : '') + e.text);
  box.appendChild(d); while (box.children.length > 100) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
}

function build(s) {
  snap = s;
  $('enabled').onchange = e => window.twitchApi.set({ enabled: e.target.checked });
  $('openLives').onclick = () => window.twitchApi.openLives();
  $('channels').onchange = () => window.twitchApi.set({ channels: $('channels').value.split(/[\s,;]+/).filter(Boolean) });
  $('resetCh').onclick = () => { $('channels').value = snap.defaults.join('\n'); window.twitchApi.set({ channels: snap.defaults }); };
  $('channels').value = s.config.channels.join('\n');
  refresh();
}

function refresh() {
  if (!snap) return;
  const c = snap.config;
  $('enabled').checked = !!c.enabled;
  $('chCount').textContent = `${c.channels.length} canais · um por linha`;
}

window.twitchApi.onTheme(applyTheme);
window.twitchApi.onState(s => { snap = s; refresh(); });
window.twitchApi.onLog(addLog);
window.twitchApi.get().then(r => { build(r.state); r.logs.forEach(addLog); });
