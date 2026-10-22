// Service worker : point unique d'écriture dans le stockage (verrou) + téléchargements.
// Le panneau latéral et le script de page passent tous les deux par ici,
// ce qui évite qu'ils s'écrasent mutuellement la file d'attente.

const DEFAULT_SETTINGS = {
  delayMin: 5,          // secondes entre deux prompts (tirage aléatoire entre min et max)
  delayMax: 10,
  timeout: 180,         // secondes max d'attente d'une génération
  expected: 0,          // images attendues par prompt (0 = détection automatique)
  stableSeconds: 6,     // en mode auto : délai sans nouvelle image avant de valider
  retries: 1,           // nouvelles tentatives en cas d'échec
  autoDownload: true,
  folder: 'Flow',
  separator: 'ligne',   // ligne | vide | tirets
  fieldSelector: '',
  buttonSelector: ''
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get(['queue', 'settings', 'run', 'logs', 'seq']);
  await chrome.storage.local.set({
    queue: s.queue || [],
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    run: s.run || { running: false, currentId: null, tabId: null },
    logs: s.logs || [],
    seq: s.seq || 0
  });
});

// Verrou : chaque opération attend la fin de la précédente
let lock = Promise.resolve();
function withLock(fn) {
  const p = lock.then(fn, fn);
  lock = p.catch(() => {});
  return p;
}

async function getState() {
  const s = await chrome.storage.local.get(['queue', 'settings', 'run', 'logs', 'seq']);
  return {
    queue: s.queue || [],
    settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
    run: s.run || { running: false, currentId: null, tabId: null },
    logs: s.logs || [],
    seq: s.seq || 0
  };
}

function pushLog(logs, msg, level = 'info') {
  logs.push({ t: Date.now(), msg, level });
  return logs.slice(-150);
}

const ops = {
  async 'queue:add'({ texts }) {
    const st = await getState();
    for (const text of texts) {
      st.seq += 1;
      st.queue.push({ id: crypto.randomUUID(), num: st.seq, text, status: 'attente', tries: 0, files: 0, error: '' });
    }
    await chrome.storage.local.set({ queue: st.queue, seq: st.seq });
    return { added: texts.length };
  },

  async 'queue:remove'({ id }) {
    const st = await getState();
    await chrome.storage.local.set({ queue: st.queue.filter(i => i.id !== id) });
  },

  async 'queue:clear'({ onlyDone }) {
    const st = await getState();
    const queue = onlyDone ? st.queue.filter(i => i.status !== 'termine') : st.queue.filter(i => i.status === 'en-cours');
    await chrome.storage.local.set({ queue, seq: queue.length ? st.seq : 0 });
  },

  async 'queue:reset'() {
    const st = await getState();
    st.queue.forEach(i => { if (i.status !== 'en-cours') Object.assign(i, { status: 'attente', tries: 0, error: '', files: 0 }); });
    await chrome.storage.local.set({ queue: st.queue });
  },

  async 'queue:move'({ id, dir }) {
    const st = await getState();
    const i = st.queue.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= st.queue.length) return;
    [st.queue[i], st.queue[j]] = [st.queue[j], st.queue[i]];
    await chrome.storage.local.set({ queue: st.queue });
  },

  async 'queue:update'({ id, patch }) {
    const st = await getState();
    const item = st.queue.find(i => i.id === id);
    if (item) Object.assign(item, patch);
    await chrome.storage.local.set({ queue: st.queue });
  },

  // Prend le prochain prompt en attente et le marque "en cours" en une seule opération
  async 'queue:next'() {
    const st = await getState();
    const item = st.queue.find(i => i.status === 'attente');
    if (!item) return null;
    item.status = 'en-cours';
    st.run.currentId = item.id;
    await chrome.storage.local.set({ queue: st.queue, run: st.run });
    return item;
  },

  // Après un rechargement de page : ce qui était en cours repasse en attente
  async 'queue:requeueActive'() {
    const st = await getState();
    st.queue.forEach(i => { if (i.status === 'en-cours') i.status = 'attente'; });
    await chrome.storage.local.set({ queue: st.queue });
  },

  async 'run:set'({ patch }) {
    const st = await getState();
    await chrome.storage.local.set({ run: { ...st.run, ...patch } });
  },

  async 'settings:set'({ patch }) {
    const st = await getState();
    await chrome.storage.local.set({ settings: { ...st.settings, ...patch } });
  },

  async log({ msg, level }) {
    const st = await getState();
    await chrome.storage.local.set({ logs: pushLog(st.logs, msg, level) });
  },

  async 'logs:clear'() {
    await chrome.storage.local.set({ logs: [] });
  },

  async download({ files, num, text }) {
    const { settings } = await getState();
    const folder = sanitize(settings.folder || 'Flow');
    const slug = sanitize(text).slice(0, 40) || 'image';
    let ok = 0;
    for (let n = 0; n < files.length; n++) {
      const { url, mime } = files[n];
      const ext = extFrom(mime, url);
      const filename = `${folder}/${String(num).padStart(3, '0')}_${slug}_${n + 1}.${ext}`;
      try {
        await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
        ok++;
      } catch (e) {
        await ops.log({ msg: `Téléchargement impossible (#${num}) : ${e.message}`, level: 'error' });
      }
    }
    return { ok };
  }
};

function sanitize(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _\-/]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}

function extFrom(mime, url) {
  const m = (mime || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('png')) return 'png';
  const fromUrl = /\.(png|jpe?g|webp)(\?|$)/i.exec(url || '');
  return fromUrl ? fromUrl[1].toLowerCase().replace('jpeg', 'jpg') : 'png';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'tab:id') {
    sendResponse({ ok: true, res: sender.tab ? sender.tab.id : null });
    return false;
  }
  const op = ops[msg.type];
  if (!op) return false;
  withLock(() => op(msg))
    .then(res => sendResponse({ ok: true, res }))
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // réponse asynchrone
});
