const { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, dialog, clipboard, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
// Preserva logins, cookies e configuracoes da versao Electron anterior.
app.setPath('userData', path.join(app.getPath('appData'), 'PokeIdle Multiscreen'));
const { createTwitchChat, sanitize: sanitizeTwitch } = require('./twitch-chat');
const perf = require('./perf');
const { createExtensionManager } = require('./extensions');
const { createExtraFeatures } = require('./extra-features');
const { createStorageImporter, applyPending: applyPendingStorageImports } = require('./storage-import');

// ---------- Configuração e registro de falhas ----------
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const LOG_PATH = path.join(app.getPath('userData'), 'logs', 'crash-log.txt');
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; } }
function writeConfig(patch) {
  try { fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true }); fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...readConfig(), ...patch }, null, 2)); } catch (_) {}
}
const config = readConfig();

const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
let updateBusy = false;
let pendingInstaller = null;
function getBuildNumber() {
  try { return Number(JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8').replace(/^\uFEFF/, '')).run) || 0; }
  catch (_) { return 0; }
}
function getUpdateUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Redirecionamentos demais'));
    const u = new URL(url);
    if (u.protocol !== 'https:' || !['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(u.hostname))
      return reject(new Error('Origem de download nao permitida'));
    const req = https.get(url, { headers: { 'User-Agent': 'Night-Deck-Updater', Accept: 'application/vnd.github+json' }, timeout: 30000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume(); resolve(getUpdateUrl(new URL(res.headers.location, url).toString(), redirects + 1)); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('Tempo limite de download')));
    req.on('error', reject);
  });
}
async function fetchUpdateBuffer(url, maxBytes) {
  const res = await getUpdateUrl(url);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    res.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { res.destroy(new Error('Resposta muito grande')); return; }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}
async function checkNightDeckUpdates() {
  if (updateBusy || pendingInstaller || !app.isPackaged || process.platform !== 'win32') return;
  updateBusy = true;
  try {
    const release = JSON.parse((await fetchUpdateBuffer('https://api.github.com/repos/iNightii/Night-deck/releases/latest', 500000)).toString('utf8'));
    const latestBuild = Number(String(release.tag_name || '').match(/^build-(\d+)$/)?.[1]);
    if (!latestBuild || latestBuild <= getBuildNumber()) { logLine('Atualizador: sem nova compilacao'); return; }
    const installer = (release.assets || []).find(a => /^Night-Deck.*\.exe$/i.test(a.name));
    const checksum = (release.assets || []).find(a => a.name === installer?.name + '.sha256');
    if (!installer || !checksum) { logLine('Atualizador: release sem instalador e SHA256'); return; }
    const hashText = (await fetchUpdateBuffer(checksum.browser_download_url, 8192)).toString('utf8');
    const expected = hashText.match(/^([a-f0-9]{64})\s+/i)?.[1]?.toLowerCase();
    if (!expected) throw new Error('SHA256 invalido');
    const targetDir = path.join(app.getPath('userData'), 'updates');
    fs.mkdirSync(targetDir, { recursive: true });
    const target = path.join(targetDir, 'Night-Deck-update-' + latestBuild + '.exe');
    const temp = target + '.part';
    const res = await getUpdateUrl(installer.browser_download_url);
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(temp);
      res.on('data', chunk => hash.update(chunk));
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
    if (hash.digest('hex') !== expected) { fs.rmSync(temp, { force: true }); throw new Error('SHA256 nao confere'); }
    fs.renameSync(temp, target);
    pendingInstaller = target;
    logLine('Atualizador: compilacao ' + latestBuild + ' verificada e pronta para instalar');
    // Instala em silencio ao encerrar o programa, sem interromper as contas.
  } catch (error) { logLine('Atualizador: ' + String(error.message || error)); }
  finally { updateBusy = false; }
}
app.on('quit', () => {
  if (!pendingInstaller || !fs.existsSync(pendingInstaller)) return;
  const safePath = pendingInstaller.replace(/'/g, "''");
  const command = "Start-Sleep -Seconds 3; Start-Process -FilePath '" + safePath + "' -ArgumentList '/S'";
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], {
      detached: true, stdio: 'ignore', windowsHide: true
    });
    child.unref();
  } catch (error) { logLine('Atualizador: falha ao iniciar instalador: ' + error.message); }
});

// Expõe o GC do V8 para coleta periódica nos renderizadores.
app.commandLine.appendSwitch('js-flags', '--expose-gc');
// Modo compatibilidade: precisa ser decidido antes do app iniciar.
if (config.disableGpu) app.disableHardwareAcceleration();

function logLine(text) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 500 * 1024) fs.writeFileSync(LOG_PATH, '');
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] v${app.getVersion()} ${text}\n`);
  } catch (_) {}
}
// Se o processo de GPU (ou qualquer outro) cair, fica registrado com o motivo.
app.on('child-process-gone', (_, d) => logLine(`child-process-gone tipo=${d.type} motivo=${d.reason} codigo=${d.exitCode} nome=${d.name || ''}`));
app.on('render-process-gone', (_, wc, d) => logLine(`render-process-gone motivo=${d.reason} codigo=${d.exitCode}`));

const GPU_VENDORS = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' };
async function showGpuDiagnostics() {
  let info = {};
  try { info = await app.getGPUInfo('basic'); } catch (_) {}
  const devices = (info.gpuDevice || []).map(d => `${GPU_VENDORS[d.vendorId] || 'vendor 0x' + (d.vendorId || 0).toString(16)} (device 0x${(d.deviceId || 0).toString(16)}) driver ${d.driverVersion || '?'}${d.active ? ' [ativa]' : ''}`).join('\n') || '(sem dados)';
  const text = `Night Deck v${app.getVersion()} | Electron ${process.versions.electron} | Chromium ${process.versions.chrome}\nAceleração de GPU desligada pelo app: ${!!config.disableGpu}\n\nPlacas:\n${devices}\n\nRecursos:\n${JSON.stringify(app.getGPUFeatureStatus(), null, 1)}`;
  const r = await dialog.showMessageBox(win, { type: 'info', title: 'Diagnóstico de GPU', message: 'Diagnóstico de GPU', detail: text, buttons: ['OK', 'Copiar'], defaultId: 0 });
  if (r.response === 1) clipboard.writeText(text);
}

const GAME_URL = 'https://pokeidle.io/';
// Como o botão "Lives" abre as transmissões: 'multi' = todas em UMA aba (multitwitch.tv), 'tabs' = uma aba por canal.
const TWITCH_OPEN_MODE = 'multi';
const GAME_VISIBLE_FPS = 60; // uma conta só na tela
const GAME_GRID_FPS = 30;    // várias contas ao mesmo tempo
const GAME_HIDDEN_FPS = 10;  // conta fora de vista
let win;
let ui; // barra superior (tela nativa dentro da janela)
let toolbarView = null;
const barViews = new Map();
const accountNames = {};
let layoutMode = 'grid';
let focusedAccount = null;
// Modo de desempenho (normal | eco | ultra) e zoom global, lembrados entre aberturas.
let perfMode = perf.MODES.includes(config.perfMode) ? config.perfMode : 'normal';
let globalZoom = Number.isFinite(config.zoom) ? Math.min(150, Math.max(30, Math.round(config.zoom))) : 100;
const perfState = new Map();   // por conta: CSS inserido pelo modo ultra
const startedAt = new Map();   // por conta: quando começou a rodar (para "rodando há X min")
const poweredOff = new Set();  // contas desligadas (página descarregada)
const mutedAccounts = new Set();
let extensions = null;
let storageImporter = null;
let extraFeatures = null;
let lastShownCount = -1;
const boundsCache = new Map();
const shownCache = new Map();
const fpsCache = new Map();
let layoutTimer = null;
let lastLayoutAt = 0;
const GLOBAL_HEADER = 43;
const ACCOUNT_BAR = 28;
const views = new Map();
let twitchWindow = null;
const twitchVideoWindows = new Map(); // sessão de navegador separada por conta Twitch
let twitchChat = null;
let themeWindow = null;
let restockWindow = null;
let currentTheme = { bg: '#0b1120', bar: '#111827', card: '#172033', button: '#1e293b', accent: '#7c3aed', text: '#f8fafc' };
const visibleAccounts = new Set([1, 2, 3, 4]);
let echoEnabled = config.echoEnabled === true;
const echoLastAt = new Map();

// O preload das WebContentsView envia pelo IPC normal. sendToHost é destinado
// a <webview> e não entrega mensagens de forma confiável para WebContentsView.
ipcMain.on('pokeidle-echo-click', (event, payload) => {
  if (!echoEnabled || !payload || typeof payload !== 'object') return;
  const source = [...views.entries()].find(([, view]) => view.webContents === event.sender);
  if (!source) return;
  const [index] = source;
  if (poweredOff.has(index) || !visibleAccounts.has(index)) return;
  if (typeof payload.path !== 'string' || payload.path.length > 1200) return;

  const text = String(payload.text || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  const tag = String(payload.tag || '').toLowerCase();
  if (!['button', 'a', 'summary', 'label'].includes(tag) && !text) return;
  const now = Date.now();
  if (now - (echoLastAt.get(index) || 0) < 180) return;
  echoLastAt.set(index, now);

  const safe = JSON.stringify({ path: payload.path, tag, text });
  for (const [otherIndex, otherView] of views) {
    if (otherIndex === index || !visibleAccounts.has(otherIndex) || poweredOff.has(otherIndex) || otherView.webContents.isDestroyed()) continue;
    const script = `(() => {
      const d = ${safe};
      const norm = s => String(s || '').trim().replace(/\\s+/g, ' ').slice(0, 100);
      const label = x => norm(x && (x.getAttribute('aria-label') || x.title || x.innerText || x.value));
      let el = null;
      try { el = document.querySelector(d.path); } catch (_) {}
      if (!el || (d.text && label(el) !== d.text)) {
        const all = [...document.querySelectorAll('button,a,summary,label,[role=button],[role=tab],[role=menuitem],[role=option],[onclick],[tabindex]')]
          .filter(x => x.tagName.toLowerCase() === d.tag && (!d.text || label(x) === d.text));
        el = all.length === 1 ? all[0] : null;
      }
      if (!el || el.matches('input,textarea,select,[contenteditable=true]') || el.closest('input,textarea,select,[contenteditable=true]')) return false;
      el.click();
      return true;
    })()`;
    otherView.webContents.executeJavaScript(script, true).catch(error => {
      logLine(`Echo Conta ${index} -> ${otherIndex}: ${error.message}`);
    });
  }
});
// Recarga sem aguardar a Promise de loadURL: em algumas telas do jogo ela pode
// ficar pendente, fazendo os próximos cliques parecerem não funcionar.
const accountReloads = new Map();
function reloadAccountSafely(index) {
  const accountIndex = Number(index);
  const view = views.get(accountIndex);
  if (!view || view.webContents.isDestroyed()) return;
  const wc = view.webContents;
  startedAt.set(accountIndex, Date.now());
  pushBarState(accountIndex);

  // Pequeno bloqueio contra duplo clique, sempre liberado mesmo se o jogo
  // permanecer em carregamento ou se a navegação não concluir.
  const previousTimer = accountReloads.get(accountIndex);
  if (previousTimer) clearTimeout(previousTimer);
  const timer = setTimeout(() => accountReloads.delete(accountIndex), 1800);
  accountReloads.set(accountIndex, timer);

  try {
    const currentURL = wc.getURL();
    if (currentURL && /^https:\/\/pokeidle\.io(?:\/|$)/i.test(currentURL)) {
      // API síncrona: não depende da Promise de loadURL nem de isLoading().
      wc.reloadIgnoringCache();
    } else {
      wc.loadURL(GAME_URL).catch(error => {
        console.error(`Falha ao recarregar a Conta ${accountIndex}:`, error);
      });
    }
  } catch (error) {
    console.error(`Falha ao recarregar a Conta ${accountIndex}:`, error);
    try {
      if (!wc.isDestroyed()) wc.loadURL(GAME_URL).catch(fallbackError =>
        console.error(`Falha na recarga alternativa da Conta ${accountIndex}:`, fallbackError)
      );
    } catch (fallbackError) {
      console.error(`Falha na recarga alternativa da Conta ${accountIndex}:`, fallbackError);
    }
  }
}

function restockDefaults() {
  return { on: false, balls: { on: true, id: 4, keep: 30000, below: 5000 }, revives: { on: true, id: 0, keep: 500, below: 100 }, potions: { on: true, id: 204, keep: 5000, below: 2000 }, potionFirst: true, goldFloor: 1000000 };
}
function normalizedRestock(value) {
  const d = restockDefaults(), v = value && typeof value === 'object' ? value : {};
  const rule = (key, fallback) => { const r = v[key] && typeof v[key] === 'object' ? v[key] : {}; return { on: r.on === undefined ? fallback.on : !!r.on, id: Math.max(0, Math.floor(Number(r.id) || 0)), keep: Math.max(0, Math.min(10000000, Math.floor(Number(r.keep) || 0))), below: Math.max(0, Math.min(10000000, Math.floor(Number(r.below) || 0))) }; };
  return { on: v.on === true, balls: rule('balls', d.balls), revives: rule('revives', d.revives), potions: rule('potions', d.potions), potionFirst: v.potionFirst !== false, goldFloor: Math.max(0, Math.min(1e12, Math.floor(Number(v.goldFloor) || 0))) };
}
function restockFor(index) {
  const all = Array.isArray(readConfig().restock) ? readConfig().restock : [];
  return normalizedRestock(all[index - 1]);
}
function applyRestockConfig(index) {
  const view = views.get(index);
  if (!view || view.webContents.isDestroyed() || !/^https:\/\/pokeidle\.io(?:\/|$)/i.test(view.webContents.getURL())) return;
  const cfg = JSON.stringify(restockFor(index));
  view.webContents.executeJavaScript(`window.__deckRecompra ? window.__deckRecompra.configure(${cfg}) : false`, true).catch(() => {});
}
function openRestockWindow(index) {
  if (restockWindow && !restockWindow.isDestroyed()) {
    restockWindow.show(); restockWindow.focus(); restockWindow.webContents.send('restock-account', index); return;
  }
  restockWindow = new BrowserWindow({ width: 760, height: 690, minWidth: 680, minHeight: 620, title: 'Recompra automática — PokeIdle Multiscreen', webPreferences: { preload: path.join(__dirname, 'restock-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  restockWindow.setMenuBarVisibility(false);
  restockWindow.loadFile(path.join(__dirname, 'restock.html')).then(() => restockWindow?.webContents.send('restock-account', index)).catch(() => {});
  restockWindow.on('closed', () => { restockWindow = null; });
}

function createAccountView(index) {
  const partition = `persist:pokeidle-account-${index}`;
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      partition,
      preload: path.join(__dirname, 'account-preload.js')
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://pokeidle.io/')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Every account uses a 60 FPS rendering cap in every layout.
  view.webContents.setFrameRate(GAME_VISIBLE_FPS);
  view.webContents.setBackgroundThrottling(true);
  view.webContents.on('dom-ready', () => {
    if (view.webContents.isDestroyed() || view.webContents.getURL() === 'about:blank') return;
    view.webContents.setZoomFactor(globalZoom / 100);
    const st = perfState.get(index); if (st) st.cssKey = null; // página nova: o CSS inserido antes se perdeu
    applyViewPerf(index);
    applyRestockConfig(index);
    pushBarState(index);
  });
  views.set(index, view);
  win.contentView.addChildView(view);
  return view;
}

// Carrega as 4 contas aos poucos (menos pico de CPU na abertura).
function loadGames() {
  for (const [index, view] of views) {
    setTimeout(() => {
      if (view.webContents.isDestroyed() || poweredOff.has(index)) return;
      startedAt.set(index, Date.now());
      view.webContents.loadURL(GAME_URL).catch(() => {});
      pushBarState(index);
    }, (index - 1) * 350);
  }
}

function buildControlLayouts() {
  if (!win) return {};
  const [width, height] = win.getContentSize();
  const gap = 4;
  const layouts = {};
  const active = focusedAccount && visibleAccounts.has(focusedAccount) ? [focusedAccount] : [...visibleAccounts].sort((a, b) => a - b);
  if (!active.length) return layouts;
  let cols = focusedAccount && visibleAccounts.has(focusedAccount) ? 1 : 2;
  if (!focusedAccount && layoutMode === 'vertical') cols = 1;
  if (!focusedAccount && layoutMode === 'row') cols = Math.max(1, active.length);
  const rows = Math.ceil(active.length / cols);
  const usableH = Math.max(180, height - GLOBAL_HEADER);
  const cellW = Math.max(1, Math.floor((width - gap * (cols - 1)) / cols));
  const cellH = Math.max(1, Math.floor((usableH - gap * (rows - 1)) / rows));
  for (let pos = 0; pos < active.length; pos++) {
    const index = active[pos];
    const row = Math.floor(pos / cols);
    const itemsInRow = Math.min(cols, active.length - row * cols);
    const col = pos % cols;
    const rowWidth = itemsInRow * cellW + Math.max(0, itemsInRow - 1) * gap;
    const rowOffset = Math.floor((width - rowWidth) / 2);
    layouts[index] = { x: rowOffset + col * (cellW + gap), y: GLOBAL_HEADER + row * (cellH + gap), width: cellW, height: cellH };
  }
  // Contas escondidas não ocupam mais espaço na grade.
  // O renderer mostra essas contas em uma barra fixa no topo para que
  // continuem sempre acessíveis e possam ser restauradas com um clique.
  return layouts;
}

const HIDDEN_BOUNDS = { x: 0, y: GLOBAL_HEADER, width: 0, height: 0 };
function sameBounds(a, b) { return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height; }
function setViewBounds(key, view, b) { if (!sameBounds(boundsCache.get(key), b)) { view.setBounds(b); boundsCache.set(key, b); } }
function setViewShown(key, view, shown) { if ((shownCache.get(key) !== false) !== shown) { view.setVisible(shown); shownCache.set(key, shown); } }

function applyFrameRates(cells) {
  const shown = Object.keys(cells).length;
  for (const [index, view] of views) {
    if (view.webContents.isDestroyed()) continue;
    const fps = !cells[index] ? GAME_HIDDEN_FPS : (shown === 1 ? GAME_VISIBLE_FPS : GAME_GRID_FPS);
    if (fpsCache.get(index) === fps) continue;
    fpsCache.set(index, fps);
    try { view.webContents.setFrameRate(fps); } catch (_) {}
  }
}

// Um único passo posiciona a barra superior, as barras e os jogos: tudo muda junto, sem
// a janela transparente que ficava por cima e atrasava em relação ao resto.
function layoutViews() {
  if (!win || win.isDestroyed()) return;
  const [width] = win.getContentSize();
  if (toolbarView) setViewBounds('toolbar', toolbarView, { x: 0, y: 0, width: Math.max(1, width), height: GLOBAL_HEADER });
  const cells = buildControlLayouts(); // calculado uma vez só e reaproveitado
  for (const [index, view] of views) {
    if (view.webContents.isDestroyed()) continue;
    const c = cells[index];
    const bar = barViews.get(index);
    if (c) {
      setViewBounds(index, view, { x: c.x, y: c.y + ACCOUNT_BAR, width: c.width, height: Math.max(1, c.height - ACCOUNT_BAR) });
      setViewShown(index, view, true);
      if (bar) { setViewBounds('bar' + index, bar, { x: c.x, y: c.y, width: c.width, height: ACCOUNT_BAR }); setViewShown('bar' + index, bar, true); }
    } else {
      if (bar) setViewShown('bar' + index, bar, false);
      if (perfMode !== 'normal') {
        // Modo economia: a conta fora de vista mantém o tamanho (o jogo não refaz o layout
        // ao voltar) e simplesmente para de ser desenhada.
        setViewShown(index, view, false);
      } else {
        setViewShown(index, view, true);
        setViewBounds(index, view, HIDDEN_BOUNDS);
      }
    }
  }
  applyFrameRates(cells);
  const n = Object.keys(cells).length;
  if (perfMode === 'ultra' && n !== lastShownCount) { lastShownCount = n; for (const i of views.keys()) applyViewPerf(i, n); }
}

// Ao arrastar o tamanho da janela chegam dezenas de eventos por segundo: aplica o primeiro
// na hora (resposta imediata) e agrupa os seguintes (~40 por segundo), sempre fechando no último.
function scheduleLayout() {
  const since = Date.now() - lastLayoutAt;
  if (since >= 24) { lastLayoutAt = Date.now(); layoutViews(); return; }
  if (layoutTimer) return;
  layoutTimer = setTimeout(() => { layoutTimer = null; lastLayoutAt = Date.now(); layoutViews(); }, 24 - since);
}

// ---------- Comunicação com a barra superior e com as barras das contas ----------
function sendToUi(channel, payload) { if (ui && !ui.webContents.isDestroyed()) ui.webContents.send(channel, payload); }
function pushBarState(index) {
  const bar = barViews.get(index), view = views.get(index);
  if (!bar || bar.webContents.isDestroyed()) return;
  bar.webContents.send('bar-state', {
    name: accountNames[index] || `Conta ${index}`,
    zoom: view && !view.webContents.isDestroyed() ? Math.round(view.webContents.getZoomFactor() * 100) : 100,
    focused: focusedAccount === index,
    muted: mutedAccounts.has(index),
    running: !poweredOff.has(index),
    startedAt: startedAt.get(index) || null
  });
}
function pushAllBarStates() { for (const i of barViews.keys()) pushBarState(i); }
function broadcastTheme() {
  sendToUi('theme-updated', currentTheme);
  for (const bar of barViews.values()) {
    if (bar.webContents.isDestroyed()) continue;
    bar.setBackgroundColor(currentTheme.bar);
    bar.webContents.send('theme-updated', currentTheme);
  }
  if (toolbarView) toolbarView.setBackgroundColor(currentTheme.bar);
  sendThemeToTools();
}
// ---------- HUD: desempenho, zoom global, ligar/desligar conta ----------
function shownCount() { return Object.keys(buildControlLayouts()).length; }
function applyViewPerf(index, count = shownCount()) {
  const view = views.get(index);
  if (!view || view.webContents.isDestroyed() || view.webContents.getURL() === 'about:blank') return;
  if (!perfState.has(index)) perfState.set(index, { cssKey: null });
  perf.applyToPage(view.webContents, perfMode, perfState.get(index), count);
}
function applyPerfAll() { const n = shownCount(); lastShownCount = n; for (const i of views.keys()) applyViewPerf(i, n); }
function sendHudState() { sendToUi('hud-state', { perf: perfMode, zoom: globalZoom, fullscreen: !!(win && !win.isDestroyed() && win.isFullScreen()) }); }
function setPerfMode(mode) {
  if (!perf.MODES.includes(mode)) return;
  perfMode = mode; config.perfMode = mode; writeConfig({ perfMode: mode });
  layoutViews();   // eco/ultra: contas fora de vista param de ser desenhadas
  applyPerfAll();
  sendHudState();
}
function setGlobalZoom(pct) {
  globalZoom = Math.min(150, Math.max(30, Math.round(pct / 5) * 5));
  config.zoom = globalZoom; writeConfig({ zoom: globalZoom });
  for (const v of views.values()) if (!v.webContents.isDestroyed()) v.webContents.setZoomFactor(globalZoom / 100);
  pushAllBarStates(); sendHudState();
}
function toggleFullscreen() { if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen()); }
function powerOffAccount(i) {
  extraFeatures?.stopKick(i);
  const v = views.get(i);
  if (!v || v.webContents.isDestroyed()) return;
  poweredOff.add(i); startedAt.delete(i);
  v.webContents.loadURL('about:blank').catch(() => {}); // descarrega o jogo: libera CPU e memória
  setAccountVisible(i, false);
}
function powerOnAccount(i) {
  const v = views.get(i);
  poweredOff.delete(i);
  if (!v || v.webContents.isDestroyed()) return;
  startedAt.set(i, Date.now());
  v.webContents.loadURL(GAME_URL).catch(() => {});
}

function setFocus(index) {
  focusedAccount = index;
  layoutViews();
  sendToUi('focus-account-changed', index);
  pushAllBarStates();
}
function setAccountVisible(i, visible) {
  if (visible && poweredOff.has(i)) powerOnAccount(i);
  if (visible) visibleAccounts.add(i);
  else {
    visibleAccounts.delete(i);
    if (focusedAccount === i) { focusedAccount = null; sendToUi('focus-account-changed', null); }
  }
  layoutViews();
  sendToUi('account-hidden-changed', { index: i, hidden: !visible });
  pushAllBarStates();
}

// Roda DENTRO da página do jogo (Conta 1): lê o painel "Bônus Twitch" e devolve
// os canais que estão "AO VIVO". Precisa que o painel esteja aberto no jogo.
function scrapeLiveTwitchChannels() {
  const ok = n => /^[A-Za-z0-9_]{3,25}$/.test(n);
  const STOP = /^(b[ôo]nus|ativado|ao|vivo|offline|canais|oficiais|live|lives|twitch)$/i;
  const isLive = t => /ao\s*vivo/i.test(t || '');
  const found = new Set();
  // 1) Links twitch.tv dentro de uma linha marcada como ao vivo.
  document.querySelectorAll('a[href*="twitch.tv/"]').forEach(a => {
    const m = a.href.match(/twitch\.tv\/([A-Za-z0-9_]+)/);
    if (!m || !ok(m[1])) return;
    let el = a;
    for (let k = 0; k < 6 && el; k++, el = el.parentElement) {
      if (isLive(el.innerText)) {
        const n = el.matches('a') ? 1 : el.querySelectorAll('a[href*="twitch.tv/"]').length;
        if (n === 1) found.add(m[1]);
        break;
      }
    }
  });
  // 2) Plano B: texto da tela. O nome fica nas linhas logo antes de "AO VIVO"
  //    (ignorando "BÔNUS ATIVADO", número de espectadores e ícones).
  const lines = (document.body.innerText || '').split('\n').map(t => t.trim()).filter(Boolean);
  if (!found.size) {
    lines.forEach((line, i) => {
      if (!isLive(line)) return;
      for (let j = i; j >= 0 && j >= i - 5; j--) {
        const toks = lines[j].split(/[\s·•|]+/).map(t => t.replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, '')).filter(Boolean);
        const cand = toks.find(t => ok(t) && !STOP.test(t) && !/^\d+$/.test(t) && !/^\d+[.,]?\d*k$/i.test(t));
        if (cand) { found.add(cand); break; }
      }
    });
  }
  let debug = '';
  if (!found.size) {
    const idx = lines.findIndex(isLive);
    debug = `painel Bônus Twitch no texto: ${lines.some(l => /b[ôo]nus twitch/i.test(l))}\n"AO VIVO" no texto: ${idx >= 0}\n`;
    if (idx >= 0) debug += 'LINHAS:\n' + lines.slice(Math.max(0, idx - 8), idx + 4).join('\n') + '\n';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = w.nextNode(); node; node = w.nextNode()) {
      if (isLive(node.nodeValue)) {
        let el = node.parentElement;
        for (let k = 0; k < 3 && el && el.parentElement; k++) el = el.parentElement;
        debug += 'HTML:\n' + (el ? el.outerHTML.slice(0, 2500) : '');
        break;
      }
    }
  }
  return { names: [...found], debug };
}

async function openLiveTwitchChannels() {
  const view = views.get(1);
  const names = new Set();
  let debug = '';
  let frames = 0;
  try {
    if (view && !view.webContents.isDestroyed()) {
      // Procura na página principal e também dentro de eventuais iframes.
      const list = view.webContents.mainFrame.framesInSubtree;
      frames = list.length;
      for (const frame of list) {
        try {
          const r = await frame.executeJavaScript(`(${scrapeLiveTwitchChannels.toString()})()`);
          (r.names || []).forEach(n => { if (/^[A-Za-z0-9_]{3,25}$/.test(n)) names.add(n); });
          if (r.debug) debug += `--- frame ${frame.url}\n${r.debug}\n`;
        } catch (_) {}
      }
    }
  } catch (_) {}
  if (!names.size) {
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Lives da Twitch',
      message: 'Não encontrei nenhuma live oficial no ar.',
      detail: 'Abra o painel "Bônus Twitch" dentro do jogo, na Conta 1 (deixe a lista de canais visível), e clique em Lives de novo.\n\nSe o painel já está aberto, clique em "Copiar diagnóstico" e cole a mensagem para quem está ajustando o app.',
      buttons: ['OK', 'Copiar diagnóstico'],
      defaultId: 0
    });
    if (r.response === 1) clipboard.writeText(`app ${app.getVersion()} | frames: ${frames}\n${debug || '(sem dados)'}`);
    return;
  }
  const list = [...names];
  if (TWITCH_OPEN_MODE === 'multi' && list.length > 1) {
    // Uma aba só, com todas as lives lado a lado.
    shell.openExternal(`https://www.multitwitch.tv/${list.join('/')}`);
    return;
  }
  // Uma aba por canal, abertas aos poucos para o navegador não bloquear.
  list.forEach((name, i) => setTimeout(() => shell.openExternal(`https://www.twitch.tv/${name}`), i * 500));
}

function sendZoom(index) { pushBarState(index); }

function positionThemeWindow() {
  if (!themeWindow || themeWindow.isDestroyed() || !win || win.isDestroyed()) return;
  const [wx, wy] = win.getPosition();
  const [ww] = win.getSize();
  const [tw] = themeWindow.getSize();
  const x = Math.max(wx + 8, wx + ww - tw - 8);
  const y = wy + 78;
  themeWindow.setPosition(Math.round(x), Math.round(y), false);
}

function openTwitchWindow() {
  if (twitchWindow && !twitchWindow.isDestroyed()) {
    if (twitchWindow.isVisible() && twitchWindow.isFocused()) twitchWindow.hide();
    else { twitchWindow.show(); twitchWindow.focus(); twitchWindow.webContents.send('theme-state', currentTheme); }
    return;
  }
  twitchWindow = new BrowserWindow({
    parent: win,
    show: false,
    width: 540,
    height: 860,
    minWidth: 480,
    minHeight: 560,
    title: 'Twitch · Chat',
    autoHideMenuBar: true,
    backgroundColor: currentTheme.bar,
    webPreferences: { preload: path.join(__dirname, 'twitch-preload.js'), contextIsolation: true, sandbox: true }
  });
  twitchWindow.removeMenu();
  twitchWindow.loadFile(path.join(__dirname, 'twitch.html'));
  twitchWindow.once('ready-to-show', () => { twitchWindow.show(); twitchWindow.webContents.send('theme-state', currentTheme); });
  twitchWindow.on('closed', () => { twitchWindow = null; });
}
const LIVE_AD_DOMAINS = [
  'googlesyndication.com','doubleclick.net','googleadservices.com','adtrafficquality.google',
  'imasdk.googleapis.com','openx.net','openxcdn.net','criteo.com','criteo.net','dnacdn.net',
  'creativecdn.com','id5-sync.com','amazon-adsystem.com','googletagmanager.com','google-analytics.com',
  'tiktok.com','tiktokw.us','facebook.net','analytics.yahoo.com','quora.com','litix.io','datazoom.io',
  'datadoghq-browser-agent.com','cloudflareinsights.com','scorecardresearch.com'
];
const filteredLiveSessions = new WeakSet();
function applyLiveAdBlock(liveSession) {
  if (filteredLiveSessions.has(liveSession)) return;
  filteredLiveSessions.add(liveSession);
  liveSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    let host = '';
    try { host = new URL(details.url).hostname.toLowerCase(); } catch (_) {}
    const blocked = LIVE_AD_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
    callback({ cancel: blocked });
  });
}

const LOWEST_TWITCH_QUALITY_SCRIPT = `(() => {
  if (window.__pokeidleLowestQuality) return;
  window.__pokeidleLowestQuality = true;
  const choose = () => {
    try {
      const players = [window.Twitch?.Player, window.player];
      const p = players.find(x => x && typeof x.getQualities === 'function' && typeof x.setQuality === 'function');
      if (!p) return;
      const qs = p.getQualities() || [];
      const usable = qs.filter(q => q && q.group !== 'audio_only' && q.name && !/audio/i.test(q.name));
      if (!usable.length) return;
      const quality = usable[usable.length - 1];
      if (quality && quality.name) p.setQuality(quality.name);
    } catch (_) {}
  };
  choose();
  setInterval(choose, 8000);
})()`;

function openTwitchVideo(slot) {
  const i = Number(slot);
  if (!Number.isInteger(i) || i < 1 || i > 4) return;
  const old = twitchVideoWindows.get(i);
  if (old && !old.isDestroyed()) {
    if (old.isMinimized()) old.restore();
    old.show(); old.focus();
    return;
  }
  const partition = `persist:twitch-watch-account-${i}`;
  const liveSession = session.fromPartition(partition);
  applyLiveAdBlock(liveSession);
  const player = new BrowserWindow({
    parent: win,
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: `Twitch · Vídeo ativo · Conta ${i}`,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e10',
    webPreferences: {
      session: liveSession,
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  player.removeMenu();
  twitchVideoWindows.set(i, player);
  player.on('closed', () => { if (twitchVideoWindows.get(i) === player) twitchVideoWindows.delete(i); });
  // Cada conta tem cookies próprios. O usuário entra na Twitch com a conta correspondente
  // e inicia uma live; a janela fica aberta para manter o player ativo.
  player.webContents.on('dom-ready', () => {
    if (!player.isDestroyed() && !player.webContents.isDestroyed())
      player.webContents.executeJavaScript(LOWEST_TWITCH_QUALITY_SCRIPT, true).catch(() => {});
  });
  player.loadURL('https://www.twitch.tv/directory/following/live').catch(() => {});
  player.show();
}

function sendThemeToTools() {
  if (twitchWindow && !twitchWindow.isDestroyed()) {
    twitchWindow.setBackgroundColor(currentTheme.bar);
    twitchWindow.webContents.send('theme-state', currentTheme);
  }
}

function openThemeWindow() {
  if (themeWindow && !themeWindow.isDestroyed()) {
    if (themeWindow.isVisible()) themeWindow.hide();
    else { positionThemeWindow(); themeWindow.show(); themeWindow.focus(); themeWindow.webContents.send('theme-state', currentTheme); }
    return;
  }
  themeWindow = new (require('electron').BrowserWindow)({
    parent: win,
    modal: false,
    show: false,
    frame: false,
    resizable: false,
    width: 440,
    height: 205,
    title: 'Cores',
    backgroundColor: currentTheme.bar,
    webPreferences: {
      preload: path.join(__dirname, 'theme-preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  });
  themeWindow.loadFile(path.join(__dirname, 'theme.html'));
  themeWindow.once('ready-to-show', () => {
    positionThemeWindow();
    themeWindow.show();
    themeWindow.webContents.send('theme-state', currentTheme);
  });
  themeWindow.on('closed', () => { themeWindow = null; });
  win.on('move', positionThemeWindow);
  win.on('resize', positionThemeWindow);
}

async function loadRestockExtension() {
  const extensionPath = app.isPackaged ? path.join(process.resourcesPath, 'restock-extension') : path.join(__dirname, 'restock-extension');
  for (let i = 1; i <= 4; i++) {
    const ses = session.fromPartition(`persist:pokeidle-account-${i}`);
    try {
      const api = ses.extensions || ses;
      if (typeof api.loadExtension !== 'function') throw new Error('API de extensões indisponível nesta versão do Electron.');
      await api.loadExtension(extensionPath, { allowFileAccess: true });
      logLine(`recompra script carregado na Conta ${i}`);
    } catch (error) { logLine(`falha ao carregar script de recompra na Conta ${i}: ${error.message}`); }
  }
}

function createWindow() {
  win = new BaseWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 650,
    title: `Night Deck v${app.getVersion()}`
  });
  // Use the same dark background behind the embedded pages to prevent white gaps.
  win.setBackgroundColor(currentTheme.bg);

  for (let i = 1; i <= 4; i++) createAccountView(i);

  // Barra superior e barras de cada conta são telas nativas da própria janela (antes era uma
  // segunda janela transparente por cima, que ficava para trás ao mover ou redimensionar).
  toolbarView = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false } });
  toolbarView.setBackgroundColor(currentTheme.bar);
  ui = toolbarView;
  win.contentView.addChildView(toolbarView);
  toolbarView.webContents.loadFile(path.join(__dirname, 'index.html'));

  for (let i = 1; i <= 4; i++) {
    const bar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'bar-preload.js'), contextIsolation: true, sandbox: true, spellcheck: false } });
    bar.setBackgroundColor(currentTheme.bar);
    bar.setVisible(false);
    shownCache.set('bar' + i, false);
    barViews.set(i, bar);
    win.contentView.addChildView(bar);
    bar.webContents.loadFile(path.join(__dirname, 'bar.html'), { query: { i: String(i) } });
    bar.webContents.once('did-finish-load', () => { bar.webContents.send('theme-updated', currentTheme); pushBarState(i); });
  }
  extraFeatures = createExtraFeatures({ app, getView: i => views.get(i), getWin: () => win, readConfig, writeConfig, notify: message => dialog.showMessageBox(win, { type: 'info', title: 'PokeIdle Multiscreen', message: String(message) }) });
  storageImporter = createStorageImporter({ userData: app.getPath('userData'), partitions: [1, 2, 3, 4].map(i => `persist:pokeidle-account-${i}`), session, dialog, getParent: () => win, notify: message => logLine(message) });
  extensions = createExtensionManager({
    userData: app.getPath('userData'),
    partitions: [1, 2, 3, 4].map(i => `persist:pokeidle-account-${i}`),
    session, BrowserWindow, dialog, shell,
    getParent: () => win,
    getAccountIndex: () => focusedAccount || 1,
    storageImporter,
    notify: (level, text) => logLine(`extensoes ${level}: ${text}`)
  });
  // As extensões entram nas sessões ANTES do jogo carregar, para os scripts delas pegarem a página desde o início.
  extensions.init().catch(() => {}).finally(async () => { await loadRestockExtension(); loadGames(); });
  layoutViews();
  win.on('enter-full-screen', () => { scheduleLayout(); sendHudState(); });
  win.on('leave-full-screen', () => { scheduleLayout(); sendHudState(); });
  win.on('resize', scheduleLayout);
  win.on('maximize', scheduleLayout);
  win.on('unmaximize', scheduleLayout);
  win.on('restore', scheduleLayout);
  win.on('resized', layoutViews);
  win.on('closed', () => { twitchChat?.stop(); extraFeatures?.dispose(); if (restockWindow && !restockWindow.isDestroyed()) restockWindow.close(); });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Contas', submenu: [
      { label: 'Recarregar todas', click: () => [...views.keys()].forEach(index => { void reloadAccountSafely(index); }) },
      { label: 'Abrir site externo', click: () => shell.openExternal(GAME_URL) }
    ]},
    { label: 'Layout', submenu: [
      { label: 'Grade 2 × 2', click: () => setLayout('grid') },
      { label: 'Vertical 1 × 4', click: () => setLayout('row') },
      { type: 'separator' },
      { label: 'Tela cheia', accelerator: 'F11', click: toggleFullscreen },
    ]},
    { label: 'Atualizações', submenu: [
      { label: 'Verificar atualizações / abrir downloads', click: () => shell.openExternal('https://github.com/iNightii/Night-deck/releases') }
    ]},
    { label: 'Ajuda', submenu: [
      { label: 'Modo compatibilidade (sem aceleração de GPU)', type: 'checkbox', checked: !!config.disableGpu, click: async item => {
        const r = await dialog.showMessageBox(win, {
          type: 'question', buttons: ['Reiniciar agora', 'Cancelar'], defaultId: 0, cancelId: 1,
          title: 'Modo compatibilidade',
          message: item.checked ? 'Desligar a aceleração de GPU do app?' : 'Voltar a usar a GPU?',
          detail: 'O app será reiniciado. Sem GPU ele usa mais processador, mas evita que o driver de vídeo trave por causa dele.'
        });
        if (r.response !== 0) { item.checked = !item.checked; return; }
        writeConfig({ disableGpu: item.checked });
        app.relaunch(); app.exit(0);
      } },
      { label: 'Diagnóstico de GPU', click: () => { showGpuDiagnostics(); } },
      { label: 'Abrir pasta de logs', click: () => { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); shell.openPath(path.dirname(LOG_PATH)); } },
      { type: 'separator' },
      { label: 'Sobre', click: () => { dialog.showMessageBox(win, { type: 'info', title: 'Sobre', message: 'PokeIdle Multiscreen', detail: `Versão ${app.getVersion()}\nQuatro sessões independentes do PokeIdle.` }); } }
    ]}
  ]));

  // Recarga robusta: interrompe navegação travada e inicia novamente o jogo,
  // preservando a sessão persistente individual de cada conta.
  ipcMain.on('reload-account', (_event, index) => {
    const accountIndex = Number(index);
    if (!Number.isInteger(accountIndex) || accountIndex < 1 || accountIndex > 4) return;
    void reloadAccountSafely(accountIndex);
  });
  ipcMain.on('reload-all', () => {
    for (const index of views.keys()) void reloadAccountSafely(index);
  });
  ipcMain.handle('restock-get', async (_event, accountIndex) => {
    const i = Number(accountIndex); if (!Number.isInteger(i) || i < 1 || i > 4) throw new Error('Conta inválida.');
    return restockFor(i);
  });
  ipcMain.handle('restock-save', async (_event, accountIndex, value) => {
    const i = Number(accountIndex); if (!Number.isInteger(i) || i < 1 || i > 4) return { ok: false, message: 'Conta inválida.' };
    const all = Array.isArray(readConfig().restock) ? readConfig().restock.slice(0, 4) : [];
    while (all.length < 4) all.push(restockDefaults());
    all[i - 1] = normalizedRestock(value);
    config.restock = all; writeConfig({ restock: all }); applyRestockConfig(i);
    return { ok: true };
  });
  ipcMain.handle('kick-redeem-get', async (_event, accountIndex) => { const i = Number(accountIndex); if (!Number.isInteger(i) || i < 1 || i > 4) return 'off'; const a = readConfig().kickRedeem; const v = Array.isArray(a) ? a[i - 1] : null; return typeof v === 'string' ? v : v?.reward || 'off'; });
  ipcMain.handle('kick-redeem-set', async (_event, accountIndex, reward) => { const i = Number(accountIndex); if (!Number.isInteger(i) || i < 1 || i > 4) return null; return extraFeatures.setKickRedeem(i, reward === 'off' ? null : reward); });
  ipcMain.handle('restock-summary', async (_event, accountIndex) => {
    const i = Number(accountIndex); if (!Number.isInteger(i) || i < 1 || i > 4) return null;
    const view = views.get(i); if (!view || view.webContents.isDestroyed()) return null;
    try { return await view.webContents.executeJavaScript('window.__deckRecompra ? window.__deckRecompra.summary() : null', true); } catch (_) { return null; }
  });
  ipcMain.on('echo-toggle', () => {
    echoEnabled = !echoEnabled;
    config.echoEnabled = echoEnabled;
    writeConfig({ echoEnabled });
    if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('echo-state', echoEnabled);
  });
  ipcMain.on('echo-get-state', () => {
    if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('echo-state', echoEnabled);
  });
  // Uso agregado de RAM dos processos do Electron (KB -> MB), atualizado sem consultar cada página.
  const ramTimer = setInterval(() => {
    if (!ui || ui.webContents.isDestroyed()) return;
    try {
      const totalMb = Math.round(app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0) / 1024);
      ui.webContents.send('resource-state', { ramMb: totalMb });
    } catch (_) {}
  }, 5000);
  win.once('closed', () => clearInterval(ramTimer));
  const validAccount = i => Number.isInteger(i) && i >= 1 && i <= 4;

  // ---------- Presença no chat da Twitch ----------
  twitchChat = createTwitchChat({
    userData: app.getPath('userData'),
    notify: (type, payload) => {
      if (twitchWindow && !twitchWindow.isDestroyed()) twitchWindow.webContents.send(type === 'log' ? 'twitch-log' : 'twitch-state', payload);
    }
  });
  twitchChat.start();
  ipcMain.handle('twitch-get', () => ({ state: twitchChat.snapshot(), logs: twitchChat.logs() }));
  ipcMain.on('twitch-open-video', (_, slot) => openTwitchVideo(slot));
  ipcMain.on('twitch-set', (_, patch) => twitchChat.setConfig(sanitizeTwitch(patch)));
  ipcMain.handle('twitch-connect', (_, slot) => validAccount(slot) ? twitchChat.connect(slot) : { ok: false, message: 'Conta inválida.' });
  ipcMain.handle('twitch-disconnect', (_, slot) => validAccount(slot) ? twitchChat.disconnect(slot) : { ok: false });
  ipcMain.on('twitch-open-link', (_, slot) => { if (validAccount(slot)) twitchChat.openLink(slot); });
  ipcMain.handle('twitch-cancel', (_, slot) => validAccount(slot) ? twitchChat.cancel(slot) : { ok: false });
  ipcMain.on('twitch-open-console', () => shell.openExternal('https://dev.twitch.tv/console/apps'));
  ipcMain.on('open-twitch-chat', openTwitchWindow);
  ipcMain.on('open-external', () => shell.openExternal(GAME_URL));
  ipcMain.on('open-twitch-lives', () => { openLiveTwitchChannels(); });
  ipcMain.on('open-hunting-guide', () => shell.openExternal('https://pokeidle-gg.pages.dev/#hunt'));
  ipcMain.on('toggle-theme-window', openThemeWindow);
  ipcMain.on('close-theme-window', () => { if (themeWindow && !themeWindow.isDestroyed()) themeWindow.hide(); });
  ipcMain.on('theme-sync', (_, theme) => {
    if (!theme || typeof theme !== 'object') return;
    currentTheme = { ...currentTheme, ...theme };
    if (/^#[0-9a-fA-F]{6}$/.test(currentTheme.bg)) win.setBackgroundColor(currentTheme.bg);
    if (themeWindow && !themeWindow.isDestroyed()) themeWindow.webContents.send('theme-state', currentTheme);
    broadcastTheme();
  });
  ipcMain.on('theme-update', (_, theme) => {
    if (!theme || typeof theme !== 'object') return;
    currentTheme = { ...currentTheme, ...theme };
    if (/^#[0-9a-fA-F]{6}$/.test(currentTheme.bg)) win.setBackgroundColor(currentTheme.bg);
    broadcastTheme();
    if (themeWindow && !themeWindow.isDestroyed()) themeWindow.setBackgroundColor(currentTheme.bar);
  });
  ipcMain.on('theme-reset', () => {
    currentTheme = { bg: '#0b1120', bar: '#111827', card: '#172033', button: '#1e293b', accent: '#7c3aed', text: '#f8fafc' };
    win.setBackgroundColor(currentTheme.bg);
    broadcastTheme();
    if (themeWindow && !themeWindow.isDestroyed()) { themeWindow.setBackgroundColor(currentTheme.bar); themeWindow.webContents.send('theme-state', currentTheme); }
  });
  ipcMain.on('zoom-account', (_, { index, delta }) => {
    const i = Number(index);
    const v = views.get(i);
    if (!v) return;
    const next = Math.round(Math.min(1.5, Math.max(0.3, v.webContents.getZoomFactor() + Number(delta))) * 100) / 100;
    v.webContents.setZoomFactor(next);
    sendZoom(i);
  });
  ipcMain.on('get-zoom', (_, index) => sendZoom(Number(index)));
  ipcMain.on('toggle-account', (_, { index, visible } = {}) => {
    const i = Number(index);
    if (!views.has(i)) return;
    setAccountVisible(i, !!visible);
  });
  // Nomes e contas escondidas guardados pela barra superior na sessão anterior.
  ipcMain.on('init-ui-state', (_, st) => {
    const nm = st && typeof st.names === 'object' && st.names ? st.names : {};
    const hid = st && typeof st.hidden === 'object' && st.hidden ? st.hidden : {};
    for (let i = 1; i <= 4; i++) {
      if (typeof nm[i] === 'string') accountNames[i] = nm[i].slice(0, 40);
      if (hid[i] === true) { visibleAccounts.delete(i); if (focusedAccount === i) focusedAccount = null; }
    }
    // Quem usava o antigo botão Economia continua em Economia.
    if (config.perfMode === undefined && st && st.legacyEco === true) setPerfMode('eco');
    layoutViews();
    pushAllBarStates();
    sendHudState();
  });
  // Cliques nas barras de cada conta (só aceita a barra da própria conta).
  function runBarAction(i, action) {
    switch (action) {
      case 'focus': setFocus(focusedAccount === i ? null : i); break;
      case 'reload': void reloadAccountSafely(i); break;
      case 'zoom-in':
      case 'zoom-out': {
        const v = views.get(i);
        if (!v) break;
        const step = action === 'zoom-in' ? 0.1 : -0.1;
        v.webContents.setZoomFactor(Math.round(Math.min(1.5, Math.max(0.3, v.webContents.getZoomFactor() + step)) * 100) / 100);
        sendZoom(i);
        break;
      }
      case 'hide': setAccountVisible(i, false); break;
      case 'power': powerOffAccount(i); break;
      case 'restock': openRestockWindow(i); break;
      case 'topidle': void (async () => { try { const state = await extraFeatures.topIdleState(i); const detail = state.loggedIn ? `${state.canVote ? 'Voto liberado.' : 'Voto ainda em cooldown.'}${state.next ? `\nPróximo voto: ${state.next}` : ''}${state.player ? `\nUsuário: ${state.player}` : ''}` : state.message; const r = await dialog.showMessageBox(win, { type: 'info', title: `TopIdle — Conta ${i}`, message: detail, buttons: state.loggedIn ? ['Abrir página de voto', 'Fechar'] : ['Abrir TopIdle para entrar', 'Fechar'], defaultId: 0, cancelId: 1 }); if (r.response === 0) await extraFeatures.openTopIdle(i); } catch (e) { dialog.showErrorBox('TopIdle', `Não foi possível consultar o voto: ${e.message}`); } })(); break;
      case 'kick': void extraFeatures.kickOpenRecommended(i).catch(e => dialog.showErrorBox('Kick', `Não foi possível abrir as lives: ${e.message}`)); break;
      case 'kick-stop': extraFeatures.stopKick(i); break;
      case 'sniper': void (async () => { try { const current = await extraFeatures.getRotomEnabled(i); const next = !current; const ok = await extraFeatures.setRotomEnabled(i, next); if (!ok) throw new Error('Não foi possível salvar a preferência no armazenamento da extensão.'); await dialog.showMessageBox(win, { type: 'info', title: `Rotom Sniper — Conta ${i}`, message: `Rotom Sniper ${next ? 'ativado' : 'desativado'} nesta conta.` }); } catch (e) { dialog.showErrorBox('Rotom Sniper', e.message); } })(); break;
      case 'mute': {
        const v = views.get(i);
        if (!v || v.webContents.isDestroyed()) break;
        const mute = !mutedAccounts.has(i);
        if (mute) mutedAccounts.add(i); else mutedAccounts.delete(i);
        v.webContents.setAudioMuted(mute);
        pushBarState(i);
        break;
      }
    }
  }
  ipcMain.on('bar-action', (event, { index, action } = {}) => {
    const i = Number(index);
    if (!barViews.get(i) || event.sender !== barViews.get(i).webContents) return;
    runBarAction(i, action);
  });
  ipcMain.on('bar-menu', (event, { index, name, x, y } = {}) => {
    const i = Number(index);
    if (!barViews.get(i) || event.sender !== barViews.get(i).webContents) return;
    const items = {
      extras: [['Kick — abrir live e chat', 'kick'], ['Kick — parar lives', 'kick-stop'], ['TopIdle — consultar voto', 'topidle'], ['Rotom Sniper — alternar', 'sniper']],
      account: [['Recarregar conta', 'reload'], ['Expandir / restaurar', 'focus'], ['Ocultar conta', 'hide'], ['Desligar conta', 'power']]
    };
    if (!Object.prototype.hasOwnProperty.call(items, name)) return;
    // A posição do botão é relativa à barra da conta, não à janela principal.
    const bounds = barViews.get(i).getBounds();
    const menuX = bounds.x + (Number(x) || 0);
    const menuY = bounds.y + (Number(y) || 0);
    Menu.buildFromTemplate(items[name].map(([label, action]) => ({ label, click: () => runBarAction(i, action) })))
      .popup({ window: win, x: Math.max(0, Math.round(menuX)), y: Math.max(0, Math.round(menuY)) });
  });
  ipcMain.on('hud-zoom', (_, delta) => { const d = Number(delta); if (Number.isFinite(d)) setGlobalZoom(d === 0 ? 100 : globalZoom + Math.max(-20, Math.min(20, d))); });
  ipcMain.on('hud-fullscreen', toggleFullscreen);
  ipcMain.on('check-updates', () => void checkNightDeckUpdates());
  ipcMain.on('open-updates-page', () => void shell.openExternal('https://github.com/iNightii/Night-deck/releases'));

  ipcMain.on('hud-menu', (_, { name, x, y } = {}) => {
    let template = [];
    if (name === 'perf') {
      template = [
        { label: 'Normal', type: 'radio', checked: perfMode === 'normal', click: () => setPerfMode('normal') },
        { label: 'Economia — contas fora de vista param de ser desenhadas', type: 'radio', checked: perfMode === 'eco', click: () => setPerfMode('eco') },
        { label: 'Ultra — economia + sem animações e visual a poucos quadros/s', type: 'radio', checked: perfMode === 'ultra', click: () => setPerfMode('ultra') }
      ];
    } else if (name === 'ext') template = extensions.menuTemplate();
    else if (name === 'extras') template = [
      { label: 'TopIdle — consultar voto da conta principal', click: async () => { const i = focusedAccount || 1; try { const st = await extraFeatures.topIdleState(i); const r = await dialog.showMessageBox(win, { type: 'info', title: `TopIdle — Conta ${i}`, message: st.loggedIn ? `${st.canVote ? 'Voto liberado.' : 'Voto em cooldown.'}${st.next ? `\nPróximo: ${st.next}` : ''}` : st.message, buttons: ['Abrir TopIdle', 'Fechar'], defaultId: 0, cancelId: 1 }); if (r.response === 0) await extraFeatures.openTopIdle(i); } catch (e) { dialog.showErrorBox('TopIdle', e.message); } } },
      { label: 'Kick — abrir lives oficiais na conta principal', click: () => void extraFeatures.kickOpenRecommended(focusedAccount || 1).catch(e => dialog.showErrorBox('Kick', e.message)) },
      { label: 'Kick — parar monitoramento e fechar lives da conta principal', click: () => extraFeatures.stopKick(focusedAccount || 1) },
      { label: 'Rotom Sniper — alternar em todas as contas', click: async () => { const r = await dialog.showMessageBox(win, { type: 'question', title: 'Rotom Sniper', message: 'Deseja alternar o estado do Rotom Sniper em todas as contas? A extensão precisa estar instalada e carregada em cada uma.', buttons: ['Alternar todas', 'Cancelar'], defaultId: 1, cancelId: 1 }); if (r.response === 0) { for (let i = 1; i <= 4; i++) { try { const current = await extraFeatures.getRotomEnabled(i); await extraFeatures.setRotomEnabled(i, !current); } catch (e) { logLine(`Rotom Sniper Conta ${i}: ${e.message}`); } } } } },
      { label: 'Configurar canais Kick…', click: async () => { const current = Array.isArray(config.kickChannels) ? config.kickChannels.join(', ') : 'biscoitao, yetz, surskity'; const r = await dialog.showMessageBox(win, { type: 'info', title: 'Canais da Kick', message: `Edite config.json em ${app.getPath('userData')} e defina kickChannels como uma lista de nomes.\n\nAtualmente: ${current}\n\nA quantidade por conta é kickSlots (0 a 10; padrão 2).`, buttons: ['Abrir pasta de configuração', 'OK'], defaultId: 0 }); if (r.response === 0) shell.openPath(app.getPath('userData')); } },
    ];
    else if (name === 'quick-tools') template = [
      { label: 'Abrir PokeIdle no navegador', click: () => shell.openExternal(GAME_URL) },
      { label: 'Abrir Twitch', click: openTwitchWindow },
      { label: 'Onde caçar', click: () => shell.openExternal('https://pokeidle-gg.pages.dev/#hunt') },
      { label: 'Echo — sincronizar cliques', submenu: [
        { label: echoEnabled ? 'Desativar Echo' : 'Ativar Echo', click: () => { echoEnabled = !echoEnabled; config.echoEnabled = echoEnabled; writeConfig({ echoEnabled }); if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('echo-state', echoEnabled); } }
      ] }
    ];
    else if (name === 'quick-account') template = [
      { label: 'Recarregar todas as contas', click: () => { for (let i = 1; i <= 4; i++) void reloadAccountSafely(i); } },
      { label: 'Tela cheia', click: toggleFullscreen },
      { label: 'Restaurar layout de todas as contas', click: () => setFocus(null) }
    ];
    else if (name === 'echo') template = [{ label: echoEnabled ? 'Desativar Echo (sincronizar cliques)' : 'Ativar Echo (sincronizar cliques)', click: () => { echoEnabled = !echoEnabled; config.echoEnabled = echoEnabled; writeConfig({ echoEnabled }); if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('echo-state', echoEnabled); } }, { label: 'Como funciona: replica cliques em controles equivalentes nas outras contas; não copia texto digitado.', enabled: false }];
    else return;
    Menu.buildFromTemplate(template).popup({ window: win, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) });
  });
  ipcMain.on('set-layout', (_, mode) => setLayout(mode));
  ipcMain.on('focus-account', (_, index) => {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 1 || i > 4 || !views.has(i)) return;
    if (!visibleAccounts.has(i)) { visibleAccounts.add(i); sendToUi('account-hidden-changed', { index: i, hidden: false }); }
    setFocus(i);
  });
  ipcMain.on('clear-account-focus', () => setFocus(null));
}

function setLayout(mode) {
  if (!['grid', 'vertical', 'row'].includes(mode)) return;
  layoutMode = mode;
  focusedAccount = null; // trocar o layout sempre sai do modo "tela principal"
  layoutViews();
  sendToUi('layout-changed', { mode });
  sendToUi('focus-account-changed', null);
  pushAllBarStates();
}

function runPeriodicMemoryCleanup() {
  const before = app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0) / 1024;
  let mainGc = false;
  try { if (typeof global.gc === 'function') { global.gc(); mainGc = true; } } catch (_) {}
  const jobs = webContents.getAllWebContents().filter(wc => !wc.isDestroyed()).map(wc =>
    wc.executeJavaScript("(() => { try { if (typeof gc === 'function') { gc(); return true; } } catch (_) {} return false; })()", true).catch(() => false)
  );
  Promise.allSettled(jobs).then(() => setTimeout(() => {
    try {
      const after = app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory?.workingSetSize || 0), 0) / 1024;
      logLine(`limpeza periódica de memória | antes=${Math.round(before)}MB depois=${Math.round(after)}MB | gcPrincipal=${mainGc}`);
    } catch (_) {}
  }, 1500));
}

app.whenReady().then(() => {
  logLine(`iniciado | gpuDesligada=${!!config.disableGpu}`);
  const memoryCleanupTimer = setInterval(runPeriodicMemoryCleanup, 10 * 60 * 1000);
  app.once('before-quit', () => clearInterval(memoryCleanupTimer));
  // Aplicar imports agendados antes de criar qualquer janela/sessão de conta.
  try {
    const results = applyPendingStorageImports({ userData: app.getPath('userData'), session, partitions: [1, 2, 3, 4].map(i => `persist:pokeidle-account-${i}`), log: logLine });
    for (const result of results) logLine(result);
  } catch (e) { logLine(`Falha ao aplicar imports de extensão: ${e.stack || e}`); }
  createWindow();
  setTimeout(() => { void checkNightDeckUpdates(); }, 30000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win) createWindow(); });
