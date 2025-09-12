// Editor modal con control de cambios (idéntico a tu lógica, modularizado)
import { showToast } from "./toast.js";

// =================== Utilidades de cursor ===================
function getCaretOffset(root) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}
function setCaretOffset(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let len = 0,
    node;
  while ((node = walker.nextNode())) {
    const next = len + node.nodeValue.length;
    if (offset <= next) {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, Math.max(0, offset - len));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    len = next;
  }
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ============== Helpers de inserción de texto plano ==============
function insertPlainTextAtSelection(text) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  // Caret después del nodo insertado
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// =================== Diff por tokens ===================
function tokenize(str) {
  return (str || "").match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+|\s+/gu) || [];
}
function diffTokens(a, b) {
  const n = a.length,
    m = b.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops = [];
  let i = n,
    j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ tag: "equal", i0: i - 1, i1: i, j0: j - 1, j1: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ tag: "insert", i0: i, i1: i, j0: j - 1, j1: j });
      j--;
    } else {
      ops.push({ tag: "delete", i0: i - 1, i1: i, j0: j, j1: j });
      i--;
    }
  }
  return ops.reverse();
}
const HTMLESC = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => HTMLESC[c]);
}

// =================== Utilidades de texto ===================
function extractAcronymsSmart(text) {
  const WL = new Set([
    "UH",
    "VCI",
    "VBI",
    "VMS",
    "TC",
    "RM",
    "TAC",
    "T1",
    "T2",
    "FOV",
    "SUV",
    "CTA",
    "MRA",
    "MIP",
    "DWI",
    "ADC",
    "IV",
    "VO",
    "HCC",
    "BIRADS",
    "PI-RADS",
    "PI RADS",
    "LIRADS",
    "LI-RADS",
  ]);
  const found = new Set();
  const matches = (text || "").match(/\b[0-9A-ZÁÉÍÓÚÜÑ-]{2,}\b/g) || [];
  for (const w of matches) {
    const up = w
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
    const hasDigit = /\d/.test(up);
    if (WL.has(up) || hasDigit) found.add(up);
  }
  return found;
}
function toInformeCase(text, keepHeadings, acronyms) {
  const lf = text.replace(/\r\n/g, "\n");
  const lines = lf.split("\n");

  return lines
    .map((line) => {
      // 1) quita espacios al inicio/fin de cada línea
      const raw = line.trim();

      // Encabezados tipo "HALLAZGOS:" se mantienen en mayúsculas
      if (keepHeadings && /:\s*$/.test(raw)) return raw.toUpperCase();

      // 2) baja a minúsculas
      let s = raw.toLowerCase();

      // 3) corrige ESPACIADO alrededor de signos:
      //   - quita espacios antes de , . ; : ! ? …
      s = s.replace(/\s+([,.;:!?…])/g, "$1");
      //   - quita espacios después de ( [ {
      s = s.replace(/([(\[\{])\s+/g, "$1");
      //   - quita espacios antes de ) ] }
      s = s.replace(/\s+([)\]\}])/g, "$1");
      //   - asegura UN espacio después de , ; : cuando viene letra/número
      s = s.replace(/([,;:])\s*(?=\p{L}|\d)/gu, "$1 ");
      //   - asegura UN espacio después de . ! ? … cuando viene letra/número
      //     (evita insertar espacio si lo siguiente es fin de línea)
      s = s.replace(/([.!?…])\s*(?=\p{L}|\d)/gu, "$1 ");

      // 4) compacta espacios múltiples
      s = s.replace(/\s{2,}/g, " ");

      // 5) sentence-case: mayúscula al inicio y tras . ! ? …
      s = s.replace(
        /(^|[.!?…]\s+)(\p{L})/gu,
        (m, p, chr) => p + chr.toUpperCase()
      );

      // 6) respeta SIGLAS (acronyms) si nos las pasan
      if (acronyms && acronyms.size) {
        s = s.replace(/\b([\p{L}\p{N}-]+)\b/gu, (m, word) => {
          const up = word.toUpperCase();
          return acronyms.has(up) ? up : m;
        });
      }

      return s;
    })
    .join("\n");
}

// =================== Editor ===================
export function buildEditor({
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
}) {
  let edBaseText = "";
  let edBaseAcronyms = new Set();
  let edSession = {
    sourceOutput: null,
    html: "",
    baseText: "",
    acronyms: new Set(),
  };
  let lastInputType = "";

  function renderEditorDiff() {
  const caret = getCaretOffset(edEditor);
  const base = edBaseText;
  const currPlain = edEditor.innerText;
  const A = tokenize(base);
  const B = tokenize(currPlain);
  const ops = diffTokens(A, B);

  let html = "";

  // helper: decide si un tramo (por índices de A) era MAYÚSCULA en el TEXTO BASE
  function isBaseUpper(i0, i1) {
    const baseSeg = A.slice(i0, i1).join("");
    const letters = baseSeg.match(/\p{L}/gu)?.length || 0;
    return letters > 1 && baseSeg.trim() === baseSeg.trim().toUpperCase();
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if (op.tag === "insert") {
      // 🔹 fusiona inserts adyacentes en un solo <mark>
      let content = B.slice(op.j0, op.j1).join("");
      let look = i + 1;
      while (look < ops.length && ops[look].tag === "insert") {
        content += B.slice(ops[look].j0, ops[look].j1).join("");
        look++;
      }
      html += content.trim().length > 0
        ? `<mark class="add">${esc(content)}</mark>`
        : esc(content);
      i = look - 1;
      continue;
    }

    if (op.tag === "equal") {
      // 🔸 ¿Este tramo era ÁMBAR en el TEXTO BASE?
      const upper = isBaseUpper(op.i0, op.i1);

      if (!upper) {
        // igual “normal”: escápalo y sigue
        html += esc(B.slice(op.j0, op.j1).join(""));
        continue;
      }

      // 🔸 upper = true → fusiona TODOS los equal consecutivos que también sean upper
      let jContent = B.slice(op.j0, op.j1).join("");
      let iStart = op.i0, iEnd = op.i1;
      let look = i + 1;

      while (
        look < ops.length &&
        ops[look].tag === "equal" &&
        isBaseUpper(ops[look].i0, ops[look].i1)
      ) {
        jContent += B.slice(ops[look].j0, ops[look].j1).join("");
        iEnd = ops[look].i1;
        look++;
      }

      html += `<strong class="original-upper">${esc(jContent)}</strong>`;
      i = look - 1; // saltar los equal ya fusionados
      continue;
    }

    // (delete) no se muestra; si quieres visualizarlos añade aquí un <del>
  }

  edEditor.innerHTML = html || "";
  setCaretOffset(edEditor, caret);
  edSession.html = edEditor.innerHTML;
}

  function openEditorWith(htmlFromOutput) {
    editorModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const srcHtml = htmlFromOutput || "";

    if (edSession.sourceOutput === srcHtml && edSession.html) {
      edEditor.innerHTML = edSession.html;
      edEditor.focus();
      return;
    }

    edSession.sourceOutput = srcHtml;

    // Establecemos el texto base y dejamos que renderEditorDiff haga toda la magia
    let tempDiv = document.createElement("div");
    tempDiv.innerHTML = srcHtml;
    edBaseText = tempDiv.innerText;

    edEditor.innerHTML = srcHtml; // Carga inicial con los estilos de la salida

    edSession.baseText = edBaseText;
    edSession.acronyms = extractAcronymsSmart(edBaseText);
    edSession.html = edEditor.innerHTML;
    edEditor.focus();
  }

  function closeEditor() {
    document.getElementById("editOutBtn")?.focus();
    editorModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function scheduleRender() {
    if (edEditor._renderTimer) cancelAnimationFrame(edEditor._renderTimer);
    edEditor._renderTimer = requestAnimationFrame(renderEditorDiff);
  }

  // =================== Eventos ===================
  if (edClose) edClose.addEventListener("click", closeEditor);
  if (editorModal) {
    editorModal.addEventListener("click", (ev) => {
      if (ev.target?.dataset?.close) closeEditor();
    });
  }

  if (edEditor) {
    // Interceptar Enter para insertar \n plano (sin <div>/<br>) y re-renderizar
    edEditor.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Convención:
        //  - Enter            -> nuevo párrafo (doble salto)
        //  - Shift + Enter    -> salto de línea simple
        insertPlainTextAtSelection(e.shiftKey ? "\n" : "\n\n");
        scheduleRender();
      }
    });

    edEditor.addEventListener("beforeinput", (e) => {
      lastInputType = e.inputType || "";
      if (
        e.inputType === "insertParagraph" ||
        e.inputType === "insertLineBreak"
      ) {
        e.preventDefault(); // evita doble salto o inconsistencias
      }
    });

    edEditor.addEventListener("input", () => {
      scheduleRender();
    });
  }

  if (edUseBase) {
    edUseBase.addEventListener("click", () => {
      const plain = edEditor.innerText;
      edBaseText = plain;
      edBaseAcronyms = extractAcronymsSmart(edBaseText);
      edSession.baseText = edBaseText;
      edSession.acronyms = edBaseAcronyms;
      renderEditorDiff();
      showToast("Texto actual fijado como original");
    });
  }

  if (edNormalize) {
    edNormalize.addEventListener("click", () => {
      const keep = edKeepHeads?.checked ?? true;
      const plain = edEditor.innerText;
      const norm = toInformeCase(plain, keep, AppConfig.excludedWords);
      edEditor.textContent = norm; // limpio
      renderEditorDiff(); // recalcula diffs vs base
      showToast("Texto normalizado");
    });
  }

  if (edCopy) {
    edCopy.addEventListener("click", async () => {
      const txt = edEditor.innerText;
      try {
        await navigator.clipboard.writeText(txt);
        showToast("Texto copiado");
      } catch (e) {
        const r = document.createRange();
        r.selectNodeContents(edEditor);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
        document.execCommand("copy");
        s.removeAllRanges();
        showToast("Texto copiado (alternativo)");
      }
    });
  }

  if (edSaveBack) {
    edSaveBack.addEventListener("click", () => {
      const ok = confirm(
        "⚠️ ¿Seguro que deseas restaurar el texto al original? Se perderán todos los cambios realizados."
      );
      if (!ok) return;

      const originalHtml = edSession?.sourceOutput ?? "";

      // --- LÓGICA CORREGIDA ---
      // 1. Extrae el texto plano del HTML original para la base de comparación.
      let tempDiv = document.createElement("div");
      tempDiv.innerHTML = originalHtml;
      edBaseText = tempDiv.innerText;

      // 2. Inserta el HTML en el editor para que se vean los colores.
      edEditor.innerHTML = originalHtml; // <--- ¡SOLUCIÓN!

      // 3. Actualiza el resto de la sesión.
      edSession.baseText = edBaseText;
      edSession.acronyms = extractAcronymsSmart(edBaseText);
      edSession.html = edEditor.innerHTML;

      showToast("Texto restaurado al original");
    });
  }

  return { openEditorWith, closeEditor };
}
