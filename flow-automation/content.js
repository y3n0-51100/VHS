// Script injecté dans Google Flow : c'est lui qui déroule la file d'attente.
// Il vit dans la page (contrairement au service worker qui peut s'endormir),
// et reprend tout seul après un rechargement si une exécution était en cours.

(() => {
  if (window.__flowAutoLoaded) return;
  window.__flowAutoLoaded = true;

  const isFlowPage = () => /\/tools\/flow/.test(location.pathname);

  let looping = false;
  let controller = null;
  const seen = new Set(); // images déjà présentes, à ne pas compter comme nouvelles

  // ---------- Utilitaires ----------

  const send = (msg) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (r && r.ok === false) return reject(new Error(r.error));
      resolve(r && 'res' in r ? r.res : r);
    });
  });

  const log = (msg, level = 'info') => send({ type: 'log', msg, level }).catch(() => {});
  const update = (id, patch) => send({ type: 'queue:update', id, patch });

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('Arrêt demandé', 'AbortError'));
      }, { once: true });
    });
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  // ---------- Détection des éléments de Flow ----------

  const FIELD_SELECTORS = [
    '#PINHOLE_TEXT_AREA_ELEMENT_ID',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ];

  function findPromptField(settings) {
    const list = settings.fieldSelector ? [settings.fieldSelector] : FIELD_SELECTORS;
    for (const sel of list) {
      let els;
      try { els = [...document.querySelectorAll(sel)].filter(isVisible); } catch { continue; }
      if (els.length) return els.sort((a, b) => area(b) - area(a))[0]; // le plus grand champ visible
    }
    return null;
  }

  const SUBMIT_ICONS = /^(arrow_forward|arrow_upward|send|north|spark|auto_awesome)$/i;
  const SUBMIT_LABEL = /(créer|create|générer|generate|envoyer|send|submit|lancer)/i;
  const EXCLUDE_LABEL = /(supprimer|delete|annuler|cancel|fermer|close|retour|back|paramètres|settings|ajouter|add|upload|importer)/i;

  function findSubmitButton(field, settings) {
    if (settings.buttonSelector) {
      try {
        const b = [...document.querySelectorAll(settings.buttonSelector)].find(isVisible);
        if (b) return b;
      } catch { /* sélecteur invalide : on passe à l'heuristique */ }
    }
    const fr = field.getBoundingClientRect();
    const fx = fr.right, fy = fr.top + fr.height / 2;
    let best = null, bestScore = -Infinity;

    for (const b of document.querySelectorAll('button, [role="button"]')) {
      if (!isVisible(b)) continue;
      const label = `${b.getAttribute('aria-label') || ''} ${b.title || ''} ${b.innerText || ''}`.trim();
      if (EXCLUDE_LABEL.test(label) && !SUBMIT_LABEL.test(label)) continue;

      let score = 0;
      // Icônes Material (Flow les écrit en texte dans <i> / <span>)
      const icons = [...b.querySelectorAll('i, span, mat-icon')].map(i => i.textContent.trim());
      if (icons.some(t => SUBMIT_ICONS.test(t))) score += 60;
      if (SUBMIT_LABEL.test(label)) score += 40;
      if (b.type === 'submit') score += 20;
      if (score === 0) continue;

      // Plus le bouton est proche du coin droit du champ, mieux c'est
      const r = b.getBoundingClientRect();
      const dist = Math.hypot(r.left + r.width / 2 - fx, r.top + r.height / 2 - fy);
      score -= dist / 20;
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  const isDisabled = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true';

  function setPromptText(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      // Passer par le setter natif pour que React voie le changement
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }
  }

  function readPromptText(el) {
    return (el.value !== undefined ? el.value : el.innerText || '').trim();
  }

  // Clé stable d'une image (les URL signées changent de paramètres)
  const keyOf = (src) => src.startsWith('data:') ? src.slice(0, 200) : src.split('?')[0];

  function resultImages() {
    return [...document.images].filter(img => {
      if (!img.src || !isVisible(img)) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 120 && r.height >= 120; // écarte avatars, icônes, logos
    });
  }

  function snapshot() {
    resultImages().forEach(img => seen.add(keyOf(img.currentSrc || img.src)));
  }

  function newImages() {
    return resultImages().filter(img => !seen.has(keyOf(img.currentSrc || img.src)));
  }

  // Indicateur de chargement visible (barre de progression ou pourcentage)
  function isLoading() {
    if ([...document.querySelectorAll('[role="progressbar"], mat-progress-bar, mat-spinner')].some(isVisible)) return true;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (/^\s*\d{1,3}\s?%\s*$/.test(n.nodeValue) && isVisible(n.parentElement)) return true;
    }
    return false;
  }

  async function waitForResults(settings, signal) {
    const deadline = Date.now() + settings.timeout * 1000;
    let lastCount = 0, lastChange = Date.now();

    while (Date.now() < deadline) {
      await sleep(1000, signal);
      const imgs = newImages().filter(i => i.complete && i.naturalWidth > 0);

      if (imgs.length !== lastCount) { lastCount = imgs.length; lastChange = Date.now(); }

      if (settings.expected > 0) {
        if (imgs.length >= settings.expected) return imgs.slice(0, settings.expected);
      } else if (imgs.length > 0 && !isLoading() && Date.now() - lastChange >= settings.stableSeconds * 1000) {
        return imgs;
      }
    }
    const partial = newImages().filter(i => i.complete && i.naturalWidth > 0);
    if (partial.length) return partial;
    throw new Error(`Aucune image reçue après ${settings.timeout} s`);
  }

  // Récupère l'image en data: si possible (bonne extension), sinon garde l'URL
  async function toDownloadable(img) {
    const src = img.currentSrc || img.src;
    if (src.startsWith('data:')) return { url: src, mime: src.slice(5, src.indexOf(';')) };
    try {
      const blob = await (await fetch(src, { credentials: 'include' })).blob();
      const url = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      return { url, mime: blob.type };
    } catch {
      return { url: src, mime: '' };
    }
  }

  // ---------- Traitement d'un prompt ----------

  async function processItem(item, settings, signal) {
    const field = findPromptField(settings);
    if (!field) throw new Error('Champ de prompt introuvable (ouvre un projet Flow en mode Image)');

    snapshot();
    setPromptText(field, item.text);
    await sleep(500, signal);

    if (!readPromptText(field)) throw new Error('Le prompt n\'a pas pu être saisi');

    const btn = findSubmitButton(field, settings);
    if (btn) {
      for (let i = 0; i < 20 && isDisabled(btn); i++) await sleep(250, signal);
      if (isDisabled(btn)) throw new Error('Bouton de génération désactivé (crédits ou quota ?)');
      btn.click();
    } else {
      // Pas de bouton trouvé : on tente la touche Entrée
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }

    await log(`#${item.num} envoyé, génération en cours…`);
    const imgs = await waitForResults(settings, signal);
    imgs.forEach(img => seen.add(keyOf(img.currentSrc || img.src)));

    if (settings.autoDownload) {
      const files = [];
      for (const img of imgs) files.push(await toDownloadable(img));
      await send({ type: 'download', files, num: item.num, text: item.text });
    }
    return imgs.length;
  }

  // ---------- Boucle principale ----------

  async function runLoop() {
    if (looping) return;
    looping = true;
    controller = new AbortController();
    const { signal } = controller;

    try {
      const myTab = await send({ type: 'tab:id' });
      await send({ type: 'run:set', patch: { running: true, tabId: myTab } });
      await log('Démarrage de la file');

      while (!signal.aborted) {
        const { run, settings } = await chrome.storage.local.get(['run', 'settings']);
        if (!run || !run.running) break;

        const item = await send({ type: 'queue:next' });
        if (!item) {
          await log('File terminée ✔', 'success');
          break;
        }

        try {
          const count = await processItem(item, settings, signal);
          await update(item.id, { status: 'termine', files: count, error: '' });
          await log(`#${item.num} terminé (${count} image${count > 1 ? 's' : ''})`, 'success');
        } catch (e) {
          if (e.name === 'AbortError') {
            await update(item.id, { status: 'attente' });
            break;
          }
          const tries = (item.tries || 0) + 1;
          const retry = tries <= settings.retries;
          await update(item.id, { status: retry ? 'attente' : 'erreur', tries, error: e.message });
          await log(`#${item.num} : ${e.message}${retry ? ' — nouvelle tentative' : ''}`, 'error');
        }

        // Pause aléatoire entre deux prompts pour éviter les limitations
        const min = Math.max(0, Number(settings.delayMin) || 0);
        const max = Math.max(min, Number(settings.delayMax) || min);
        await sleep((min + Math.random() * (max - min)) * 1000, signal);
      }
    } catch (e) {
      if (e.name !== 'AbortError') await log(`Erreur : ${e.message}`, 'error');
    } finally {
      await send({ type: 'run:set', patch: { running: false, currentId: null } }).catch(() => {});
      if (signal.aborted) await log('Arrêté');
      looping = false;
      controller = null;
    }
  }

  // Encadre brièvement le champ et le bouton détectés
  function highlight(settings) {
    const field = findPromptField(settings);
    const btn = field && findSubmitButton(field, settings);
    for (const [el, color] of [[field, '#4267ff'], [btn, '#16a34a']]) {
      if (!el) continue;
      const prev = el.style.outline;
      el.style.outline = `3px solid ${color}`;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { el.style.outline = prev; }, 2500);
    }
    return { field: !!field, button: !!btn };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'ping') {
      sendResponse({ flow: isFlowPage(), looping });
    } else if (msg.type === 'run:start') {
      runLoop();
      sendResponse({ started: true });
    } else if (msg.type === 'run:stop') {
      if (controller) controller.abort();
      sendResponse({ stopped: true });
    } else if (msg.type === 'detect') {
      chrome.storage.local.get('settings').then(({ settings }) => sendResponse(highlight(settings || {})));
      return true;
    }
    return false;
  });

  // Reprise automatique après rechargement de la page
  (async () => {
    if (!isFlowPage()) return;
    const { run } = await chrome.storage.local.get('run');
    if (!run || !run.running) return;
    const myTab = await send({ type: 'tab:id' });
    if (run.tabId && run.tabId !== myTab) return;
    await send({ type: 'queue:requeueActive' });
    await log('Page rechargée, reprise dans 5 s…');
    await sleep(5000);
    runLoop();
  })();
})();
