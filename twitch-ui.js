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
  for (let i = 1; i <= 4; i++) {
    const row = document.createElement('div'); row.className = 'slot';
    row.innerHTML = `<label class="switch"><input type="checkbox"><i></i></label>
      <div class="who"><b>Conta ${i}</b><small></small></div>
      <span class="chip-st">—</span>
      <button class="btn" data-a="connect">Conectar</button>
      <button class="btn ghost" data-a="video">Abrir vídeo</button>
      <button class="btn ghost" data-a="remove">Remover</button>
      <div class="pend" hidden><span class="grow">Autorize no navegador que abriu. Código: <b class="code"></b></span>
        <button class="btn ghost" data-a="again">Abrir de novo</button><button class="btn ghost" data-a="copy">Copiar link</button><button class="btn ghost" data-a="cancel">Cancelar</button></div>`;
    const en = row.querySelector('input');
    en.onchange = () => window.twitchApi.set({ slots: { [i]: { enabled: en.checked } } });
    row.querySelector('[data-a=connect]').onclick = async () => {
      const r = await window.twitchApi.connect(i);
      say(r.ok ? 'info' : 'erro', r.message, i);
    };
    row.querySelector('[data-a=again]').onclick = () => window.twitchApi.openLink(i);
    row.querySelector('[data-a=video]').onclick = () => {
      window.twitchApi.openVideo(i);
      say('info', 'Janela de vídeo aberta. Entre na Twitch com esta conta e inicie uma live para manter o vídeo ativo.', i);
    };
    row.querySelector('[data-a=copy]').onclick = async () => {
      const p = snap?.runtime[i]?.pending; if (!p) return;
      try { await navigator.clipboard.writeText(p.url); say('ok', 'Link copiado. Cole numa janela anônima do navegador.', i); } catch (_) { say('erro', 'Não consegui copiar o link.', i); }
    };
    row.querySelector('[data-a=cancel]').onclick = async () => { await window.twitchApi.cancel(i); };
    row.querySelector('[data-a=remove]').onclick = async () => { await window.twitchApi.disconnect(i); refresh(); };
    $('slots').appendChild(row);
    rowEls[i] = { pend: row.querySelector('.pend'), code: row.querySelector('.code'), row, en, who: row.querySelector('small'), chip: row.querySelector('.chip-st'), connect: row.querySelector('[data-a=connect]'), remove: row.querySelector('[data-a=remove]') };
  }
  $('enabled').onchange = e => window.twitchApi.set({ enabled: e.target.checked });
  $('clientId').onchange = e => window.twitchApi.set({ clientId: e.target.value.trim() });
  $('openConsole').onclick = () => window.twitchApi.openConsole();
  $('openLives').onclick = () => window.twitchApi.openLives();
  $('channels').onchange = () => window.twitchApi.set({ channels: $('channels').value.split(/[\s,;]+/).filter(Boolean) });
  $('resetCh').onclick = () => { $('channels').value = snap.defaults.join('\n'); window.twitchApi.set({ channels: snap.defaults }); };
  $('clientId').value = s.config.clientId;
  $('channels').value = s.config.channels.join('\n');
  refresh();
}

function refresh() {
  if (!snap) return;
  const c = snap.config;
  $('enabled').checked = !!c.enabled;
  let on = 0;
  for (let i = 1; i <= 4; i++) {
    const s = c.slots[i], r = snap.runtime[i], el = rowEls[i];
    el.en.checked = !!s.enabled;
    el.who.textContent = s.login ? `${s.login}${r.status === 'connected' ? ` · ${r.joined}/${c.channels.length} canais` : ''}` : 'nenhuma conta Twitch';
    const st = r.pending ? 'aguardando' : r.status;
    el.pend.hidden = !r.pending;
    if (r.pending) el.code.textContent = r.pending.code;
    el.chip.textContent = LABEL[st] || st;
    el.chip.className = 'chip-st ' + st;
    el.chip.title = r.message || '';
    el.connect.textContent = s.hasToken ? 'Reconectar' : 'Conectar';
    el.remove.hidden = !s.hasToken;
    if (r.status === 'connected') on++;
  }
  $('sum').textContent = `${on} de 4 no chat`;
  $('chCount').textContent = `${c.channels.length} canais · um por linha`;
  $('encInfo').textContent = snap.canEncrypt ? 'O acesso de cada conta fica guardado criptografado neste computador.' : 'Atenção: este computador não oferece armazenamento seguro; será preciso reconectar as contas toda vez que abrir o app.';
}

window.twitchApi.onTheme(applyTheme);
window.twitchApi.onState(s => { snap = s; refresh(); });
window.twitchApi.onLog(addLog);
window.twitchApi.get().then(r => { build(r.state); r.logs.forEach(addLog); });
