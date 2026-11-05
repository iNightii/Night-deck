'use strict';
const { BrowserWindow, session, shell } = require('electron');
const path = require('path');

const TOPIDLE = 'https://topidle.com';
const ROTOM_ID = 'olccbpdjdkbfgondiiaicmlifhbcggmk';
const DEFAULT_KICK = ['biscoitao', 'yetz', 'surskity'];
const validChannel = value => /^[a-z0-9_]{2,30}$/i.test(String(value || ''));
const accountPartition = i => `persist:pokeidle-account-${i}`;

function createExtraFeatures({ app, getView, getWin, notify, readConfig, writeConfig }) {
  const voteWindows = new Map();
  const kickWindows = new Map();
  const kickState = new Map();
  const kickMonitors = new Map();
  const kickRedeemTimers = new Map();
  const kickRedeemState = new Map();
  const kickRedeemStopped = new Set();
  const kickRedeemNoLogin = new Set();
  const adDomains = [
    'googlesyndication.com','doubleclick.net','googleadservices.com','adtrafficquality.google',
    'openx.net','openxcdn.net','criteo.com','criteo.net','dnacdn.net','creativecdn.com',
    'id5-sync.com','amazon-adsystem.com','googletagmanager.com','google-analytics.com',
    'tiktok.com','tiktokw.us','facebook.net','analytics.yahoo.com','litix.io','datazoom.io',
    'datadoghq-browser-agent.com','cloudflareinsights.com','scorecardresearch.com'
  ];
  const installedFilters = new Set();
  const topIdleWatchers = new Set();
  function applyKickFilters(i) {
    const ses = session.fromPartition(accountPartition(i));
    if (installedFilters.has(ses)) return;
    installedFilters.add(ses);
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      let host = '';
      try { host = new URL(details.url).hostname.toLowerCase(); } catch (_) {}
      const blocked = adDomains.some(d => host === d || host.endsWith('.' + d));
      callback({ cancel: blocked });
    });
  }
  async function getKickLive(channel) {
    try {
      const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000)
      });
      if (response.status === 404) return false;
      if (!response.ok) return null;
      const json = await response.json();
      return !!json.livestream && json.livestream.is_live !== false;
    } catch (_) { return null; }
  }
  async function openKick(i, channel) {
    if (!validChannel(channel)) return { ok: false, message: 'Canal inválido.' };
    const key = `${i}:${channel.toLowerCase()}`;
    const old = kickWindows.get(key);
    if (old && !old.isDestroyed()) { old.show(); old.focus(); return { ok: true, reused: true }; }
    applyKickFilters(i);
    const ses = session.fromPartition(accountPartition(i));
    const w = new BrowserWindow({
      width: 1180, height: 760, minWidth: 760, minHeight: 520, title: `Kick — ${channel} (player + chat)`,
      webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    w.setMenuBarVisibility(false);
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(?:www\.)?kick\.com\//i.test(url)) return { action: 'allow' };
      shell.openExternal(url); return { action: 'deny' };
    });
    kickWindows.set(key, w);
    w.on('closed', () => kickWindows.delete(key));
    // Página completa da Kick: mantém player, chat e controles de login no mesmo contexto persistente da conta.
    await w.loadURL(`https://kick.com/${encodeURIComponent(channel)}`);
    return { ok: true };
  }
  async function syncKickAccount(i, announce = false) {
    const cfg = readConfig();
    const channels = Array.isArray(cfg.kickChannels) ? cfg.kickChannels.filter(validChannel) : DEFAULT_KICK;
    const slotsRaw = Number(cfg.kickSlots);
    const slots = Number.isFinite(slotsRaw) ? Math.max(0, Math.min(10, Math.floor(slotsRaw))) : 2;
    const states = await Promise.all(channels.map(async c => [c, await getKickLive(c)]));
    const live = new Map(states);
    kickState.set(i, Object.fromEntries(states));
    const picked = channels.filter(c => live.get(c) !== false).slice(0, slots);
    for (const [key, w] of [...kickWindows]) {
      if (!key.startsWith(`${i}:`)) continue;
      const channel = key.slice(String(i).length + 1);
      if (!picked.some(c => c.toLowerCase() === channel) && w && !w.isDestroyed()) w.close();
    }
    for (const channel of picked) await openKick(i, channel);
    if (announce && !picked.length) notify('Nenhum canal Kick da lista está ao vivo no momento.');
    return { ok: true, channels: picked, states: Object.fromEntries(states) };
  }
  function rewardPattern(reward) {
    if (reward === 'capture') return /captur/i;
    if (reward === 'lure') return /lure|shiny/i;
    return /\bxp\b/i;
  }
  function makeTransactionId() {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let time = Date.now(), id = '';
    for (let n = 0; n < 10; n++) { id = alphabet[time % 32] + id; time = Math.floor(time / 32); }
    for (let n = 0; n < 16; n++) id += alphabet[Math.floor(Math.random() * 32)];
    return id;
  }
  async function redeemKickAccount(i) {
    const cfg = readConfig();
    const selection = Array.isArray(cfg.kickRedeem) ? cfg.kickRedeem[i - 1] : null;
    const reward = typeof selection === 'string' ? selection : selection?.reward;
    if (!['xp','capture','lure'].includes(reward) || kickRedeemStopped.has(i)) return;
    const ses = session.fromPartition(accountPartition(i));
    const cookies = await ses.cookies.get({ url: 'https://kick.com' });
    const rawToken = cookies.find(c => c.name === 'session_token')?.value;
    if (!rawToken) { if (!kickRedeemNoLogin.has(i)) { kickRedeemNoLogin.add(i); notify(`Conta ${i}: entre na Kick em uma janela desta conta para habilitar o resgate automático.`); } return; }
    kickRedeemNoLogin.delete(i);
    const token = decodeURIComponent(rawToken);
    const channels = [...kickWindows.keys()].filter(k => k.startsWith(`${i}:`)).map(k => k.slice(String(i).length + 1));
    for (const channel of channels) {
      const key = `${i}:${channel}`;
      const old = kickRedeemState.get(key) || { retryAt: 0, points: null, cost: null, redeemedAt: 0, text: '' };
      if (Date.now() < old.retryAt) continue;
      const call = (suffix, init = {}) => fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}${suffix}`, {
        cache: 'no-store', credentials: 'include', ...init,
        headers: { Accept: 'application/json', 'x-app-platform': 'web', Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        signal: AbortSignal.timeout(15000)
      });
      try {
        let response = await call('/points');
        if (!response.ok) throw new Error(`saldo HTTP ${response.status}`);
        const points = Number((await response.json())?.data?.points);
        if (!Number.isFinite(points)) throw new Error('saldo não informado');
        response = await call('/rewards');
        if (!response.ok) throw new Error(`recompensas HTTP ${response.status}`);
        const rewards = (await response.json())?.data || [];
        const selected = rewards.find(r => r.is_enabled && rewardPattern(reward).test(r.title || '') && /pokeidle/i.test(`${r.title || ''} ${r.description || ''}`));
        if (!selected) { old.text = 'canal sem bônus do PokeIdle'; kickRedeemState.set(key, old); continue; }
        const cost = Number(selected.cost);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        if (old.points !== null && old.cost && old.redeemedAt && Date.now() - old.redeemedAt < 30 * 60 * 1000 && points >= old.points + Math.floor(old.cost / 2)) {
          kickRedeemStopped.add(i);
          notify(`Conta ${i}: os pontos do resgate voltaram. O resgate automático foi pausado; vincule a Kick no jogo e reative a opção.`);
          return;
        }
        old.text = `${points}/${cost} pontos`;
        if (!selected.is_paused && points >= cost) {
          const redeem = await call(`/rewards/${encodeURIComponent(selected.id)}/redeem`, { method: 'POST', body: JSON.stringify({ transaction_id: makeTransactionId(), message: '' }) });
          if (redeem.ok) {
            old.points = points - cost; old.cost = cost; old.redeemedAt = Date.now(); old.text = `resgatou ${selected.title} em ${channel}`;
            notify(`Conta ${i}: resgatado ${selected.title} na Kick (${channel}).`);
          } else {
            old.retryAt = Date.now() + 30 * 60 * 1000; old.text = `resgate recusado (HTTP ${redeem.status}); nova tentativa em 30 min`;
          }
        } else { old.points = points; old.cost = cost; }
        kickRedeemState.set(key, old);
      } catch (error) { old.text = error.message; kickRedeemState.set(key, old); }
    }
  }
  function setKickRedeem(i, reward) {
    const cfg = readConfig();
    const values = Array.isArray(cfg.kickRedeem) ? cfg.kickRedeem.slice(0, 4) : [];
    while (values.length < 4) values.push(null);
    values[i - 1] = ['xp','capture','lure'].includes(reward) ? reward : null;
    writeConfig({ kickRedeem: values });
    kickRedeemStopped.delete(i); kickRedeemNoLogin.delete(i);
    return values[i - 1];
  }
  async function kickOpenRecommended(i) {
    const result = await syncKickAccount(i, true);
    if (!kickMonitors.has(i)) kickMonitors.set(i, setInterval(() => { void syncKickAccount(i, false).catch(() => {}); }, 30000));
    if (!kickRedeemTimers.has(i)) kickRedeemTimers.set(i, setInterval(() => { void redeemKickAccount(i).catch(() => {}); }, 5 * 60 * 1000));
    void redeemKickAccount(i).catch(() => {});
    return result;
  }
  async function rotomEval(i, expression) {
    const view = getView(i);
    if (!view || view.webContents.isDestroyed()) throw new Error('Conta indisponível.');
    const dbg = view.webContents.debugger;
    let attachedHere = false;
    const contexts = new Set();
    const onMessage = (_event, method, params) => {
      if (method !== 'Runtime.executionContextCreated') return;
      const ctx = params?.context;
      if (ctx?.origin === `chrome-extension://${ROTOM_ID}` && Number.isInteger(ctx.id)) contexts.add(ctx.id);
    };
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true; }
      dbg.on('message', onMessage);
      await dbg.sendCommand('Runtime.enable');
      for (let n = 0; n < 25 && !contexts.size; n++) await new Promise(resolve => setTimeout(resolve, 60));
      const contextId = contexts.values().next().value;
      if (!contextId) throw new Error('Rotom Sniper não está carregado nesta conta. Instale a extensão e recarregue a página.');
      const result = await dbg.sendCommand('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true });
      if (result?.exceptionDetails) throw new Error('A extensão recusou a alteração.');
      return result?.result?.value;
    } finally {
      dbg.removeListener('message', onMessage);
      if (attachedHere && dbg.isAttached()) { try { dbg.detach(); } catch (_) {} }
    }
  }
  async function getRotomEnabled(i) {
    return rotomEval(i, `new Promise(resolve => chrome.storage.local.get('rotom_sniper_enabled', v => resolve(v.rotom_sniper_enabled === undefined ? true : Boolean(v.rotom_sniper_enabled))))`);
  }
  async function setRotomEnabled(i, enabled) {
    return rotomEval(i, `new Promise(resolve => chrome.storage.local.set({rotom_sniper_enabled:${enabled ? 'true' : 'false'}}, () => resolve(!chrome.runtime.lastError)))`);
  }
  function stopKick(i) {
    const timer = kickMonitors.get(i);
    if (timer) clearInterval(timer);
    kickMonitors.delete(i);
    const redeemTimer = kickRedeemTimers.get(i); if (redeemTimer) clearInterval(redeemTimer); kickRedeemTimers.delete(i);
    for (const [key, w] of [...kickWindows]) if (key.startsWith(`${i}:`) && w && !w.isDestroyed()) w.close();
    return true;
  }
  async function findTopIdleGameId(headers = {}) {
    const response = await fetch(`${TOPIDLE}/api/games`, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`TopIdle respondeu ${response.status}`);
    const data = await response.json();
    const games = Array.isArray(data) ? data : (data.games || []);
    const game = games.find(g => String(g.domain || '').replace(/^www\./, '').toLowerCase() === 'pokeidle.io' || String(g.url || '').includes('pokeidle.io'));
    return game?.id || null;
  }
  async function topIdleState(i) {
    const ses = session.fromPartition(accountPartition(i));
    const cookies = await ses.cookies.get({ url: TOPIDLE });
    if (!cookies.length) return { loggedIn: false, canVote: false, message: 'Entre no TopIdle nesta conta primeiro.' };
    const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const headers = { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 PokeIdleMultiscreen' };
    const meRes = await fetch(`${TOPIDLE}/api/me`, { headers, signal: AbortSignal.timeout(12000) });
    if (!meRes.ok) return { loggedIn: false, canVote: false, message: 'Sessão do TopIdle expirada.' };
    const me = await meRes.json();
    const gamesRes = await fetch(`${TOPIDLE}/api/games`, { headers, signal: AbortSignal.timeout(12000) });
    if (!gamesRes.ok) throw new Error(`TopIdle respondeu ${gamesRes.status}`);
    const gamesJson = await gamesRes.json();
    const games = Array.isArray(gamesJson) ? gamesJson : (gamesJson.games || []);
    const game = games.find(g => String(g.domain || '').replace(/^www\./, '').toLowerCase() === 'pokeidle.io' || String(g.url || '').includes('pokeidle.io'));
    if (!game) return { loggedIn: true, canVote: false, player: me?.user?.name, message: 'PokeIdle não encontrado na lista do TopIdle.' };
    const next = Number(game.nextVoteAt) > 0 ? new Date(Number(game.nextVoteAt) * 1000).toLocaleString('pt-BR') : null;
    return { loggedIn: true, canVote: game.canVote !== false, next, player: me?.user?.name || me?.user?.email || null, gameId: game.id };
  }
  function watchTopIdleVotes(i) {
    const ses = session.fromPartition(accountPartition(i));
    if (topIdleWatchers.has(ses)) return;
    topIdleWatchers.add(ses);
    ses.webRequest.onCompleted({ urls: ['https://topidle.com/api/games/*/vote', 'https://www.topidle.com/api/games/*/vote'] }, details => {
      if (details.method === 'POST' && details.statusCode >= 200 && details.statusCode < 300) notify(`Conta ${i}: voto no TopIdle registrado.`);
    });
  }
  async function openTopIdle(i) {
    watchTopIdleVotes(i);
    const view = getView(i);
    let nick = null;
    try {
      let raw = await view.webContents.executeJavaScript(`localStorage.getItem('nick')`, true);
      if (typeof raw === 'string') { try { const parsed = JSON.parse(raw); if (typeof parsed === 'string') raw = parsed; } catch (_) {} }
      if (typeof raw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw)) nick = raw;
    } catch (_) {}
    const ses = session.fromPartition(accountPartition(i));
    const cookies = await ses.cookies.get({ url: TOPIDLE });
    if (!cookies.length) {
      const oldLogin = voteWindows.get(i);
      if (oldLogin && !oldLogin.isDestroyed()) { oldLogin.show(); oldLogin.focus(); await oldLogin.loadURL(TOPIDLE); }
      else { const w = new BrowserWindow({ width: 1100, height: 820, webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true } }); w.setMenuBarVisibility(false); voteWindows.set(i, w); w.on('closed', () => voteWindows.delete(i)); await w.loadURL(TOPIDLE); }
      return { ok: true, loginRequired: true };
    }
    const cookiesNow = await ses.cookies.get({ url: TOPIDLE });
    const cookieHeader = cookiesNow.map(c => `${c.name}=${c.value}`).join('; ');
    const gameId = await findTopIdleGameId(cookieHeader ? { Cookie: cookieHeader } : {});
    if (!gameId) throw new Error('Não encontrei o jogo PokeIdle na API do TopIdle.');
    const url = `${TOPIDLE}/jogo/${encodeURIComponent(gameId)}?votar=1${nick ? `&playerIdentifier=${encodeURIComponent(nick)}` : ''}`;
    const old = voteWindows.get(i);
    if (old && !old.isDestroyed()) { old.show(); old.focus(); await old.loadURL(url); }
    else {
      const w = new BrowserWindow({ width: 1100, height: 820, webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true } });
      w.setMenuBarVisibility(false); voteWindows.set(i, w); w.on('closed', () => voteWindows.delete(i)); await w.loadURL(url);
    }
    return { ok: true, loginRequired: false };
  }
  function dispose() {
    for (const w of [...voteWindows.values(), ...kickWindows.values()]) if (w && !w.isDestroyed()) w.close();
    for (const timer of kickMonitors.values()) clearInterval(timer);
    for (const timer of kickRedeemTimers.values()) clearInterval(timer);
    kickMonitors.clear(); kickRedeemTimers.clear(); voteWindows.clear(); kickWindows.clear();
  }
  return { topIdleState, openTopIdle, getKickLive, openKick, kickOpenRecommended, stopKick, setKickRedeem, getRotomEnabled, setRotomEnabled, dispose };
}
module.exports = { createExtraFeatures };
