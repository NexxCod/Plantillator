import {
  loadTemplates,
  saveTemplates,
  saveLastState,
  restoreOnLoad,
  getLastState,
} from "./core/storage.js";
import { diffTemplateVsReportByParagraphs } from "./core/diff.js";
import { loadSettings, saveSettings } from "./core/config.js";
import { el } from "./ui/dom.js";
import { showToast } from "./ui/toast.js";
import { renderTemplateList } from "./ui/templates.js";
import { buildEditor } from "./ui/editor.js";
import {
  createSpeechController,
  insertAtCursorTextarea,
  insertAtCaretContentEditable,
} from "./ui/speech.js";
let speechReportRef = null;
let speechEditorRef = null;

// DOM refs
const tplList = el("#tplList");
const templateTxt = el("#templateTxt");
const reportTxt = el("#reportTxt");
const outputTxt = el("#outputTxt");
const mTotal = el("#mTotal");
const mChanged = el("#mChanged");
const mPct = el("#mPct");
const copyBtn = el("#copyBtn");

// Estado
let templates = loadTemplates();
let AppConfig = loadSettings();

// Helpers UI
function refreshCopyState() {
  if (!copyBtn) return;
  copyBtn.disabled = !outputTxt?.value?.trim();
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
      if (templates[newName]) {
        showToast("Ya existe una plantilla con ese nombre.");
        return;
      }
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
if (templateTxt)
  templateTxt.addEventListener("input", () =>
    saveLastState(templateTxt, reportTxt)
  );
if (reportTxt)
  reportTxt.addEventListener("input", () =>
    saveLastState(templateTxt, reportTxt)
  );
if (outputTxt) outputTxt.addEventListener("input", refreshCopyState);

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
  if (!content.trim()) {
    showToast("La plantilla está vacía.");
    return;
  }
  const defaultName = "Plantilla nueva";
  const name = prompt("Nombre de la plantilla:", defaultName);
  if (!name) return;
  if (templates[name] && !confirm(`"${name}" ya existe. ¿Sobrescribir?`))
    return;
  templates[name] = content;
  saveTemplates(templates, showToast);
  doRenderTemplateList();
  showToast(`Plantilla “${name}” guardada`);
});

const clearTplBtn = el("#clearTplBtn");
if (clearTplBtn) {
  clearTplBtn.addEventListener("click", () => {
    templateTxt.value = "";
    saveLastState(templateTxt, reportTxt);
    showToast("Plantilla borrada");
  });
}

el("#compareBtn")?.addEventListener("click", () => {
  const { text, metrics } = diffTemplateVsReportByParagraphs(
    templateTxt.value,
    reportTxt.value
  );
  outputTxt.innerHTML = text;
  mTotal.textContent = metrics.total_frases_informe;
  mChanged.textContent = metrics.frases_con_cambios;
  mPct.textContent = metrics.porcentaje_cambio_frases + "%";
  refreshCopyState();
  saveLastState(templateTxt, reportTxt);
  showToast("Comparación lista");
});

el("#copyBtn")?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputTxt.innerText);
    showToast("Salida copiada al portapapeles");
  } catch (e) {
    showToast("Error al copiar. Intenta seleccionar y copiar manualmente.");
  }
});

el("#clearReportBtn")?.addEventListener("click", () => {
  reportTxt.value = "";
  outputTxt.innerHTML = "";
  mTotal.textContent = 0;
  mChanged.textContent = 0;
  mPct.textContent = "0%";
  refreshCopyState();
  saveLastState(templateTxt, reportTxt);
  reportTxt.focus();
  showToast("Informe y salida limpiados");
});

el("#recoverReportBtn")?.addEventListener("click", () => {
  const lastState = getLastState();
  if (lastState?.report) {
    reportTxt.value = lastState.report;
    saveLastState(templateTxt, reportTxt); // Actualiza el estado por si acaso
    showToast("Último informe recuperado");
  } else {
    showToast("No se encontró un informe para recuperar");
  }
});

// Editor modal
const editorModal = document.getElementById("editorModal");
const edEditor = document.getElementById("edEditor");
const edUseBase = document.getElementById("edUseBase");
const edNormalize = document.getElementById("edNormalize");
const edCopy = document.getElementById("edCopy");
const edSaveBack = document.getElementById("edSaveBack");
const edClose = document.getElementById("edClose");
const edKeepHeads = document.getElementById("edKeepHeads");

const { openEditorWith } = buildEditor({
  editorModal,
  edEditor,
  edUseBase,
  edNormalize,
  edCopy,
  edSaveBack,
  edClose,
  edKeepHeads,
  outputTxt,
  AppConfig,
});

document.getElementById("editOutBtn")?.addEventListener("click", () => {
  const src = (outputTxt?.innerHTML || "").trimEnd();
  if (!src) {
    showToast("No hay salida para editar.");
    return;
  }
  openEditorWith(src);
});

/* =================== Dictado Web Speech — REPORT TXT =================== */
(function initReportDictation() {
  const btn = document.getElementById("micReportBtn");
  if (!btn) return;

  const dot = btn.querySelector(".mic-dot");

  const correctionMap = [
    ["birads", "BI-RADS"],
    ["lirads", "LI-RADS"],
    ["li rads", "LI-RADS"],
    ["hipo denso", "hipodenso"],
    ["hiper denso", "hiperdenso"],
    ["hipo intenso", "hipointenso"],
    ["hiper intenso", "hiperintenso"],
    ["hounsfield", "Hounsfield"],
    ["hu", "HU"],
    ["colédoco", "colédoco"],
    ["coledoco", "colédoco"],
    ["milimetros", "mm"],
    ["milímetros", "mm"],
    ["centimetros", "cm"],
    ["centímetros", "cm"],
    ["t 1", "T1"],
    ["t 2", "T2"],
    ["dwi", "DWI"],
    ["adc", "ADC"],
    ["suv", "SUV"],
    ["vc i", "VCI"],
    ["vb i", "VBI"],
  ];

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
    correctionMap,
    onPartial: (txt) => {
      // No insertamos interinos en el textarea para no “ensuciar” el undo.
      // (Si quieres previsualizar interinos, podrías mostrarlos en un badge flotante)
    },
    onFinal: (txt) => {
      // Inserta el final en el caret del textarea
      insertAtCursorTextarea(
        reportTxt,
        (reportTxt?.value?.endsWith(" ") ? "" : " ") + txt
      );
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
(function initEditorDictation() {
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
      insertAtCaretContentEditable(
        edEditor,
        (edEditor?.innerText?.endsWith(" ") ? "" : " ") + txt
      );
      // Dispara tu render de diffs en el siguiente frame (si lo necesitas)
      if (edEditor && edEditor._renderTimer)
        cancelAnimationFrame(edEditor._renderTimer);
      edEditor._renderTimer = requestAnimationFrame(() => {
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
const edMicBtn = document.getElementById("edMicBtn");
const edMicDot = edMicBtn?.querySelector(".mic-dot");

// ⚠️ Guardamos las instancias de dictado creadas en los inits previos.
// Si seguiste mi MVP, expón las instancias así:

// Helpers de UI para marcar estado
function setBtnState(btn, dot, active) {
  if (!btn) return;
  btn.classList.toggle("active", !!active);
  if (dot) dot.style.display = active ? "inline-block" : "none";
}

(function initSettingsModal() {
  const modal = el("#settingsModal");
  const openBtn = el("#settingsBtn");
  const closeBtn = el("#settingsClose");
  const saveBtn = el("#settingsSave");
  const downloadBtn = el("#settingsDownloadBtn");
  const loadFileBtn = el("#settingsLoadFile");
  const wordsTxt = el("#excludedWordsTxt");
  const dictationModeToggle = el("#dictationModeToggle");

  if (!modal) return;

  const openModal = () => {
    // Carga las palabras actuales en el textarea
    wordsTxt.value = [...AppConfig.excludedWords].join("\n");
    dictationModeToggle.checked = AppConfig.dictationMode === "toggle";
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  const closeModal = () => {
    document.getElementById("settingsBtn")?.focus();
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  };

  openBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target.dataset.close) closeModal();
  });

  saveBtn?.addEventListener("click", () => {
    const words = wordsTxt.value
      .split("\n")
      .map((w) => w.toUpperCase().trim())
      .filter(Boolean);
    AppConfig.excludedWords = new Set(words);
    AppConfig.dictationMode = dictationModeToggle.checked ? "toggle" : "push";

    // console.log('✅ Configuración guardada en memoria:', AppConfig.excludedWords);

    saveSettings(AppConfig, showToast);
    showToast("Configuración guardada");
    closeModal();
  });

  downloadBtn?.addEventListener("click", () => {
    const dataStr = JSON.stringify(
      { excludedWords: [...AppConfig.excludedWords] },
      null,
      2
    );
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "comparador-settings.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  loadFileBtn?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let words = [];

      // Lógica para decidir el formato
      if (file.name.toLowerCase().endsWith(".json")) {
        // Si es JSON, intenta parsearlo
        const data = JSON.parse(text);
        if (data && Array.isArray(data.excludedWords)) {
          words = data.excludedWords;
          showToast(`Configuración cargada desde ${file.name}`);
        } else {
          throw new Error("El archivo JSON no tiene el formato esperado.");
        }
      } else {
        // Si no es JSON, trátalo como TXT
        words = text
          .split(/[\n,;]+/)
          .map((w) => w.trim())
          .filter(Boolean);
        showToast(`${words.length} palabras cargadas desde ${file.name}`);
      }

      // Actualiza el textarea con las palabras cargadas
      wordsTxt.value = words.join("\n");
    } catch (err) {
      showToast("Error al leer el archivo: " + err.message);
    }
    e.target.value = ""; // Resetea el input para poder cargar el mismo archivo de nuevo
  });
})();

// ===== Manual externo (help.html) en iframe =====
(function initExternalHelp(){
  const helpBtn      = document.getElementById("helpBtn");
  const helpModal    = document.getElementById("helpModal");
  const helpClose    = document.getElementById("helpClose");
  const helpFrame    = document.getElementById("helpFrame");
  const helpOpenPdf  = document.getElementById("helpOpenPdf");

  if (!helpBtn || !helpModal || !helpFrame) return;

  // 👇 Ruta correcta según tu estructura
  const HELP_URL = "./pages/help.html";

  function openHelp(){
    helpFrame.src = HELP_URL; // forzar carga siempre
    helpModal.setAttribute("aria-hidden","false");
    document.body.style.overflow = "hidden";
  }
  function closeHelp(){
    helpModal.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
  }

  helpFrame.addEventListener("error", () => {
    alert("No se pudo cargar el manual (pages/help.html). Revisa la ruta o el servidor.");
  });

  helpBtn.addEventListener("click", openHelp);
  helpClose?.addEventListener("click", closeHelp);
  helpModal.addEventListener("click", (e)=>{ if (e.target?.dataset?.close) closeHelp(); });
  helpOpenPdf?.addEventListener("click", ()=> window.open(HELP_URL, "_blank"));
})();

// ¿Dónde dictamos? Si el editor está visible, priorízalo; si no, al informe.
function getActiveSpeechController() {
  const editorOpen = editorModal?.getAttribute("aria-hidden") === "false";
  if (editorOpen && edEditor) {
    edEditor.focus();
    return speechEditorRef;
  }
  reportTxt?.focus();
  return speechReportRef;
}

// Funciones de control principales que manejan la lógica Y la parte visual
function startDictation() {
  const speech = getActiveSpeechController();
  // Determina qué botón actualizar
  const targetBtn = speech === speechEditorRef ? edMicBtn : micReportBtn;
  const targetDot = speech === speechEditorRef ? edMicDot : micReportDot;

  if (!speech || !speech.supported) {
    showToast("Dictado no disponible en este navegador");
    return;
  }

  speech.start();
  // La función setBtnState se llamará desde el evento 'onStart' del controlador
}

function stopDictation() {
  // Detenemos ambos controladores para asegurar que todo se apague
  if (speechReportRef && speechReportRef.isRunning()) {
    speechReportRef.stop();
  }
  if (speechEditorRef && speechEditorRef.isRunning()) {
    speechEditorRef.stop();
  }
  // Los indicadores visuales se apagarán desde el evento 'onEnd' del controlador
}

let isDictationToggledOn = false;

// --- Detectores de eventos del teclado (CORREGIDOS) ---
document.addEventListener("keydown", (e) => {
  if (e.key !== "Alt" || e.repeat) return;
  e.preventDefault();

  if (AppConfig.dictationMode === "toggle") {
    // Modo Alternar: Inicia/detiene y cambia el estado
    if (isDictationToggledOn) {
      stopDictation();
    } else {
      startDictation();
    }
    isDictationToggledOn = !isDictationToggledOn;
  } else {
    // Modo Pulsar: Solo inicia
    startDictation();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key !== "Alt") return;
  e.preventDefault();

  if (AppConfig.dictationMode === "push") {
    // En modo "Pulsar", siempre detenemos al soltar.
    stopDictation();
  }
});

// Init
restoreOnLoad(templateTxt, reportTxt);
doRenderTemplateList();
refreshCopyState();
