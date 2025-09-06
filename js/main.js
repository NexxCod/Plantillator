/* ---------------- Persistencia de plantillas ---------------- */
const STORAGE_KEY = "comparador_plantillas_v1";

function loadTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch (e) {
    console.warn("No se pudo leer plantillas:", e);
    return {};
  }
}

function saveTemplates(obj) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    showToast("Error al guardar plantillas: " + e);
  }
}

let templates = loadTemplates();

/* ---------------- Utilidades de normalización y similitud ---------------- */

// Normaliza: NFKC, quita diacríticos (NFD), minúsculas, compacta espacios/saltos
function normalizeForCompare(s) {
  const str = (s || "").normalize("NFKC");
  const noDiacritics = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return noDiacritics
    .toLowerCase()
    .replace(/[ \t\r]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/([,.;:!?…])(?=\S)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ignora saltos de línea (los vuelve espacio)
function normalizeFlat(s) {
  return normalizeForCompare(s).replace(/\n+/g, " ");
}

// Tokeniza en letras/números tras normalizar
function tokens(s) {
  const t = normalizeForCompare(s);
  const arr = t.match(/[\p{L}\p{N}]+/gu) || [];
  return arr;
}

function tokenBigrams(toks) {
  const out = [];
  for (let i = 0; i < toks.length - 1; i++)
    out.push(toks[i] + " " + toks[i + 1]);
  return out;
}

function jaccard(aSet, bSet) {
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const denom = aSet.size + bSet.size - inter;
  return denom ? inter / denom : 1;
}

// Puntaje de similitud (palabras + bigramas; más peso a bigramas)
function simScore(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  const A = new Set(ta), B = new Set(tb);
  const JA = jaccard(A, B);

  const Aa = new Set(tokenBigrams(ta)), Bb = new Set(tokenBigrams(tb));
  const JB = jaccard(Aa, Bb);

  return 0.4 * JA + 0.6 * JB;
}

// Cobertura direccional (si una es la otra con “colita”, debe dar alto)
function coverageContain(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const A = new Set(ta), B = new Set(tb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return Math.max(inter / A.size, inter / B.size);
}

// Umbrales base (ajustables)
const SIM_THRESHOLD_SENT = 0.9; // oraciones
const COVERAGE_THRESHOLD = 0.9; // contenimiento

function approxEqual(a, b) {
  const af = normalizeFlat(a), bf = normalizeFlat(b);
  if (af === bf) return true; // iguales tras normalización
  if (coverageContain(af, bf) >= COVERAGE_THRESHOLD) return true; // contenimiento alto
  return simScore(a, b) >= SIM_THRESHOLD_SENT; // similitud por Jaccard/bigramas
}

/* ---------------- Segmentación de oraciones ---------------- */

const sentSegmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("es", { granularity: "sentence" })
    : null;

function splitSentences(paragraph) {
  const text = paragraph || "";
  if (!text.trim()) return [text];
  if (sentSegmenter) {
    const segs = [...sentSegmenter.segment(text)];
    return segs.map((s) => text.slice(s.index, s.index + s.segment.length));
  }
  // Fallback regex
  const re = /([^.!?…\n\r]+(?:[.!?…]+)?(?:\s+|$))/gu;
  const parts = text.match(re);
  return parts ? parts : [text];
}

/* ---------------- División de párrafos (por bloques) ---------------- */

function splitParagraphs(text) {
  // Bloques separados por >=1 línea en blanco; dentro del bloque se permiten \n
  const t = (text || "").replace(/\r\n/g, "\n").trimEnd();
  if (!t) return [];
  const blocks = t.split(/\n\s*\n/g);
  return blocks;
}

/* ---------------- Diff de oraciones (LCS con igualdad aproximada) ---------------- */

function diffSentences(aArr, bArr) {
  const n = aArr.length, m = bArr.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (approxEqual(aArr[i - 1], bArr[j - 1]))
        dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && approxEqual(aArr[i - 1], bArr[j - 1])) {
      ops.push({ tag: "equal", a: [i - 1, i], b: [j - 1, j] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ tag: "insert", a: [i, i], b: [j - 1, j] });
      j--;
    } else {
      ops.push({ tag: "delete", a: [i - 1, i], b: [j, j] });
      i--;
    }
  }
  ops.reverse();
  // Compacta
  const merged = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (
      last && last.tag === op.tag &&
      last.a[1] === op.a[0] &&
      last.b[1] === op.b[0]
    ) {
      last.a[1] = op.a[1];
      last.b[1] = op.b[1];
    } else merged.push({ ...op });
  }
  // Replaces
  const finalOps = [];
  for (let k = 0; k < merged.length; k++) {
    const cur = merged[k], next = merged[k + 1];
    if (cur && next && cur.tag === "delete" && next.tag === "insert") {
      finalOps.push({ tag: "replace", a: cur.a, b: next.b });
      k++;
    } else finalOps.push(cur);
  }
  return finalOps;
}

/* ---------- Comparación por oraciones + contadores de frases ---------- */

function compareBySentences(templatePar, reportPar) {
  const a = splitSentences(templatePar);
  const b = splitSentences(reportPar);
  const ops = diffSentences(a, b);

  let out = "";
  let changed = false;

  // Métricas por bloque
  let reportSentences = 0;      // frases del informe (lado b)
  let templateSentences = 0;    // frases de la plantilla (lado a)
  let changedSentences = 0;     // número de frases consideradas "cambiadas"

  for (const op of ops) {
    const [ai0, ai1] = op.a;
    const [bj0, bj1] = op.b;

    const aCount = ai1 - ai0; // # oraciones plantilla involucradas
    const bCount = bj1 - bj0; // # oraciones informe involucradas

    templateSentences += aCount;
    reportSentences += bCount;

    if (op.tag === "equal") {
      out += b.slice(bj0, bj1).join("");
      // unchanged
    } else if (op.tag === "insert" || op.tag === "replace") {
      const seg = b.slice(bj0, bj1).join("");
      out += seg.toUpperCase();
      changed = true;
      changedSentences += bCount; // inserciones/reemplazos cuentan del lado del informe
    } else if (op.tag === "delete") {
      changed = true;
      // deletions: cuentan como cambio aunque no haya frases del informe en ese tramo
      changedSentences += aCount;
    }
  }

  // Denominador robusto: máximo entre ambos lados (evita 100% artificial)
  const denom = Math.max(reportSentences, templateSentences) || 1;

  return {
    text: out,
    changed,
    stats: {
      reportSentences,
      templateSentences,
      changedSentences,
      denom,
    },
  };
}

/* -------- Alineación por párrafos: SIEMPRE comparamos con el mejor match -------- */

function bestMatchIndex(tpars, rpar, startIdx, win = 8) {
  const rFlat = normalizeFlat(rpar);
  let bestIdx = -1, best = -1;
  const i0 = Math.max(0, startIdx - win), i1 = Math.min(tpars.length - 1, startIdx + win);
  for (let i = i0; i <= i1; i++) {
    const s1 = simScore(tpars[i], rpar);
    const s2 = simScore(normalizeFlat(tpars[i]), rFlat);
    const s = Math.max(s1, s2);
    if (s > best) {
      best = s;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) {
    for (let i = 0; i < tpars.length; i++) {
      const s = simScore(normalizeFlat(tpars[i]), rFlat);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

function diffTemplateVsReportByParagraphs(templateText, reportText) {
  const tpars = splitParagraphs(templateText);
  const rpars = splitParagraphs(reportText);

  const out = [];
  let cursor = 0; // posición esperada en plantilla

  // Métricas globales a nivel de oraciones
  let totalReportSent = 0;
  let totalTemplateSent = 0;
  let totalChangedSent = 0;
  let totalDenom = 0;

  for (let k = 0; k < rpars.length; k++) {
    const r = rpars[k];
    if (!r.trim()) {
      out.push(r);
      continue;
    }

    let t = cursor < tpars.length ? tpars[cursor] : "";

    // Si por índice lucen iguales (a plano), usa ese
    if (t && approxEqual(normalizeFlat(t), normalizeFlat(r))) {
      const res = compareBySentences(t, r);
      out.push(res.text);
      totalReportSent   += res.stats.reportSentences;
      totalTemplateSent += res.stats.templateSentences;
      totalChangedSent  += res.stats.changedSentences;
      totalDenom        += res.stats.denom;
      cursor++;
      continue;
    }

    // Elige SIEMPRE el mejor match
    let idx = -1;
    if (tpars.length) {
      idx = bestMatchIndex(tpars, r, cursor, 8);
      if (idx < 0 && tpars.length) idx = Math.min(cursor, tpars.length - 1);
      t = idx >= 0 ? tpars[idx] : "";
    } else {
      t = "";
    }

    const res = compareBySentences(t, r);
    out.push(res.text);
    totalReportSent   += res.stats.reportSentences;
    totalTemplateSent += res.stats.templateSentences;
    totalChangedSent  += res.stats.changedSentences;
    totalDenom        += res.stats.denom;

    if (idx >= 0) cursor = Math.max(cursor, idx + 1);
  }

  // % cambio global por oraciones
  const pct = totalDenom
    ? Math.round((totalChangedSent / totalDenom) * 10000) / 100
    : 0;

  return {
    text: out.join("\n\n"),
    metrics: {
      total_frases_informe: totalReportSent,
      total_frases_plantilla: totalTemplateSent,
      frases_con_cambios: totalChangedSent,
      porcentaje_cambio_frases: pct,
    },
  };
}

/* ---------------- UI helpers ---------------- */
const el = (s) => document.querySelector(s);

/* ---------- Persistencia del último estado (plantilla + informe) ---------- */
const LAST_STATE_KEY = "comparador_last_state_v1";

function saveLastState(){
  try{
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify({
      template: templateTxt?.value || "",
      report: reportTxt?.value || ""
    }));
  }catch(e){ /* noop */ }
}

function restoreLastState(){
  try{
    const raw = localStorage.getItem(LAST_STATE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(data && typeof data === "object"){
      if(typeof data.template === "string") templateTxt.value = data.template;
      if(typeof data.report === "string") reportTxt.value = data.report;
    }
  }catch(e){ /* noop */ }
}

/* ---------- Toast minimalista ---------- */
function showToast(msg, ms=1800){
  const host = document.getElementById("toast");
  if(!host) return alert(msg); // fallback si no existe el contenedor

  const div = document.createElement("div");
  div.className = "toast-bubble";
  div.textContent = msg;
  host.appendChild(div);

  // animar entrada
  requestAnimationFrame(()=> div.classList.add("show"));

  // autodestruir
  setTimeout(()=>{
    div.classList.remove("show");
    setTimeout(()=> div.remove(), 250);
  }, ms);
}

const tplList    = el("#tplList");
const templateTxt= el("#templateTxt");
const reportTxt  = el("#reportTxt");
const outputTxt  = el("#outputTxt");
const mTotal     = el("#mTotal");
const mChanged   = el("#mChanged");
const mPct       = el("#mPct");
const copyBtn    = el("#copyBtn");

/* ------ Habilitar/Deshabilitar botón Copiar según contenido de salida ------ */
function refreshCopyState(){
  if (!copyBtn) return;
  copyBtn.disabled = !outputTxt.value.trim();
}

/* Guardado automático al escribir */
if (templateTxt) templateTxt.addEventListener("input", ()=>{ saveLastState(); });
if (reportTxt)   reportTxt.addEventListener("input", ()=>{ saveLastState(); });
if (outputTxt)   outputTxt.addEventListener("input", refreshCopyState);

/* ---------------- Render lista de plantillas ---------------- */
function renderTemplateList() {
  tplList.innerHTML = "";
  const names = Object.keys(templates).sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
  if (names.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No hay plantillas guardadas aún.";
    tplList.appendChild(empty);
    return;
  }
  names.forEach((name) => {
    const row = document.createElement("div");
    row.className = "tpl-row";
    const lab = document.createElement("div");
    lab.className = "name";
    lab.textContent = name;

    const useBtn = document.createElement("button");
    useBtn.textContent = "Usar";
    useBtn.onclick = () => {
      templateTxt.value = templates[name] || "";
      saveLastState();
      showToast(`Plantilla “${name}” aplicada`);
    };

    const renBtn = document.createElement("button");
    renBtn.textContent = "Renombrar";
    renBtn.onclick = () => {
      const newName = prompt("Nuevo nombre de la plantilla:", name);
      if (!newName || newName === name) return;
      if (templates[newName]) {
        showToast("Ya existe una plantilla con ese nombre.");
        return;
      }
      templates[newName] = templates[name];
      delete templates[name];
      saveTemplates(templates);
      renderTemplateList();
      showToast(`Renombrada a “${newName}”`);
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "Eliminar";
    delBtn.onclick = () => {
      if (confirm(`¿Eliminar plantilla "${name}"?`)) {
        delete templates[name];
        saveTemplates(templates);
        renderTemplateList();
        showToast(`Plantilla “${name}” eliminada`);
      }
    };

    row.appendChild(lab);
    row.appendChild(useBtn);
    row.appendChild(renBtn);
    row.appendChild(delBtn);
    tplList.appendChild(row);
  });
}

/* ===================== Editor de salida (modal) ===================== */
const editorModal = document.getElementById("editorModal");
const edEditor     = document.getElementById("edEditor");
const edUseBase    = document.getElementById("edUseBase");
const edNormalize  = document.getElementById("edNormalize");
const edCopy       = document.getElementById("edCopy");
const edSaveBack   = document.getElementById("edSaveBack");
const edClose      = document.getElementById("edClose");
const edKeepHeads  = document.getElementById("edKeepHeads");

let edBaseText = "";            // Texto "original" para detectar cambios
let edBaseAcronyms = new Set(); // Siglas detectadas del original

// Nueva: sesión del editor para persistir entre aperturas
let edSession = {
  sourceOutput: null,  // snapshot de outputTxt.value cuando se abrió
  html: "",            // último HTML del editor (con <mark>/<strong>)
  baseText: "",        // base para diff
  acronyms: new Set(), // siglas detectadas
};

let lastInputType = ""; // para detectar Enter

/* Cursor helpers dentro del editor */
function getCaretOffset(root){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount===0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}
function setCaretOffset(root, offset){
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let len = 0, node;
  while((node = walker.nextNode())){
    const next = len + node.nodeValue.length;
    if(offset <= next){
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, Math.max(0, offset - len));
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      return;
    }
    len = next;
  }
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
}

/* Tokenización y diff por tokens */
function tokenize(str){
  return (str || "").match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+|\s+/gu) || [];
}
function diffTokens(a, b){
  const n=a.length, m=b.length;
  const dp = Array.from({length:n+1}, ()=>Array(m+1).fill(0));
  for(let i=1;i<=n;i++){
    for(let j=1;j<=m;j++){
      dp[i][j] = (a[i-1]===b[j-1]) ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
    }
  }
  const ops=[]; let i=n,j=m;
  while(i>0 || j>0){
    if(i>0&&j>0&&a[i-1]===b[j-1]){ ops.push({tag:'equal',i0:i-1,i1:i,j0:j-1,j1:j}); i--; j--; }
    else if(j>0 && (i===0 || dp[i][j-1]>=dp[i-1][j])){ ops.push({tag:'insert',i0:i,i1:i,j0:j-1,j1:j}); j--; }
    else { ops.push({tag:'delete',i0:i-1,i1:i,j0:j,j1:j}); i--; }
  }
  return ops.reverse();
}
const HTMLESC = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const esc = s => s.replace(/[&<>"']/g, c=>HTMLESC[c]);

/* Siglas desde original (inteligente) */
function extractAcronymsSmart(text){
  const WL = new Set(['UH','VCI','VBI','VMS','TC','RM','TAC','T1','T2','FOV','SUV','CTA','MRA','MIP','DWI','ADC','IV','VO','HCC','BIRADS','PI-RADS','PI RADS','LIRADS','LI-RADS']);
  const found = new Set();
  const matches = (text || "").match(/\b[0-9A-ZÁÉÍÓÚÜÑ-]{2,}\b/g) || [];
  for (const w of matches){
    const up = w.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
    const hasDigit = /\d/.test(up);
    if (WL.has(up) || hasDigit) found.add(up);
  }
  return found;
}

/* Sentence case + encabezados + siglas (normalizar) */
function toInformeCase(text, keepHeadings, acronyms){
  const lf = text.replace(/\r\n/g,"\n");
  const lines = lf.split("\n");
  return lines.map(line=>{
    const raw = line.trimEnd();
    if(keepHeadings && /:\s*$/.test(raw)) return raw.toUpperCase();
    let s = raw.toLowerCase();
    s = s.replace(/(^|[.!?…]\s+)(\p{L})/gu, (m,p,chr)=> p + chr.toUpperCase());
    if(acronyms && acronyms.size){
      s = s.replace(/\b([\p{L}ÁÉÍÓÚÜÑ]{2,})\b/gu, (m,word)=>{
        const up = word.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
        return acronyms.has(up) ? up : m;
      });
    }
    s = s.replace(/\b(mm|cm|ml|kg|mg|μm)\b/gi, t=>t.toLowerCase());
    s = s.replace(/\b(UH|VCI|VBI|VMS|TC|RM|TAC|T2|T1|FOV|CTA|MRA|MIP|DWI|ADC)\b/gi, t=>t.toUpperCase());
    return s;
  }).join("\n");
}

/* Render con control de cambios: <strong> para texto de mayúsculas base; <mark.add> para inserciones */
function renderEditorDiff(){
  const caret = getCaretOffset(edEditor);
  const base = edBaseText;
  const currPlain = edEditor.innerText; // preserva saltos de línea

  const A = tokenize(base);
  const B = tokenize(currPlain);
  const ops = diffTokens(A,B);

  let html = "";
  for(const op of ops){
    const {i0,i1,j0,j1,tag} = op;
    if(tag==='equal'){
      const seg = B.slice(j0,j1).join('');
      html += esc(seg);
    }else if(tag==='insert'){
      const seg = B.slice(j0,j1).join('');
      html += `<mark class="add">${esc(seg)}</mark>`;
    }else if(tag==='delete'){
      // opcional: visualizar borrados
      // html += `<del class="del">${esc(A.slice(i0,i1).join(''))}</del>`;
    }
  }
  edEditor.innerHTML = html || "";
  setCaretOffset(edEditor, caret);

  // persistir html en la sesión
  edSession.html = edEditor.innerHTML;
}

/* Detecta frases en MAYÚSCULAS y las pone en <strong> en la primera carga */
function boldUppercaseSentences(plainText){
  const segs = (plainText || "").split(/(\n{2,})/); // conserva bloques
  const out = segs.map(chunk=>{
    if(/\n{2,}/.test(chunk)) return chunk; // conservar saltos dobles tal cual
    const parts = chunk.match(/[^.!?…\n]+[.!?…]*|\n+/gu) || [chunk];
    return parts.map(p=>{
      const letters = p.match(/\p{L}/gu)?.length || 0;
      const isUpper = letters>0 && p === p.toUpperCase();
      return isUpper ? `<strong>${esc(p)}</strong>` : esc(p);
    }).join('');
  }).join('');
  return out;
}

/* Abrir/Cerrar modal con persistencia */
function openEditorWith(textFromOutput){
  editorModal.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";

  const src = textFromOutput || "";

  // Si la salida no cambió desde la última sesión, reusar HTML/base actuales
  if(edSession.sourceOutput === src && edSession.html){
    edBaseText     = edSession.baseText || src;
    edBaseAcronyms = edSession.acronyms || new Set();
    edEditor.innerHTML = edSession.html;
    edEditor.focus();
    return;
  }

  // Nueva sesión (salida cambió o nunca se abrió)
  edSession.sourceOutput = src;

  edBaseText     = src;
  edBaseAcronyms = extractAcronymsSmart(edBaseText);

  // Carga inicial: negrita para frases que ya venían en MAYÚSCULAS
  edEditor.innerHTML = boldUppercaseSentences(edBaseText);

  // Primer render diff (sin cambios aún)
  renderEditorDiff();

  // Persistir snapshot inicial
  edSession.baseText = edBaseText;
  edSession.acronyms = edBaseAcronyms;
  edSession.html     = edEditor.innerHTML;

  edEditor.focus();
}
function closeEditor(){
  // NO limpiamos la sesión: se reabrirá tal cual quedó
  editorModal.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}

/* ---------------- Eventos barra superior ---------------- */
el("#fileTpl").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    templateTxt.value = text;
    saveLastState();
    showToast("Plantilla cargada");
  } catch (e) {
    showToast("No se pudo leer el archivo: " + e);
  }
  ev.target.value = "";
});

el("#saveTplBtn").addEventListener("click", () => {
  const content = templateTxt.value.trimEnd();
  if (!content.trim()) {
    showToast("La plantilla está vacía.");
    return;
  }
  const defaultName = "Plantilla nueva";
  const name = prompt("Nombre de la plantilla:", defaultName);
  if (!name) return;
  if (templates[name] && !confirm(`"${name}" ya existe. ¿Sobrescribir?`)) return;
  templates[name] = content;
  saveTemplates(templates);
  renderTemplateList();
  showToast(`Plantilla “${name}” guardada`);
});

/* NUEVO: borrar contenido de la plantilla actual (botón clearTplBtn) */
const clearTplBtn = el("#clearTplBtn");
if (clearTplBtn) {
  clearTplBtn.addEventListener("click", ()=>{
    templateTxt.value = "";
    saveLastState();
    showToast("Plantilla borrada");
  });
}

el("#compareBtn").addEventListener("click", () => {
  const { text, metrics } = diffTemplateVsReportByParagraphs(
    templateTxt.value,
    reportTxt.value
  );
  outputTxt.value = text;
  // Actualiza métricas (ahora por oraciones)
  mTotal.textContent   = metrics.total_frases_informe;
  mChanged.textContent = metrics.frases_con_cambios;
  mPct.textContent     = metrics.porcentaje_cambio_frases + "%";

  refreshCopyState();
  saveLastState();
  showToast("Comparación lista");
});

el("#copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputTxt.value);
    showToast("Salida copiada al portapapeles");
  } catch (e) {
    // Fallback
    outputTxt.select();
    document.execCommand("copy");
    showToast("Salida copiada (método alternativo)");
  }
});

el("#clearReportBtn").addEventListener("click", () => {
  reportTxt.value = "";
  outputTxt.value = ""; // limpia la salida
  mTotal.textContent   = 0;     // reinicia métricas
  mChanged.textContent = 0;
  mPct.textContent     = "0%";
  refreshCopyState();
  saveLastState();
  reportTxt.focus(); // cursor listo
  showToast("Informe y salida limpiados");
});

// Abrir editor desde la salida
const editOutBtn = document.getElementById("editOutBtn");
if(editOutBtn){
  editOutBtn.addEventListener("click", ()=>{
    const src = (outputTxt?.value || "").trimEnd();
    if(!src){
      showToast("No hay salida para editar.");
      return;
    }
    openEditorWith(src);
  });
}

// Cerrar modal (X o clic en backdrop)
if(edClose) edClose.addEventListener("click", closeEditor);
if(editorModal){
  editorModal.addEventListener("click", (ev)=>{
    if(ev.target?.dataset?.close) closeEditor();
  });
}

// Capturar tipo de input (para Enter)
if(edEditor){
  edEditor.addEventListener("beforeinput", (e)=>{
    lastInputType = e.inputType || "";
  });

  edEditor.addEventListener("input", ()=>{
    // Si es Enter (insertParagraph), dejar que el navegador inserte la línea
    // y renderizar en el siguiente tick para no mover el cursor.
    if(lastInputType === "insertParagraph"){
      lastInputType = "";
      setTimeout(renderEditorDiff, 0);
      return;
    }
    // Para otras teclas, render con un leve debounce
    if(edEditor._renderTimer) cancelAnimationFrame(edEditor._renderTimer);
    edEditor._renderTimer = requestAnimationFrame(renderEditorDiff);
  });
}

// Usar texto actual como "original" (congela baseline)
if(edUseBase){
  edUseBase.addEventListener("click", ()=>{
    const plain = edEditor.innerText;
    edBaseText = plain;
    edBaseAcronyms = extractAcronymsSmart(edBaseText);
    edSession.baseText = edBaseText;
    edSession.acronyms = edBaseAcronyms;
    renderEditorDiff();
    showToast("Texto actual fijado como original");
  });
}

// Normalizar (sentence-case, encabezados y siglas)
if(edNormalize){
  edNormalize.addEventListener("click", ()=>{
    const keep = edKeepHeads?.checked ?? true;
    const plain = edEditor.innerText;
    const norm = toInformeCase(plain, keep, edBaseAcronyms);
    edEditor.textContent = norm; // limpio
    renderEditorDiff();          // recalcula diffs vs base
    showToast("Texto normalizado");
  });
}

// Copiar texto plano del editor
if(edCopy){
  edCopy.addEventListener("click", async ()=>{
    const txt = edEditor.innerText;
    try{
      await navigator.clipboard.writeText(txt);
      showToast("Texto copiado");
    }catch(e){
      const r=document.createRange(); r.selectNodeContents(edEditor);
      const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
      document.execCommand('copy'); s.removeAllRanges();
      showToast("Texto copiado (alternativo)");
    }
  });
}

// Guardar cambios a la salida y cerrar
if(edSaveBack){
  edSaveBack.addEventListener("click", ()=>{
    const txt = edEditor.innerText;
    outputTxt.value = txt;
    refreshCopyState();
    saveLastState();
    // persistimos el HTML actual
    edSession.html = edEditor.innerHTML;
    showToast("Cambios guardados en la salida");
    closeEditor();
  });
}

/* ---------------- Init ---------------- */
restoreLastState();
renderTemplateList();
refreshCopyState();
