// js/ui/orgPanel2.js
// Org panel + overlay highlights. Clean UTF-8 implementation.

function debounce(fn, wait = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}

// Word boundary helpers (Unicode-aware)
const WORD_CHAR = /[\p{L}\p{N}]/u;
const isBoundary = (ch) => !ch || !WORD_CHAR.test(ch);
const stripDiacritics = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function findFirstWordIndex(haystack, needle) {
  if (!needle) return -1;
  const text = String(haystack);
  const a = stripDiacritics(text).toLocaleLowerCase('es');
  const b = stripDiacritics(String(needle)).toLocaleLowerCase('es');
  let from = 0;
  while (true) {
    const i = a.indexOf(b, from);
    if (i === -1) return -1;
    const before = i > 0 ? text[i - 1] : '';
    const after = i + b.length < text.length ? text[i + b.length] : '';
    if (isBoundary(before) && isBoundary(after)) return i;
    from = i + 1;
  }
}

const STORE_KEY = 'orgDict.v1';

export const OrgPanel = (() => {
  let els;
  let dict;
  let colorIndex;      // function(name)->slot or Map
  let colorMap = new Map();

  let matches = [];    // [{start,end,org,para,color}]
  let present = new Map(); // name->count
  let detachInput = null;

  const getColor = (name) => {
    if (colorIndex) {
      if (typeof colorIndex === 'function') return colorIndex(name) ?? 0;
      if (typeof colorIndex.get === 'function') return colorIndex.get(name) ?? 0;
    }
    if (!colorMap.has(name)) colorMap.set(name, colorMap.size % 6);
    return colorMap.get(name) ?? 0;
  };
  const getTerms = (e) => [e.name].concat(Array.isArray(e.syns) ? e.syns : (e.terms || [])).filter(Boolean);

  // ==== Unificación de sinónimos en grupos (Union-Find) ====
  const norm = (s) => String(s).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  function unifyDictionary(input) {
    const parent = new Map();
    const allTerms = new Map(); // norm -> original (último visto)
    const entries = Array.isArray(input) ? input : [];
    const termsOfEntry = entries.map(e => getTerms(e));

    const find = (x) => {
      let p = parent.get(x) ?? x;
      while (p !== parent.get(p)) { parent.set(p, parent.get(parent.get(p)) ?? parent.get(p)); p = parent.get(p) ?? p; }
      parent.set(x, p); return p;
    };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(b, a); return a; };

    // Crear nodos y unir nombre <-> sinónimos
    for (const e of entries) {
      const ts = getTerms(e);
      if (!ts.length) continue;
      const nkName = norm(ts[0]);
      if (!parent.has(nkName)) parent.set(nkName, nkName);
      for (const t of ts) {
        const nk = norm(t);
        if (!parent.has(nk)) parent.set(nk, nk);
        allTerms.set(nk, t);
        union(nkName, nk);
      }
    }

    // Construir grupos por raíz
    const groupsMap = new Map(); // root -> { names:[], terms:Set, order:number }
    let order = 0;
    for (const e of entries) {
      const root = find(norm(e.name));
      let g = groupsMap.get(root);
      if (!g) { g = { names: [], terms: new Set(), order: order++ }; groupsMap.set(root, g); }
      g.names.push(e.name);
      for (const t of getTerms(e)) g.terms.add(t);
    }

    // Definir nombre de presentación: primero de names (respetar acentos originales)
    const out = [];
    for (const g of groupsMap.values()) {
      const name = g.names[0] || Array.from(g.terms)[0] || 'grupo';
      const syns = Array.from(g.terms).filter(t => t !== name);
      out.push({ name, syns });
    }
    return out;
  }

  function defaultDict() {
    return [
      { name: 'higado',   syns: ['hígado', 'hepatico', 'hepático', 'hepática'] },
      { name: 'rinon',    syns: ['riñon', 'riñón', 'riñones', 'renal', 'renales'] },
      { name: 'vesicula', syns: ['vesícula', 'vesicular', 'colecisto'] },
      { name: 'pancreas', syns: ['páncreas', 'pancreático', 'pancreática'] },
      { name: 'bazo',     syns: ['esplénico', 'esplénica'] },
      { name: 'vejiga',   syns: ['vesical'] },
      { name: 'intestino',syns: ['colon', 'recto', 'asas de intestino'] },
    ];
  }
  function loadDict() {
    try { const raw = localStorage.getItem(STORE_KEY); const arr = raw ? JSON.parse(raw) : null; if (Array.isArray(arr)) return arr; } catch {}
    return defaultDict();
  }
  function saveDictLocal(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch {} }
  function dictToTextarea() {
    if (!els?.textarea) return;
    els.textarea.value = (dict||[]).map(d => {
      const syns = getTerms(d).filter(t => t !== d.name);
      return `${d.name}: ${syns.join(', ')}`;
    }).join('\n');
  }
  function dictToPlainText() {
    return (dict||[]).map(d => {
      const syns = getTerms(d).filter(t => t !== d.name);
      return `${d.name}: ${syns.join(', ')}`;
    }).join('\n');
  }
  function textareaToDict() {
    if (!els?.textarea) return;
    const out = [];
    for (const line of els.textarea.value.split('\n')) {
      const s = line.trim(); if (!s) continue;
      const [org, rest=''] = s.split(':'); if (!org) continue;
      const syns = rest.split(',').map(t=>t.trim()).filter(Boolean);
      out.push({ name: org.trim(), syns });
    }
    if (out.length) dict = out;
  }

  function scan() {
    const raw = (els.editor?.innerText || '').replace(/\r\n/g, '\n');
    const newMatches = [];
    const presentMap = new Map();
    // Para cada órgano, tomar solo la PRIMERA coincidencia en TODO el texto
    for (const entry of dict) {
      let bestIdx = Infinity; let bestLen = 0;
      for (const term of getTerms(entry)) {
        const i = findFirstWordIndex(raw, term);
        if (i !== -1 && i < bestIdx) { bestIdx = i; bestLen = term.length; }
      }
      if (bestIdx !== Infinity) {
        const start = bestIdx; const end = start + bestLen;
        newMatches.push({ start, end, org: entry.name, para: 0, color: getColor(entry.name) });
        presentMap.set(entry.name, 1);
      }
    }
    newMatches.sort((a,b) => a.start - b.start || b.end - a.end);
    matches = newMatches;
    present = presentMap;
    return { raw };
  }

  function buildOverlay() {
    const { raw } = scan();
    let html = ''; let cur = 0;
    const nonOverlap = []; let lastEnd = -1;
    for (const r of matches) { if (r.start >= lastEnd) { nonOverlap.push(r); lastEnd = r.end; } }
    const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    for (const r of nonOverlap) {
      html += esc(raw.slice(cur, r.start));
      const mid = esc(raw.slice(r.start, r.end));
      html += `<span class="org-hit c${r.color}" data-org="${r.org}" data-start="${r.start}" data-end="${r.end}" data-p="${r.para}">${mid}</span>`;
      cur = r.end;
    }
    html += esc(raw.slice(cur));
    els.overlay.innerHTML = html;
    layoutOverlay();
  }

  function renderList() {
    els.list.innerHTML = '';
    const arr = Array.from(present.keys()).map(name=>({name,color:getColor(name)})).sort((a,b)=>a.name.localeCompare(b.name,'es'));
    if (!arr.length) { const d=document.createElement('div'); d.className='small'; d.textContent='No se detectaron órganos.'; els.list.appendChild(d); return; }
    for (const it of arr) {
      const btn = document.createElement('button');
      btn.type='button'; btn.className='org-item'; btn.setAttribute('data-org', it.name);
      btn.innerHTML = `<span class="dot c${it.color}"></span><span class="name">${it.name}</span>`;
      btn.addEventListener('click', () => jumpToOrgan(it.name));
      els.list.appendChild(btn);
    }
  }

  function setCaret(node, offset) {
    const r = document.createRange(); r.setStart(node, offset); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function findFirstMatchInDOM(root, entry) {
    const terms = getTerms(entry).map(t => stripDiacritics(t).toLocaleLowerCase('es'));
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n; while ((n = w.nextNode())) {
      const txt = n.nodeValue || ''; const low = stripDiacritics(txt).toLocaleLowerCase('es');
      for (const t of terms) {
        let f = 0; while (true) {
          const i = low.indexOf(t, f); if (i === -1) break;
          const b = i>0?txt[i-1]:''; const a = i+t.length<txt.length?txt[i+t.length]:'';
          if (isBoundary(b) && isBoundary(a)) return { node:n, index:i };
          f = i+1;
        }
      }
    }
    return null;
  }
  function jumpToOrgan(name) {
    const entry = dict.find(d => d.name === name); if (!entry) return;
    const m = findFirstMatchInDOM(els.editor, entry); if (!m) return;
    setCaret(m.node, m.index); els.editor.focus();
    const scroller = els.editor.closest('.editor-wrap') || els.editor;
    const sel = window.getSelection(); if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0), rect = r.getBoundingClientRect(), cr = scroller.getBoundingClientRect();
      const target = scroller.scrollTop + (rect.top - cr.top) - (scroller.clientHeight/2 - rect.height/2);
      scroller.scrollTo({ top: Math.max(0,target), behavior: 'smooth' });
    }
  }

  // Place overlay exactly over the editor (border-box) and copy metrics
  function layoutOverlay() {
    if (!els?.editor || !els?.overlay) return;
    const top = els.editor.offsetTop, left = els.editor.offsetLeft;
    const width = els.editor.offsetWidth, height = els.editor.offsetHeight;
    Object.assign(els.overlay.style, { top: top+'px', left: left+'px', width: width+'px', height: height+'px' });
    try { const cs = getComputedStyle(els.editor);
      els.overlay.style.font = cs.font; els.overlay.style.lineHeight = cs.lineHeight; els.overlay.style.letterSpacing = cs.letterSpacing; els.overlay.style.wordSpacing = cs.wordSpacing; els.overlay.style.padding = cs.padding;
    } catch {}
  }

  // Place organ panel aligned with editor top (below toolbar)
  function layoutPanel() {
    const panel = document.getElementById('orgPanel');
    if (!panel || !els?.editor) return;
    const wrap = els.editor.parentElement; // .editor-wrap
    if (!wrap) return;
    const top = wrap.offsetTop; // top inside modal-card
    panel.style.top = top + 'px';
  }

  function openPanel() {
    const card = els?.modalCard || document.querySelector('#editorModal .modal-card');
    card?.classList.add('show-orgs');
    document.getElementById('orgPanel')?.setAttribute('aria-hidden','false');
    layoutOverlay();
    layoutPanel();
  }
  function closePanel() {
    const card = els?.modalCard || document.querySelector('#editorModal .modal-card');
    card?.classList.remove('show-orgs');
    card?.classList.remove('edit-mode');
    document.getElementById('orgPanel')?.setAttribute('aria-hidden','true');
    document.getElementById('orgPanel')?.classList.remove('editing');
    if (document.activeElement && document.getElementById('orgPanel')?.contains(document.activeElement)) els.editor?.focus();
  }
  function togglePanel() {
    const card = els?.modalCard || document.querySelector('#editorModal .modal-card'); if (!card) return;
    const willOpen = !card.classList.contains('show-orgs');
    card.classList.toggle('show-orgs');
    document.getElementById('orgPanel')?.setAttribute('aria-hidden', willOpen ? 'false':'true');
    if (!willOpen && document.activeElement && document.getElementById('orgPanel')?.contains(document.activeElement)) els.editor?.focus();
    layoutOverlay();
    if (willOpen) layoutPanel();
  }

  function onOpen() {
    layoutOverlay();
    layoutPanel();
    buildOverlay();
    renderList();
    const handler = debounce(() => { buildOverlay(); renderList(); }, 120);
    els.editor.addEventListener('input', handler);
    detachInput = () => els.editor.removeEventListener('input', handler);
    window.addEventListener('resize', () => { layoutOverlay(); layoutPanel(); }, { passive:true });
    els.toggleBtn?.addEventListener('click', togglePanel);
    els.handleBtn?.addEventListener('click', togglePanel);
    els.editBtn?.addEventListener('click', () => {
      openPanel();
      const card = els?.modalCard || document.querySelector('#editorModal .modal-card');
      const panel = document.getElementById('orgPanel');
      card?.classList.add('edit-mode');
      panel?.classList.add('editing');
      if (els.editorBox) els.editorBox.hidden = false;
      dictToTextarea();
    });
    els.cancelBtn?.addEventListener('click', () => {
      const card = els?.modalCard || document.querySelector('#editorModal .modal-card');
      const panel = document.getElementById('orgPanel');
      card?.classList.remove('edit-mode');
      panel?.classList.remove('editing');
      if (els.editorBox) els.editorBox.hidden = true;
    });
    els.saveBtn?.addEventListener('click', () => {
      textareaToDict();
      // Unificar grupos al guardar
      dict = unifyDictionary(dict);
      saveDictLocal(dict);
      const card = els?.modalCard || document.querySelector('#editorModal .modal-card');
      const panel = document.getElementById('orgPanel');
      card?.classList.remove('edit-mode');
      panel?.classList.remove('editing');
      els.editorBox && (els.editorBox.hidden = true);
      const newMap = new Map(); for (const d of dict) { if (colorMap.has(d.name)) newMap.set(d.name, colorMap.get(d.name)); else newMap.set(d.name, newMap.size % 6); } colorMap = newMap;
      buildOverlay(); renderList();
    });
    // Descargar .txt del diccionario (desde textarea si está abierto, si no desde dict)
    els.downloadBtn?.addEventListener('click', () => {
      let text = '';
      if (els.editorBox && !els.editorBox.hidden && els.textarea) {
        text = els.textarea.value.trim();
      } else {
        text = dictToPlainText();
      }
      const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'diccionario-organos.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });
  }
  function onClose() {
    if (detachInput) detachInput(); detachInput = null;
    // No removemos el listener anónimo; no es crítico para este flujo
    if (els?.overlay) els.overlay.innerHTML = '';
    if (els?.list) els.list.innerHTML = '';
  }

  function init(options) {
    els = options.els || options;
    colorIndex = options.colorIndex;
    dict = Array.isArray(options.dict) ? options.dict : loadDict();
    // Unificar al iniciar
    dict = unifyDictionary(dict);
    colorMap = new Map(); for (const d of dict) if (!colorMap.has(d.name)) colorMap.set(d.name, colorMap.size % 6);
  }

  return { init, onOpen, onClose, highlightEditor: buildOverlay, rescanAndRenderList: renderList, jumpToOrgan, openPanel, closePanel };
})();
