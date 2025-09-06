import { loadTemplates, saveTemplates, saveLastState, restoreLastState } from "./core/storage.js";
import { diffTemplateVsReportByParagraphs } from "./core/diff.js";
import { el } from "./ui/dom.js";
import { showToast } from "./ui/toast.js";
import { renderTemplateList } from "./ui/templates.js";
import { buildEditor } from "./ui/editor.js";
import { createSpeechController, insertAtCursorTextarea, insertAtCaretContentEditable } from "./ui/speech.js";
let speechReportRef = null;
let speechEditorRef = null;

// DOM refs
const tplList     = el("#tplList");
const templateTxt = el("#templateTxt");
const reportTxt   = el("#reportTxt");
const outputTxt   = el("#outputTxt");
const mTotal      = el("#mTotal");
const mChanged    = el("#mChanged");
const mPct        = el("#mPct");
const copyBtn     = el("#copyBtn");

// Estado
let templates = loadTemplates();

// Helpers UI
function refreshCopyState() {
  if (!copyBtn) return;
  copyBtn.disabled = !outputTxt.value.trim();
}

// Render lista
function doRenderTemplateList() {
  renderTemplateList({
    tplList,
    templates,
    onUse: (name) => {
      templateTxt.value = templates[name] || "";
      saveLastState(templateTxt, reportTxt);
      showToast(`Plantilla “${name}” aplicada`);
    },
    onRename: (name) => {
      const newName = prompt("Nuevo nombre de la plantilla:", name);
      if (!newName || newName === name) return;
      if (templates[newName]) { showToast("Ya existe una plantilla con ese nombre."); return; }
      templates[newName] = templates[name];
      delete templates[name];
      saveTemplates(templates, showToast);
      doRenderTemplateList();
      showToast(`Renombrada a “${newName}”`);
    },
    onDelete: (name) => {
      if (confirm(`¿Eliminar plantilla "${name}"?`)) {
        delete templates[name];
        saveTemplates(templates, showToast);
        doRenderTemplateList();
        showToast(`Plantilla “${name}” eliminada`);
      }
    },
  });
}

// Eventos de entrada (auto-guardado)
if (templateTxt) templateTxt.addEventListener("input", ()=> saveLastState(templateTxt, reportTxt));
if (reportTxt)   reportTxt.addEventListener("input",   ()=> saveLastState(templateTxt, reportTxt));
if (outputTxt)   outputTxt.addEventListener("input",   refreshCopyState);

// Botones de archivos / acciones
el("#fileTpl")?.addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    templateTxt.value = text;
    saveLastState(templateTxt, reportTxt);
    showToast("Plantilla cargada");
  } catch (e) {
    showToast("No se pudo leer el archivo: " + e);
  }
  ev.target.value = "";
});

el("#saveTplBtn")?.addEventListener("click", () => {
  const content = templateTxt.value.trimEnd();
  if (!content.trim()) { showToast("La plantilla está vacía."); return; }
  const defaultName = "Plantilla nueva";
  const name = prompt("Nombre de la plantilla:", defaultName);
  if (!name) return;
  if (templates[name] && !confirm(`"${name}" ya existe. ¿Sobrescribir?`)) return;
  templates[name] = content;
  saveTemplates(templates, showToast);
  doRenderTemplateList();
  showToast(`Plantilla “${name}” guardada`);
});

const clearTplBtn = el("#clearTplBtn");
if (clearTplBtn) {
  clearTplBtn.addEventListener("click", ()=>{
    templateTxt.value = "";
    saveLastState(templateTxt, reportTxt);
    showToast("Plantilla borrada");
  });
}

el("#compareBtn")?.addEventListener("click", () => {
  const { text, metrics } = diffTemplateVsReportByParagraphs(templateTxt.value, reportTxt.value);
  outputTxt.value = text;
  mTotal.textContent   = metrics.total_frases_informe;
  mChanged.textContent = metrics.frases_con_cambios;
  mPct.textContent     = metrics.porcentaje_cambio_frases + "%";
  refreshCopyState();
  saveLastState(templateTxt, reportTxt);
  showToast("Comparación lista");
});

el("#copyBtn")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputTxt.value);
    showToast("Salida copiada al portapapeles");
  } catch (e) {
    outputTxt.select();
    document.execCommand("copy");
    showToast("Salida copiada (método alternativo)");
  }
});

el("#clearReportBtn")?.addEventListener("click", () => {
  reportTxt.value = "";
  outputTxt.value = "";
  mTotal.textContent   = 0;
  mChanged.textContent = 0;
  mPct.textContent     = "0%";
  refreshCopyState();
  saveLastState(templateTxt, reportTxt);
  reportTxt.focus();
  showToast("Informe y salida limpiados");
});

// Editor modal
const editorModal = document.getElementById("editorModal");
const edEditor    = document.getElementById("edEditor");
const edUseBase   = document.getElementById("edUseBase");
const edNormalize = document.getElementById("edNormalize");
const edCopy      = document.getElementById("edCopy");
const edSaveBack  = document.getElementById("edSaveBack");
const edClose     = document.getElementById("edClose");
const edKeepHeads = document.getElementById("edKeepHeads");

const { openEditorWith } = buildEditor({
  editorModal, edEditor, edUseBase, edNormalize, edCopy, edSaveBack, edClose, edKeepHeads, outputTxt
});

document.getElementById("editOutBtn")?.addEventListener("click", ()=>{
  const src = (outputTxt?.value || "").trimEnd();
  if(!src){ showToast("No hay salida para editar."); return; }
  openEditorWith(src);
});


/* =================== Dictado Web Speech — REPORT TXT =================== */
(function initReportDictation(){
  const btn = document.getElementById("micReportBtn");
  if (!btn) return;

  const dot = btn.querySelector(".mic-dot");

  const speech = createSpeechController({
    lang: "es-CL",
    onStart: () => {
      btn.classList.add("active");
      if (dot) dot.style.display = "inline-block";
      showToast("Dictado iniciado (informe)");
      // Da foco al textarea para que el usuario vea el caret
      reportTxt?.focus();
    },
    onEnd: () => {
      btn.classList.remove("active");
      if (dot) dot.style.display = "none";
      showToast("Dictado detenido");
    },
    onError: (e) => {
      showToast("Dictado: " + (e?.error || "error"));
    },
    onPartial: (txt) => {
      // No insertamos interinos en el textarea para no “ensuciar” el undo.
      // (Si quieres previsualizar interinos, podrías mostrarlos en un badge flotante)
    },
    onFinal: (txt) => {
      // Inserta el final en el caret del textarea
      insertAtCursorTextarea(reportTxt, (reportTxt?.value?.endsWith(" ") ? "" : " ") + txt);
    },
  });

  if (!speech.supported) {
    btn.disabled = true;
    btn.title = "Web Speech API no soportada en este navegador";
    return;
  }

  btn.addEventListener("click", () => speech.toggle());
  speechReportRef = speech;
})();

/* =================== Dictado Web Speech — EDITOR MODAL =================== */
(function initEditorDictation(){
  const btn = document.getElementById("edMicBtn");
  if (!btn) return;
  const dot = btn.querySelector(".mic-dot");

  const speech = createSpeechController({
    lang: "es-CL",
    onStart: () => {
      btn.classList.add("active");
      if (dot) dot.style.display = "inline-block";
      showToast("Dictado iniciado (editor)");
      edEditor?.focus();
    },
    onEnd: () => {
      btn.classList.remove("active");
      if (dot) dot.style.display = "none";
      showToast("Dictado detenido");
    },
    onError: (e) => {
      showToast("Dictado: " + (e?.error || "error"));
    },
    onPartial: (txt) => {
      // Muestra interinos como texto tenue (opcional). Para MVP, no los pintamos.
      // Podrías crear un overlay si lo deseas.
    },
    onFinal: (txt) => {
      // Inserta en el caret del contenteditable (texto plano)
      insertAtCaretContentEditable(edEditor, (edEditor?.innerText?.endsWith(" ") ? "" : " ") + txt);
      // Dispara tu render de diffs en el siguiente frame (si lo necesitas)
      if (edEditor && edEditor._renderTimer) cancelAnimationFrame(edEditor._renderTimer);
      edEditor._renderTimer = requestAnimationFrame(()=> {
        // Forzamos un evento input para que tu editor recalcule cambios
        edEditor.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
  });

  if (!speech.supported) {
    btn.disabled = true;
    btn.title = "Web Speech API no soportada en este navegador";
    return;
  }

  btn.addEventListener("click", () => {
    // Asegura que el modal esté abierto para dictar
    const hidden = editorModal?.getAttribute("aria-hidden");
    if (hidden === "true") {
      showToast("Abre el editor para dictar en él");
      return;
    }
    speech.toggle();
  });
  speechEditorRef = speech;
})();

/* ========= Atajos de teclado: Ctrl (push-to-talk) y doble Espacio (toggle) ========= */

// Referencias a los controles ya creados en el MVP
const micReportBtn = document.getElementById("micReportBtn");
const micReportDot = micReportBtn?.querySelector(".mic-dot");
const edMicBtn     = document.getElementById("edMicBtn");
const edMicDot     = edMicBtn?.querySelector(".mic-dot");

// ⚠️ Guardamos las instancias de dictado creadas en los inits previos.
// Si seguiste mi MVP, expón las instancias así:



// Helpers de UI para marcar estado
function setBtnState(btn, dot, active) {
  if (!btn) return;
  btn.classList.toggle("active", !!active);
  if (dot) dot.style.display = active ? "inline-block" : "none";
}

// ¿Dónde dictamos? Si el editor está visible, priorízalo; si no, al informe.
function pickActiveTarget(){
  const editorOpen = editorModal?.getAttribute("aria-hidden") === "false";
  if (editorOpen && edEditor) {
    edEditor.focus();
    return { kind: "editor", speech: speechEditorRef, btn: edMicBtn, dot: edMicDot };
  }
  reportTxt?.focus();
  return { kind: "report", speech: speechReportRef, btn: micReportBtn, dot: micReportDot };
}

// Arrancar/detener con señales visuales
function startDictation(){
  const t = pickActiveTarget();
  if (!t?.speech || !t.speech.supported) {
    showToast("Dictado no disponible en este navegador");
    return;
  }
  t.speech.start();
  setBtnState(t.btn, t.dot, true);
  showToast(`Dictado iniciado (${t.kind})`);
}
function stopDictation(){
  if (speechReportRef?.isRunning()) {
    speechReportRef.stop();
    setBtnState(micReportBtn, micReportDot, false);
  }
  if (speechEditorRef?.isRunning()) {
    speechEditorRef.stop();
    setBtnState(edMicBtn, edMicDot, false);
  }
  showToast("Dictado detenido");
}

/* ---------- 1) Ctrl = Push-to-talk (mantén presionado) ---------- */
let ctrlHeld = false;
document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  // Solo Ctrl sin combinaciones
  if (e.key === "Control" && !ctrlHeld) {
    ctrlHeld = true;
    startDictation();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Control" && ctrlHeld) {
    ctrlHeld = false;
    stopDictation();
  }
});




// Init
restoreLastState(templateTxt, reportTxt);
doRenderTemplateList();
refreshCopyState();
