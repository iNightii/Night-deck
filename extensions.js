// Gerenciador de extensões (pastas de extensões do Chrome descompactadas).
// Cada extensão é carregada nas 4 sessões das contas, então os scripts dela rodam em todas.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Lê o manifest.json; devolve null se a pasta não for uma extensão.
function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (![2, 3].includes(m.manifest_version)) return null;
    const rawName = String(m.name || '');
    const name = !rawName || rawName.startsWith('__MSG_') ? path.basename(dir) : rawName;
    return { name, version: String(m.version || ''), manifest: m };
  } catch (_) { return null; }
}

// Páginas HTML da extensão que valem a pena abrir (popup, opções, painel e as da raiz).
function listPages(dir, manifest) {
  const out = new Set();
  const add = p => {
    if (typeof p !== 'string') return;
    const clean = p.split(/[?#]/)[0].replace(/^\/+/, '');
    if (!clean || clean.includes('..') || !/\.html?$/i.test(clean)) return;
    if (fs.existsSync(path.join(dir, clean))) out.add(clean);
  };
  const m = manifest || {};
  [m.action?.default_popup, m.browser_action?.default_popup, m.page_action?.default_popup, m.options_ui?.page, m.options_page, m.side_panel?.default_path].forEach(add);
  try { fs.readdirSync(dir).filter(f => /\.html?$/i.test(f)).slice(0, 10).forEach(add); } catch (_) {}
  return [...out].slice(0, 12);
}

function createExtensionManager({ userData, partitions, session, BrowserWindow, dialog, shell, getParent, getAccountIndex, storageImporter, notify = () => {} }) {
  const file = path.join(userData, 'extensions.json');
  let entries = [];                       // [{ path, enabled }]
  const info = new Map();                 // path -> { name, version, pages, ids: {partition: id}, error }
  const windows = new Map();              // "path|page" -> BrowserWindow
  try { entries = (JSON.parse(fs.readFileSync(file, 'utf8')).extensions || []).filter(e => e && typeof e.path === 'string').map(e => ({ path: e.path, enabled: e.enabled !== false })); } catch (_) {}
  const save = () => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ extensions: entries }, null, 2)); } catch (_) {} };

  const sesOf = partition => session.fromPartition(partition);
  const loader = ses => ses.extensions?.loadExtension ? ses.extensions : ses; // API nova (ses.extensions) ou antiga

  async function enable(entry) {
    const meta = readManifest(entry.path);
    if (!meta) { info.set(entry.path, { name: path.basename(entry.path), version: '', pages: [], ids: {}, error: 'Pasta sem manifest.json válido.' }); return; }
    const rec = { name: meta.name, version: meta.version, pages: listPages(entry.path, meta.manifest), ids: {}, error: '' };
    info.set(entry.path, rec);
    for (const part of partitions) {
      try { const ext = await loader(sesOf(part)).loadExtension(entry.path, { allowFileAccess: true }); rec.ids[part] = ext.id; }
      catch (e) { rec.error = String(e?.message || e); notify('erro', `${meta.name}: ${rec.error}`); }
    }
  }
  async function disable(entry) {
    const rec = info.get(entry.path);
    if (!rec) return;
    for (const [part, id] of Object.entries(rec.ids)) { try { await loader(sesOf(part)).removeExtension(id); } catch (_) {} }
    rec.ids = {};
    for (const [k, w] of windows) if (k.startsWith(entry.path + '|')) { try { w.destroy(); } catch (_) {} windows.delete(k); }
  }

  async function openPage(entry, page) {
    const rec = info.get(entry.path);
    const idx = Math.min(4, Math.max(1, Number(getAccountIndex?.()) || 1));
    const part = partitions[idx - 1];
    const id = rec?.ids?.[part];
    if (!id) { dialog.showMessageBox(getParent(), { type: 'warning', message: 'A extensão não está carregada.', detail: rec?.error || 'Ative a extensão e tente de novo.' }); return; }
    const key = `${entry.path}|${page}|${idx}`;
    const old = windows.get(key);
    if (old && !old.isDestroyed()) { old.show(); old.focus(); return; }
    const w = new BrowserWindow({ width: 1150, height: 760, title: `${rec.name} · Conta ${idx}`, autoHideMenuBar: true, webPreferences: { session: sesOf(part), contextIsolation: true } });
    w.removeMenu();
    windows.set(key, w);
    w.on('closed', () => windows.delete(key));
    w.loadURL(`chrome-extension://${id}/${page}`).catch(() => {});
  }

  // Importa cópias das extensões instaladas no Chrome para uma pasta própria do app.
  // O Chrome permanece intacto; Electron carrega a cópia descompactada.
  async function importChrome() {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const roots = [
      path.join(local, 'Google', 'Chrome', 'User Data'),
      path.join(local, 'Chromium', 'User Data')
    ];
    const found = new Map();
    for (const root of roots) {
      let profiles = [];
      try { profiles = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name))).map(d => d.name); } catch (_) {}
      for (const profile of profiles) {
        const extRoot = path.join(root, profile, 'Extensions');
        let ids = [];
        try { ids = fs.readdirSync(extRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (_) {}
        for (const id of ids) {
          let versions = [];
          try { versions = fs.readdirSync(path.join(extRoot, id), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (_) {}
          for (const version of versions) {
            const source = path.join(extRoot, id, version);
            const meta = readManifest(source);
            if (meta && !found.has(id)) found.set(id, { id, source, meta });
          }
        }
      }
    }
    if (!found.size) {
      await dialog.showMessageBox(getParent(), { type: 'info', message: 'Não encontrei extensões instaladas no Google Chrome neste usuário.' });
      return;
    }
    // Pergunta individualmente quais extensões importar, em vez de importar todas.
    // A lista é ordenada para que a escolha seja previsível.
    const candidates = [...found.values()].sort((a, b) =>
      a.meta.name.localeCompare(b.meta.name, 'pt-BR', { sensitivity: 'base' })
    );
    const selected = [];
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const choice = await dialog.showMessageBox(getParent(), {
        type: 'question',
        title: 'Selecionar extensões do Chrome',
        message: `Importar "${item.meta.name}"?`,
        detail: `Extensão ${i + 1} de ${candidates.length}\\nVersão: ${item.meta.version}\\nID: ${item.id}\\n\\nEscolha "Importar" somente para as extensões que deseja usar no Night Deck. "Pular" passa à próxima.`,
        buttons: ['Importar', 'Pular', 'Cancelar'],
        defaultId: 1,
        cancelId: 2,
        noLink: true
      });
      if (choice.response === 2) return;
      if (choice.response === 0) selected.push(item);
    }
    if (!selected.length) {
      await dialog.showMessageBox(getParent(), { type: 'info', message: 'Nenhuma extensão selecionada para importar.' });
      return;
    }
    const already = new Set(entries.map(e => path.resolve(e.path)));
    const importedRoot = path.join(userData, 'chrome-imported');
    let added = 0, skipped = 0;
    for (const item of selected) {
      const dest = path.join(importedRoot, item.id, item.meta.version || 'current');
      if (already.has(path.resolve(dest))) { skipped++; continue; }
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(path.join(dest, 'manifest.json'))) fs.cpSync(item.source, dest, { recursive: true });
        if (!readManifest(dest)) { skipped++; continue; }
        const entry = { path: dest, enabled: true };
        entries.push(entry); already.add(path.resolve(dest)); added++;
        await enable(entry);
      } catch (e) { notify('erro', `Importação ${item.meta.name}: ${String(e?.message || e)}`); }
    }
    save();
    await dialog.showMessageBox(getParent(), {
      type: added ? 'info' : 'warning',
      message: `${added} extensão(ões) importada(s) do Chrome.`,
      detail: `${skipped} já estavam importadas ou foram ignoradas.\n\nAs cópias ficam independentes do Chrome. O Electron não oferece compatibilidade total com todas as APIs/extensões, principalmente algumas extensões Manifest V3.`
    });
  }

  async function add() {
    const r = await dialog.showOpenDialog(getParent(), { title: 'Escolha a pasta da extensão (a que tem o manifest.json)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    const dir = r.filePaths[0];
    const meta = readManifest(dir);
    if (!meta) { dialog.showMessageBox(getParent(), { type: 'error', message: 'Essa pasta não parece uma extensão.', detail: 'Ela precisa conter o arquivo manifest.json. Se a extensão veio em .zip, extraia antes e escolha a pasta extraída.' }); return; }
    if (entries.some(e => e.path === dir)) { dialog.showMessageBox(getParent(), { type: 'info', message: 'Essa extensão já está na lista.' }); return; }
    const ok = await dialog.showMessageBox(getParent(), {
      type: 'warning', buttons: ['Adicionar', 'Cancelar'], defaultId: 1, cancelId: 1, title: 'Adicionar extensão',
      message: `Adicionar "${meta.name}" ${meta.version}?`,
      detail: 'Extensões podem ler e agir dentro das suas contas do jogo. Adicione só extensões de fontes em que você confia.\n\nObs.: o app suporta só parte dos recursos de extensões do Chrome; algumas podem não funcionar por completo.'
    });
    if (ok.response !== 0) return;
    const entry = { path: dir, enabled: true };
    entries.push(entry); save();
    await enable(entry);
    const rec = info.get(dir);
    if (rec.error) dialog.showMessageBox(getParent(), { type: 'warning', message: `"${rec.name}" foi adicionada, mas deu erro ao carregar.`, detail: rec.error });
    else dialog.showMessageBox(getParent(), { type: 'info', message: `"${rec.name}" adicionada.`, detail: 'Recarregue as contas (botão Todas) para os scripts dela entrarem no jogo.' });
  }

  function menuTemplate() {
    const t = [];
    for (const entry of entries) {
      const rec = info.get(entry.path) || { name: path.basename(entry.path), version: '', pages: [], ids: {}, error: '' };
      const sub = [];
      if (rec.error) sub.push({ label: `Erro: ${rec.error.slice(0, 80)}`, enabled: false });
      if (entry.enabled) rec.pages.forEach(p => sub.push({ label: `Abrir ${p}`, click: () => { openPage(entry, p); } }));
      if (entry.enabled && !rec.pages.length && !rec.error) sub.push({ label: 'Sem página própria (roda dentro do jogo)', enabled: false });
      if (sub.length) sub.push({ type: 'separator' });
      if (entry.enabled && storageImporter) sub.push({ label: 'Importar configurações (Chrome / IdleDeck / outra conta)…', click: () => { void storageImporter.importFor(entry, rec); } });
      sub.push({ label: entry.enabled ? 'Desativar' : 'Ativar', click: async () => { entry.enabled = !entry.enabled; save(); entry.enabled ? await enable(entry) : await disable(entry); } });
      sub.push({ label: 'Mostrar pasta', click: () => shell.showItemInFolder(entry.path) });
      sub.push({ label: 'Remover da lista', click: async () => { await disable(entry); entries = entries.filter(e => e !== entry); info.delete(entry.path); save(); } });
      t.push({ label: `${rec.name}${rec.version ? ' ' + rec.version : ''}${entry.enabled ? '' : ' (desativada)'}`, submenu: sub });
    }
    if (t.length) t.push({ type: 'separator' });
    t.push({ label: 'Importar extensões instaladas no Chrome', click: () => { importChrome(); } });
    t.push({ label: 'Abrir Chrome Web Store', click: () => shell.openExternal('https://chromewebstore.google.com/') });
    t.push({ label: 'Adicionar extensão (pasta)…', click: () => { add(); } });
    return t;
  }

  return {
    async init() { for (const e of entries) if (e.enabled) await enable(e); },
    menuTemplate, add, importChrome, list: () => entries.map(e => ({ ...e, ...(info.get(e.path) || {}) })),
    _enable: enable, _disable: disable, _entries: () => entries
  };
}

module.exports = { createExtensionManager, readManifest, listPages };
