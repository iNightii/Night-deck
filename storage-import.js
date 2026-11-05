// Importação segura de chrome.storage.local entre Chrome, IdleDeck e contas do Multiscreen.
// LevelDB não deve ser substituído enquanto a sessão de destino está aberta: a cópia fica em fila
// e é aplicada no próximo início, antes de criar as janelas/sessões do jogo.
const fs = require('fs');
const path = require('path');
const os = require('os');

function safeDirs(parent, pattern) {
  try { return fs.existsSync(parent) ? fs.readdirSync(parent, { withFileTypes: true }).filter(d => d.isDirectory() && pattern.test(d.name)).map(d => path.join(parent, d.name)) : []; }
  catch (_) { return []; }
}
function chromeNames(root) {
  const out = {};
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8')).profile?.info_cache || {};
    for (const [dir, info] of Object.entries(cache)) out[dir] = info?.name || dir;
  } catch (_) {}
  return out;
}
function hasDb(dir) {
  try { return fs.readdirSync(dir).some(n => n.endsWith('.ldb') || n.endsWith('.log') || n.startsWith('MANIFEST-') || n === 'CURRENT'); }
  catch (_) { return false; }
}
function addSource(list, label, folder, kind) {
  if (!hasDb(folder)) return;
  let size = 0, changed = 0;
  try { for (const n of fs.readdirSync(folder)) { const p = path.join(folder, n); const s = fs.statSync(p); if (s.isFile() && n !== 'LOCK' && n !== 'LOG') { size += s.size; changed = Math.max(changed, s.mtimeMs); } } } catch (_) {}
  list.push({ label, folder, kind, size, changed });
}
function storageFolder(root, id) { return path.join(root, 'Local Extension Settings', id); }
function copyDb(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (name === 'LOCK' || name === 'LOG' || name.startsWith('LOG.old')) continue;
    const from = path.join(source, name), to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isFile()) fs.copyFileSync(from, to);
  }
}
function queuePath(userData) { return path.join(userData, 'extension-storage-imports.json'); }
function readQueue(userData) { try { return JSON.parse(fs.readFileSync(queuePath(userData), 'utf8')); } catch (_) { return []; } }
function writeQueue(userData, items) {
  fs.mkdirSync(userData, { recursive: true });
  const p = queuePath(userData), tmp = p + '.tmp';
  if (!items.length) { try { fs.unlinkSync(p); } catch (_) {} return; }
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2)); fs.renameSync(tmp, p);
}
function applyPending({ userData, session, partitions, log = () => {} }) {
  const pending = readQueue(userData), left = [], results = [];
  for (const item of pending) {
    try {
      if (!fs.existsSync(item.source) || !hasDb(item.source)) throw new Error('A pasta de origem não contém um banco de configurações válido.');
      const ses = session.fromPartition(item.partition);
      const root = ses.getStoragePath?.();
      if (!root) throw new Error('Não foi possível localizar o perfil persistente do Electron.');
      const dest = storageFolder(root, item.extensionId);
      // A sessão ainda não recebeu nenhuma janela nesta fase de inicialização.
      const lock = path.join(dest, 'LOCK');
      if (fs.existsSync(lock)) {
        try { const fd = fs.openSync(lock, 'r+'); fs.closeSync(fd); }
        catch (_) { left.push(item); results.push(`${item.label}: perfil ainda bloqueado; tentarei na próxima abertura.`); continue; }
      }
      if (fs.existsSync(dest)) {
        const backup = path.join(userData, 'extension-storage-backups', `${Date.now()}_${item.partition.replace(/[^a-z0-9_-]/gi, '_')}_${item.extensionId}`);
        fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.renameSync(dest, backup);
      }
      copyDb(item.source, dest);
      results.push(`${item.label}: configurações importadas para ${item.partition.replace('persist:pokeidle-account-', 'Conta ')}.`);
    } catch (e) { results.push(`${item.label}: falha — ${e.message}`); log(`Importação de armazenamento: ${e.stack || e}`); }
  }
  writeQueue(userData, left);
  return results;
}

function createStorageImporter({ userData, partitions, session, dialog, getParent, extensionIdFor, notify = () => {} }) {
  function findSources(extensionId) {
    const list = [];
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const [label, root] of [
      ['Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
      ['Chromium', path.join(local, 'Chromium', 'User Data')]
    ]) {
      const names = chromeNames(root);
      for (const dir of safeDirs(root, /^(Default|Profile \d+)$/)) {
        const profile = path.basename(dir);
        addSource(list, `${label} · ${names[profile] || profile}`, storageFolder(dir, extensionId), 'browser');
      }
    }
    for (const pkg of safeDirs(path.join(local, 'Packages'), /^MacedoTI\.IdleDeck_/)) {
      const data = path.join(pkg, 'LocalCache', 'Roaming', 'IdleDeck');
      for (const slot of safeDirs(path.join(data, 'Partitions'), /^slot-/)) {
        const slotId = path.basename(slot).slice(5);
        addSource(list, `IdleDeck · ${slotId.slice(0, 8)}`, storageFolder(slot, extensionId), 'browser');
      }
    }
    partitions.forEach((part, i) => {
      try {
        const root = session.fromPartition(part).getStoragePath?.();
        if (root) addSource(list, `Multiscreen · Conta ${i + 1}`, storageFolder(root, extensionId), 'deck', part);
      } catch (_) {}
    });
    return list.sort((a, b) => b.changed - a.changed);
  }

  async function importFor(entry, extensionRecord) {
    const ids = extensionRecord?.ids || {};
    const uniqueIds = [...new Set(Object.values(ids).filter(Boolean))];
    if (!uniqueIds.length) {
      await dialog.showMessageBox(getParent(), { type: 'warning', title: 'Importar configurações', message: 'A extensão precisa estar ativada para descobrir seu ID.' });
      return;
    }
    if (uniqueIds.length > 1) {
      await dialog.showMessageBox(getParent(), { type: 'warning', title: 'Importar configurações', message: 'As contas carregaram IDs diferentes para esta extensão. Por segurança, não vou copiar os dados.' });
      return;
    }
    const id = uniqueIds[0];
    const sources = findSources(id);
    if (!sources.length) {
      await dialog.showMessageBox(getParent(), { type: 'info', title: 'Importar configurações', message: 'Não encontrei configurações salvas desta extensão no Chrome, IdleDeck ou nas outras contas.' });
      return;
    }
    const sourceChoice = await dialog.showMessageBox(getParent(), {
      type: 'question', title: 'Origem das configurações', message: `Escolha de onde copiar as configurações de ${extensionRecord.name}.`,
      detail: sources.map((s, i) => `${i + 1}. ${s.label} · ${(s.size / 1024).toFixed(1)} KB`).join('\n'),
      buttons: [...sources.map(s => s.label), 'Cancelar'], cancelId: sources.length, defaultId: 0, noLink: true
    });
    if (sourceChoice.response < 0 || sourceChoice.response >= sources.length) return;
    const source = sources[sourceChoice.response];
    const targets = partitions.map((p, i) => ({ label: `Conta ${i + 1}`, partition: p })).filter(t => !(source.kind === 'deck' && source.partition === t.partition));
    if (!targets.length) { await dialog.showMessageBox(getParent(), { type: 'info', message: 'A origem e o destino são a mesma conta.' }); return; }
    const targetChoice = await dialog.showMessageBox(getParent(), {
      type: 'question', title: 'Conta de destino', message: `Copiar ${source.label} para qual conta?`,
      buttons: [...targets.map(t => t.label), 'Cancelar'], cancelId: targets.length, defaultId: 0, noLink: true
    });
    if (targetChoice.response < 0 || targetChoice.response >= targets.length) return;
    const target = targets[targetChoice.response];
    const confirm = await dialog.showMessageBox(getParent(), {
      type: 'warning', title: 'Confirmar importação', buttons: ['Agendar importação', 'Cancelar'], defaultId: 1, cancelId: 1,
      message: `Substituir as configurações de ${extensionRecord.name} na ${target.label}?`,
      detail: 'A cópia atual do destino será guardada em backup. A importação só será aplicada quando você fechar e abrir o Multiscreen novamente. O Chrome/IdleDeck de origem não será alterado.'
    });
    if (confirm.response !== 0) return;
    const pending = readQueue(userData).filter(p => !(p.extensionId === id && p.partition === target.partition));
    pending.push({ extensionId: id, source: source.folder, sourceLabel: source.label, partition: target.partition, label: `${extensionRecord.name} · ${source.label} → ${target.label}` });
    writeQueue(userData, pending);
    await dialog.showMessageBox(getParent(), { type: 'info', title: 'Importação agendada', message: `Pronto. Feche o PokeIdle Multiscreen completamente e abra novamente para aplicar as configurações na ${target.label}.`, detail: 'Se a extensão estiver aberta no Chrome, pode continuar aberta: os arquivos são lidos sem alterar o navegador.' });
  }
  return { importFor, findSources };
}

module.exports = { createStorageImporter, applyPending };
