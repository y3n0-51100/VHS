// Panneau latéral : saisie des prompts, pilotage de l'exécution, affichage de l'état.
// Tout l'état vit dans chrome.storage.local ; le panneau se redessine à chaque changement.

const $ = (id) => document.getElementById(id);
const STATUS_LABEL = { attente: 'En attente', 'en-cours': 'En cours', termine: 'Terminé', erreur: 'Erreur' };

const send = (msg) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(msg, (r) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (r && r.ok === false) return reject(new Error(r.error));
    resolve(r && 'res' in r ? r.res : r);
  });
});
const log = (msg, level = 'info') => send({ type: 'log', msg, level });

let state = { queue: [], settings: {}, run: {}, logs: [] };
const openItems = new Set(); // prompts dépliés dans la liste

// ---------- Onglet Flow ----------

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: 'https://labs.google/fx/*' });
  const flow = tabs.filter(t => /\/tools\/flow/.test(new URL(t.url).pathname));
  return flow.find(t => t.active && t.highlighted) || flow.find(t => t.active) || flow[0] || null;
}

const ping = (tabId) => chrome.tabs.sendMessage(tabId, { type: 'ping' });

// Injecte le script si l'onglet était ouvert avant l'installation de l'extension
async function ensureContent(tabId) {
  try { return await ping(tabId); } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return ping(tabId);
  }
}

async function refreshConnection() {
  const el = $('connection');
  const tab = await findFlowTab();
  if (state.run.running) {
    el.textContent = 'En cours…';
    el.className = 'status-pill is-running';
  } else if (tab) {
    el.textContent = 'Flow connecté';
    el.className = 'status-pill is-on';
  } else {
    el.textContent = 'Flow non détecté';
    el.className = 'status-pill is-off';
  }
}

// ---------- Découpage des prompts ----------

function splitPrompts(raw, mode) {
  const text = raw.replace(/\r\n/g, '\n');
  let parts;
  if (mode === 'vide') parts = text.split(/\n\s*\n/);
  else if (mode === 'tirets') parts = text.split(/^\s*-{3,}\s*$/m);
  else parts = text.split('\n');
  return parts.map(p => p.trim()).filter(Boolean);
}

// Fichier JSON : tableau de chaînes, tableau d'objets (chaque objet = un prompt JSON),
// ou objet { prompts: [...] }
function parseJsonPrompts(raw) {
  let data = JSON.parse(raw);
  if (data && !Array.isArray(data) && Array.isArray(data.prompts)) data = data.prompts;
  if (!Array.isArray(data)) data = [data];
  return data
    .map(p => (typeof p === 'string' ? p : (p && typeof p.prompt === 'string' ? p.prompt : JSON.stringify(p))))
    .map(p => p.trim())
    .filter(Boolean);
}

async function addPrompts(texts) {
  if (!texts.length) return;
  await send({ type: 'queue:add', texts });
  $('add-feedback').textContent = `${texts.length} prompt${texts.length > 1 ? 's' : ''} ajouté${texts.length > 1 ? 's' : ''}`;
  setTimeout(() => { $('add-feedback').textContent = ''; }, 3000);
}

// ---------- Rendu ----------

function renderQueue() {
  const list = $('queue');
  list.replaceChildren();
  const q = state.queue;
  $('queue-empty').hidden = q.length > 0;

  q.forEach((item, idx) => {
    const li = document.createElement('li');
    li.className = `queue_item is-${item.status}${openItems.has(item.id) ? ' is-open' : ''}`;

    const num = document.createElement('span');
    num.className = 'queue_num';
    num.textContent = `#${item.num}`;

    const body = document.createElement('div');
    const text = document.createElement('div');
    text.className = 'queue_text';
    text.textContent = item.text;
    text.title = 'Cliquer pour déplier';
    text.addEventListener('click', () => {
      openItems.has(item.id) ? openItems.delete(item.id) : openItems.add(item.id);
      li.classList.toggle('is-open');
    });

    const meta = document.createElement('div');
    meta.className = 'queue_meta';
    const badge = document.createElement('span');
    badge.className = 'queue_badge';
    badge.textContent = STATUS_LABEL[item.status] || item.status;
    meta.append(badge);
    if (item.status === 'termine' && item.files) {
      const f = document.createElement('span');
      f.className = 'text-color-secondary';
      f.textContent = `${item.files} image${item.files > 1 ? 's' : ''}`;
      meta.append(f);
    }
    if (item.error && item.status !== 'termine') {
      const err = document.createElement('span');
      err.className = 'queue_error';
      err.textContent = item.error;
      meta.append(err);
    }
    body.append(text, meta);

    // Monter / descendre / supprimer
    const ctrl = document.createElement('div');
    ctrl.className = 'queue_controls';
    const mk = (label, title, fn, disabled) => {
      const b = document.createElement('button');
      b.className = 'button is-icon';
      b.textContent = label;
      b.title = title;
      b.disabled = !!disabled;
      b.addEventListener('click', fn);
      return b;
    };
    const busy = item.status === 'en-cours';
    ctrl.append(
      mk('↑', 'Monter', () => send({ type: 'queue:move', id: item.id, dir: -1 }), idx === 0),
      mk('↓', 'Descendre', () => send({ type: 'queue:move', id: item.id, dir: 1 }), idx === q.length - 1),
      mk('✕', 'Supprimer', () => send({ type: 'queue:remove', id: item.id }), busy)
    );
    if (item.status === 'erreur' || item.status === 'termine') {
      ctrl.append(mk('↻', 'Relancer', () => send({ type: 'queue:update', id: item.id, patch: { status: 'attente', tries: 0, error: '' } })));
    }

    li.append(num, body, ctrl);
    list.append(li);
  });

  const done = q.filter(i => i.status === 'termine' || i.status === 'erreur').length;
  $('progress-text').textContent = `${done} / ${q.length}`;
  $('progress-fill').style.width = q.length ? `${(done / q.length) * 100}%` : '0';
}

function renderRun() {
  const running = !!state.run.running;
  $('btn-start').disabled = running;
  $('btn-stop').disabled = !running;
  refreshConnection();
}

function renderSettings() {
  document.querySelectorAll('[data-setting]').forEach(el => {
    if (document.activeElement === el) return; // ne pas écraser une saisie en cours
    const v = state.settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  });
  $('separator').value = state.settings.separator || 'ligne';
}

function renderLogs() {
  const ul = $('logs');
  const atBottom = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 20;
  ul.replaceChildren(...state.logs.map(l => {
    const li = document.createElement('li');
    li.className = `logs_item is-${l.level}`;
    const t = new Date(l.t).toLocaleTimeString('fr-FR');
    li.textContent = `${t}  ${l.msg}`;
    return li;
  }));
  if (atBottom) ul.scrollTop = ul.scrollHeight;
}

async function load() {
  const s = await chrome.storage.local.get(['queue', 'settings', 'run', 'logs']);
  state = { queue: s.queue || [], settings: s.settings || {}, run: s.run || {}, logs: s.logs || [] };
  renderQueue(); renderRun(); renderSettings(); renderLogs();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const k of Object.keys(changes)) state[k] = changes[k].newValue;
  if (changes.queue) renderQueue();
  if (changes.run) renderRun();
  if (changes.settings) renderSettings();
  if (changes.logs) renderLogs();
});

// ---------- Actions ----------

$('btn-add').addEventListener('click', async () => {
  const texts = splitPrompts($('prompts').value, $('separator').value);
  if (!texts.length) return;
  await addPrompts(texts);
  $('prompts').value = '';
});

$('separator').addEventListener('change', (e) => send({ type: 'settings:set', patch: { separator: e.target.value } }));

$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const raw = await file.text();
  try {
    const texts = /\.json$/i.test(file.name) ? parseJsonPrompts(raw) : splitPrompts(raw, $('separator').value);
    await addPrompts(texts);
  } catch (err) {
    $('add-feedback').textContent = `Fichier illisible : ${err.message}`;
  }
});

$('btn-start').addEventListener('click', async () => {
  if (!state.queue.some(i => i.status === 'attente')) {
    await log('Aucun prompt en attente', 'error');
    return;
  }
  const tab = await findFlowTab();
  if (!tab) {
    await log('Ouvre un projet Google Flow (labs.google/fx/tools/flow) dans un onglet', 'error');
    return;
  }
  try {
    const info = await ensureContent(tab.id);
    if (!info || !info.flow) throw new Error('page Flow non reconnue');
    await send({ type: 'run:set', patch: { running: true, tabId: tab.id } });
    await chrome.tabs.sendMessage(tab.id, { type: 'run:start' });
  } catch (e) {
    await send({ type: 'run:set', patch: { running: false } });
    await log(`Impossible de démarrer : ${e.message}`, 'error');
  }
});

$('btn-stop').addEventListener('click', async () => {
  await send({ type: 'run:set', patch: { running: false } });
  if (state.run.tabId) chrome.tabs.sendMessage(state.run.tabId, { type: 'run:stop' }).catch(() => {});
});

$('btn-detect').addEventListener('click', async () => {
  const tab = await findFlowTab();
  if (!tab) return log('Aucun onglet Google Flow ouvert', 'error');
  try {
    await ensureContent(tab.id);
    await chrome.tabs.update(tab.id, { active: true });
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'detect' });
    await log(`Détection — champ : ${r.field ? 'OK (bleu)' : 'introuvable'}, bouton : ${r.button ? 'OK (vert)' : 'introuvable'}`,
      r.field && r.button ? 'success' : 'error');
  } catch (e) {
    await log(`Détection impossible : ${e.message}`, 'error');
  }
});

$('btn-reset').addEventListener('click', () => send({ type: 'queue:reset' }));
$('btn-clear-done').addEventListener('click', () => send({ type: 'queue:clear', onlyDone: true }));
$('btn-clear').addEventListener('click', () => {
  if (confirm('Vider toute la file d\'attente ?')) send({ type: 'queue:clear', onlyDone: false });
});
$('btn-clear-logs').addEventListener('click', () => send({ type: 'logs:clear' }));

// Enregistrement des réglages à la volée
document.querySelectorAll('[data-setting]').forEach(el => {
  el.addEventListener('change', () => {
    const key = el.dataset.setting;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    send({ type: 'settings:set', patch: { [key]: value } });
  });
});

chrome.tabs.onUpdated.addListener(refreshConnection);
chrome.tabs.onActivated.addListener(refreshConnection);
chrome.tabs.onRemoved.addListener(refreshConnection);

load();
