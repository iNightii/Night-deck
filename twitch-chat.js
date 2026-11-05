// Presença no chat da Twitch (como o Chatterino): uma conexão IRC por conta, sem vídeo.
// Login pelo navegador padrão (fluxo por código da Twitch): o app abre a página de autorização
// já com o código preenchido, você só clica em autorizar. Nenhuma senha passa pelo app.
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { safeStorage, shell } = require('electron');

// Confira a lista na janela: erro de digitação em um nome é o único jeito de um canal não funcionar.
const DEFAULT_CHANNELS = ['clovaobengala', 'rodil', 'mecmeno', 'dersin2k', 'cogu', 'faasii', 'patopapao', 'axtlol',
  'matta', 'biscoitao', 'tftoddy', 'luccatv', 'techzz', 'guaxilol1', 'denissnidertv', 'faturetosl'];
const CHAN_RE = /^[a-z0-9_]{3,25}$/;
const CLIENT_RE = /^[A-Za-z0-9]{10,60}$/;
const DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';

// Só aceita campos conhecidos e valores válidos (a janela é uma fronteira de confiança).
function sanitize(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (typeof p.clientId === 'string') { const v = p.clientId.trim(); if (v === '' || CLIENT_RE.test(v)) out.clientId = v; }
  if (Array.isArray(p.channels)) {
    const seen = new Set(); out.channels = [];
    for (const c of p.channels) {
      const v = String(c).trim().toLowerCase().replace(/^#/, '');
      if (CHAN_RE.test(v) && !seen.has(v) && seen.size < 40) { seen.add(v); out.channels.push(v); }
    }
  }
  if (p.slots && typeof p.slots === 'object') {
    out.slots = {};
    for (let i = 1; i <= 4; i++) if (p.slots[i] && typeof p.slots[i].enabled === 'boolean') out.slots[i] = { enabled: p.slots[i].enabled };
  }
  return out;
}

function createTwitchChat({
  userData, notify,
  irc = { host: 'irc.chat.twitch.tv', port: 6697, rejectUnauthorized: true },
  fetchImpl = (...a) => fetch(...a),
  openUrl = u => shell.openExternal(u)
}) {
  const file = path.join(userData, 'twitch.json');
  const cfg = { enabled: false, clientId: '', channels: [...DEFAULT_CHANNELS], slots: {} };
  for (let i = 1; i <= 4; i++) cfg.slots[i] = { enabled: true, login: '', expiresAt: 0 };
  const tokens = {}, refreshTokens = {};   // só em memória; no disco vão criptografados
  const rt = {};                            // estado de execução de cada conta
  for (let i = 1; i <= 4; i++) rt[i] = { status: 'sem-conta', message: '', joined: new Set(), sock: null, timers: [], backoff: 0, stopped: true, gen: 0, pending: null };
  const logs = [];

  const canEncrypt = () => { try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; } };
  const enc = v => safeStorage.encryptString(v).toString('base64');
  const dec = v => safeStorage.decryptString(Buffer.from(v, 'base64'));
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof saved.enabled === 'boolean') cfg.enabled = saved.enabled;
    if (typeof saved.clientId === 'string' && CLIENT_RE.test(saved.clientId)) cfg.clientId = saved.clientId;
    if (Array.isArray(saved.channels)) cfg.channels = sanitize({ channels: saved.channels }).channels;
    for (let i = 1; i <= 4; i++) {
      const s = saved.slots?.[i]; if (!s) continue;
      if (typeof s.enabled === 'boolean') cfg.slots[i].enabled = s.enabled;
      if (typeof s.login === 'string' && /^[a-z0-9_]{1,25}$/.test(s.login)) cfg.slots[i].login = s.login;
      if (Number.isFinite(s.expiresAt)) cfg.slots[i].expiresAt = s.expiresAt;
      if (canEncrypt()) {
        try { if (typeof s.tokenEnc === 'string') tokens[i] = dec(s.tokenEnc); } catch (_) {}
        try { if (typeof s.refreshEnc === 'string') refreshTokens[i] = dec(s.refreshEnc); } catch (_) {}
      }
      if (!tokens[i]) cfg.slots[i].login = ''; // sem token válido: pede para conectar de novo
    }
  } catch (_) {}

  const save = () => {
    try {
      const out = { enabled: cfg.enabled, clientId: cfg.clientId, channels: cfg.channels, slots: {} };
      for (let i = 1; i <= 4; i++) {
        out.slots[i] = { enabled: cfg.slots[i].enabled, login: cfg.slots[i].login, expiresAt: cfg.slots[i].expiresAt };
        if (canEncrypt()) {
          if (tokens[i]) out.slots[i].tokenEnc = enc(tokens[i]);
          if (refreshTokens[i]) out.slots[i].refreshEnc = enc(refreshTokens[i]);
        }
      }
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(out, null, 2));
    } catch (_) {}
  };
  const snapshot = () => {
    const slots = {}, runtime = {};
    for (let i = 1; i <= 4; i++) {
      slots[i] = { enabled: cfg.slots[i].enabled, login: cfg.slots[i].login, hasToken: !!tokens[i] };
      const p = rt[i].pending;
      runtime[i] = { status: rt[i].status, message: rt[i].message, joined: rt[i].joined.size, pending: p ? { url: p.url, code: p.code } : null };
    }
    return { config: { enabled: cfg.enabled, clientId: cfg.clientId, channels: cfg.channels, slots }, runtime, defaults: DEFAULT_CHANNELS, canEncrypt: canEncrypt() };
  };
  let pushTimer = null;
  const push = () => { if (pushTimer) return; pushTimer = setTimeout(() => { pushTimer = null; notify('state', snapshot()); }, 120); };
  const log = (slot, level, text) => {
    const entry = { t: new Date().toLocaleTimeString('pt-BR'), account: slot, level, text };
    logs.push(entry); if (logs.length > 100) logs.shift();
    notify('log', entry);
  };
  const setStatus = (i, status, message = '') => { rt[i].status = status; rt[i].message = message; push(); };
  const post = (url, body) => fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  // ---------- Tokens: renovação automática ----------
  async function refreshToken(i) {
    if (!refreshTokens[i]) return 'invalid';
    try {
      const res = await post(TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refreshTokens[i], client_id: cfg.clientId });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.access_token) {
        tokens[i] = j.access_token;
        if (j.refresh_token) refreshTokens[i] = j.refresh_token;
        cfg.slots[i].expiresAt = Date.now() + (j.expires_in || 14400) * 1000;
        save();
        return 'ok';
      }
      return (res.status === 400 || res.status === 401) ? 'invalid' : 'retry';
    } catch (_) { return 'retry'; }
  }
  async function ensureFresh(i) {
    const s = cfg.slots[i];
    if (!refreshTokens[i]) return (!s.expiresAt || s.expiresAt > Date.now()) ? 'ok' : 'invalid';
    if (s.expiresAt - Date.now() > 10 * 60 * 1000) return 'ok';
    const r = await refreshToken(i);
    return (r === 'retry' && s.expiresAt > Date.now()) ? 'ok' : r; // sem internet mas o acesso ainda vale: segue
  }
  // Renova de tempos em tempos para o acesso nunca vencer enquanto o app está aberto.
  const renewTimer = setInterval(() => {
    for (let i = 1; i <= 4; i++) if (refreshTokens[i] && cfg.slots[i].expiresAt - Date.now() < 3 * 3600 * 1000) refreshToken(i);
  }, 3600 * 1000);
  renewTimer.unref?.();

  // ---------- IRC ----------
  function stopIrc(i) {
    const r = rt[i];
    r.stopped = true; r.gen++;
    r.timers.forEach(clearTimeout); r.timers = [];
    clearInterval(r.watch); r.watch = null;
    clearTimeout(r.reconnect); r.reconnect = null;
    if (r.sock) { const s = r.sock; r.sock = null; try { s.destroy(); } catch (_) {} }
    r.joined = new Set();
  }

  function handleLine(i, line, send) {
    const r = rt[i];
    if (line.startsWith('PING')) { send('PONG ' + line.slice(5)); return; }
    // O comando fica sempre numa posição fixa (depois das tags e do prefixo): o texto de
    // mensagens de chat nunca é interpretado como comando.
    const m = line.match(/^(?:@[^ ]* )?(?::[^ ]* )?([A-Za-z0-9]+)(?: (.*))?$/);
    if (!m) return;
    const cmd = m[1], rest = m[2] || '';
    if (cmd === '001') {
      r.backoff = 0;
      setStatus(i, 'connected', 'Conectado');
      const list = cfg.channels.map(c => '#' + c);
      for (let k = 0, n = 0; k < list.length; k += 6, n++) {
        r.timers.push(setTimeout(() => send('JOIN ' + list.slice(k, k + 6).join(',')), n * 1500)); // limite: 20 JOINs / 10 s
      }
    } else if (cmd === 'NOTICE' && rest.startsWith('* :') && /authentication failed|Improperly formatted auth|Invalid NICK/i.test(rest)) {
      // Só avisos sem canal ('*') contam: assim ninguém consegue forjar isso pelo chat.
      r.authFailed = true;
      setStatus(i, 'auth-failed', 'A Twitch recusou o login. Reconecte esta conta.');
      log(i, 'erro', 'Login recusado pela Twitch. Reconecte a conta.');
      try { r.sock?.destroy(); } catch (_) {}
    } else if (cmd === 'RECONNECT') {
      try { r.sock?.destroy(); } catch (_) {}
    } else if (cmd === 'ROOMSTATE') {
      const ch = (rest.split(' ')[0] || '').replace(/^#/, '').toLowerCase();
      if (CHAN_RE.test(ch) && !r.joined.has(ch)) { r.joined.add(ch); push(); }
    }
  }

  function openSocket(i) {
    const r = rt[i], s = cfg.slots[i], token = tokens[i];
    r.authFailed = false; r.buf = ''; r.lastData = Date.now(); r.lastPing = Date.now();
    const sock = tls.connect({ host: irc.host, port: irc.port, servername: irc.host, rejectUnauthorized: irc.rejectUnauthorized !== false });
    r.sock = sock;
    sock.setEncoding('utf8');
    sock.setKeepAlive(true, 60000);
    const send = line => { if (!sock.destroyed) sock.write(line + '\r\n'); };
    sock.on('secureConnect', () => {
      send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands'); // igual ao Chatterino
      send('PASS oauth:' + token);
      send('NICK ' + s.login);
    });
    sock.on('data', chunk => {
      r.lastData = Date.now();
      r.buf += chunk;
      if (r.buf.length > 1e6) r.buf = ''; // proteção contra lixo sem quebra de linha
      let idx;
      while ((idx = r.buf.indexOf('\r\n')) >= 0) { const line = r.buf.slice(0, idx); r.buf = r.buf.slice(idx + 2); if (line) handleLine(i, line, send); }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
      if (r.sock !== sock) return; // já foi substituída ou parada de propósito
      r.sock = null; r.timers.forEach(clearTimeout); r.timers = []; clearInterval(r.watch); r.watch = null;
      r.joined = new Set();
      if (r.stopped || r.authFailed) { push(); return; }
      r.backoff = Math.min(60, (r.backoff || 1) * 2);
      const wait = r.backoff * 1000 + Math.random() * 1000;
      setStatus(i, 'connecting', `Reconectando em ${Math.round(wait / 1000)}s…`);
      r.reconnect = setTimeout(() => startIrc(i), wait);
    });
    // Vigia: confirma que a conexão está viva e a refaz se ficar muda.
    r.watch = setInterval(() => {
      if (Date.now() - r.lastData > 6 * 60 * 1000) { try { sock.destroy(); } catch (_) {} return; }
      if (Date.now() - r.lastPing > 4 * 60 * 1000) { r.lastPing = Date.now(); send('PING :tmi.twitch.tv'); }
    }, 30000);
  }

  function startIrc(i) {
    stopIrc(i);
    const r = rt[i], s = cfg.slots[i];
    if (!tokens[i] || !s.login) { setStatus(i, 'sem-conta', 'Conecte uma conta Twitch.'); return; }
    if (!cfg.enabled || !s.enabled) { setStatus(i, 'desligado'); return; }
    r.stopped = false;
    const gen = r.gen;
    setStatus(i, 'connecting', 'Conectando…');
    ensureFresh(i).then(res => {
      if (r.gen !== gen || r.stopped) return; // foi parada ou reiniciada enquanto renovava
      if (res === 'ok') openSocket(i);
      else if (res === 'invalid') { setStatus(i, 'expirado', 'O acesso expirou. Reconecte a conta.'); log(i, 'erro', 'O acesso desta conta expirou. Clique em Reconectar.'); }
      else { setStatus(i, 'connecting', 'Sem conexão com a Twitch. Tentando de novo…'); r.reconnect = setTimeout(() => startIrc(i), 30000); }
    });
  }

  const startAll = () => { for (let i = 1; i <= 4; i++) setTimeout(() => startIrc(i), (i - 1) * 800); };
  const stopAll = () => { for (let i = 1; i <= 4; i++) startIrc(i); }; // startIrc para a conexão e deixa o status certo ("desligado")

  // ---------- Login pelo navegador (fluxo por código) ----------
  function cancelPending(i) {
    const p = rt[i].pending;
    if (p) { clearTimeout(p.timer); rt[i].pending = null; }
  }
  async function validate(token) {
    const res = await fetchImpl(VALIDATE_URL, { headers: { Authorization: 'OAuth ' + token } });
    if (!res.ok) throw new Error('A Twitch não validou o acesso (código ' + res.status + ').');
    return res.json();
  }
  function adopt(i, token, v, refresh) {
    tokens[i] = token;
    if (refresh) refreshTokens[i] = refresh; else delete refreshTokens[i];
    cfg.slots[i].login = String(v.login || '').toLowerCase();
    cfg.slots[i].expiresAt = v.expires_in ? Date.now() + v.expires_in * 1000 : 0;
    cfg.slots[i].enabled = true;
    save(); startIrc(i); push();
  }
  function schedulePoll(i, p) { p.timer = setTimeout(() => poll(i, p), p.interval * 1000); }
  async function poll(i, p) {
    if (rt[i].pending !== p) return; // cancelado ou substituído
    if (Date.now() > p.expires) { rt[i].pending = null; log(i, 'erro', 'O código expirou. Clique em Conectar de novo.'); push(); return; }
    try {
      const res = await post(TOKEN_URL, { client_id: cfg.clientId, scopes: 'chat:read', device_code: p.device, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      const j = await res.json().catch(() => ({}));
      if (rt[i].pending !== p) return;
      if (res.ok && j.access_token) {
        rt[i].pending = null;
        const v = await validate(j.access_token);
        if (v.client_id !== cfg.clientId) throw new Error('O acesso veio de outro aplicativo. Confira o Client ID.');
        if (!(v.scopes || []).includes('chat:read')) throw new Error('Faltou a permissão de ler o chat.');
        adopt(i, j.access_token, v, j.refresh_token);
        log(i, 'ok', `Conta conectada: ${cfg.slots[i].login}`);
        return;
      }
      const msg = String(j.message || '').toLowerCase();
      if (msg.includes('pending')) { schedulePoll(i, p); return; }
      if (msg.includes('slow')) { p.interval += 5; schedulePoll(i, p); return; }
      rt[i].pending = null; push();
      log(i, 'erro', msg.includes('denied') ? 'A autorização foi negada no navegador.' : 'A autorização não foi concluída (' + (j.message || res.status) + '). Clique em Conectar de novo.');
    } catch (e) {
      if (rt[i].pending !== p) return;
      if (/Client ID|permissão|validou/.test(String(e?.message))) { rt[i].pending = null; push(); log(i, 'erro', String(e.message)); return; }
      schedulePoll(i, p); // rede instável: tenta de novo até o código expirar
    }
  }

  return {
    snapshot, logs: () => logs,
    start() { if (cfg.enabled) startAll(); },
    stop() { clearInterval(renewTimer); for (let i = 1; i <= 4; i++) { stopIrc(i); cancelPending(i); } },
    setConfig(patch) {
      const before = cfg.channels.join(',');
      if ('enabled' in patch) cfg.enabled = patch.enabled;
      if ('clientId' in patch) cfg.clientId = patch.clientId;
      if (patch.channels) cfg.channels = patch.channels;
      const changed = [];
      for (const [i, v] of Object.entries(patch.slots || {})) if (cfg.slots[i].enabled !== v.enabled) { cfg.slots[i].enabled = v.enabled; changed.push(Number(i)); }
      save();
      if ('enabled' in patch) { cfg.enabled ? startAll() : stopAll(); }
      else if (patch.channels && cfg.channels.join(',') !== before) { for (let i = 1; i <= 4; i++) if (tokens[i]) startIrc(i); }
      else changed.forEach(startIrc);
      push();
    },
    // Pede o código à Twitch e abre a página de autorização no navegador padrão.
    async connect(i) {
      if (!CLIENT_RE.test(cfg.clientId)) return { ok: false, message: 'Cole primeiro o Client ID do seu aplicativo da Twitch.' };
      cancelPending(i);
      let d;
      try {
        const res = await post(DEVICE_URL, { client_id: cfg.clientId, scopes: 'chat:read' });
        d = await res.json().catch(() => ({}));
        if (!res.ok || !d.device_code) throw new Error(d.message ? `A Twitch recusou: ${d.message}. Confira o Client ID e se o tipo do aplicativo é Público.` : 'A Twitch recusou o pedido. Confira o Client ID.');
      } catch (e) { return { ok: false, message: String(e?.message || e) }; }
      const url = typeof d.verification_uri === 'string' && d.verification_uri.startsWith('https://www.twitch.tv/') ? d.verification_uri : 'https://www.twitch.tv/activate';
      const p = { url, code: String(d.user_code || ''), device: d.device_code, expires: Date.now() + (d.expires_in || 1800) * 1000, interval: Math.max(5, d.interval || 5), timer: null };
      rt[i].pending = p; push();
      try { openUrl(url); } catch (_) {}
      schedulePoll(i, p);
      log(i, 'info', 'Autorize no navegador que abriu (entre na Twitch com a conta certa, se pedir).');
      return { ok: true, message: 'Autorize no navegador que abriu.' };
    },
    openLink(i) { const p = rt[i].pending; if (p) { try { openUrl(p.url); } catch (_) {} } },
    cancel(i) { cancelPending(i); push(); return { ok: true }; },
    disconnect(i) {
      stopIrc(i); cancelPending(i);
      delete tokens[i]; delete refreshTokens[i];
      cfg.slots[i].login = ''; cfg.slots[i].expiresAt = 0;
      save(); setStatus(i, 'sem-conta', 'Conecte uma conta Twitch.');
      log(i, 'info', 'Conta removida.');
      return { ok: true };
    },
    _importToken: adopt // usado nos testes
  };
}

module.exports = { createTwitchChat, sanitize, DEFAULT_CHANNELS };
