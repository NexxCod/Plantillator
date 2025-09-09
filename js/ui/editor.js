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
function insertPlainNewline() {
  // Un \n; se renderiza como salto gracias a white-space: pre-wrap en .editor
  insertPlainTextAtSelection("\n");
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
      const raw = line.trimEnd();
      if (keepHeadings && /:\s*$/.test(raw)) return raw.toUpperCase();
      let s = raw.toLowerCase();
      s = s.replace(
        /(^|[.!?…]\s+)(\p{L})/gu,
        (m, p, chr) => p + chr.toUpperCase()
      );

      // La lógica principal ahora se basa en el Set de acrónimos que le pasamos
      if (acronyms && acronyms.size) {
        // La regex busca palabras completas para reemplazarlas
        s = s.replace(/\b([\p{L}\p{N}-]+)\b/gu, (m, word) => {
          const up = word.toUpperCase();
          // Si la palabra en mayúsculas está en nuestro Set, la devolvemos en mayúsculas
          return acronyms.has(up) ? up : m;
        });
      }
      return s;
    })
    .join("\n");
}

function boldUppercaseSentences(plainText) {
  const segs = (plainText || "").split(/(\n{2,})/);
  const out = segs
    .map((chunk) => {
      if (/\n{2,}/.test(chunk)) return chunk;
      const parts = chunk.match(/[^.!?…\n]+[.!?…]*|\n+/gu) || [chunk];
      return parts
        .map((p) => {
          const letters = p.match(/\p{L}/gu)?.length || 0;
          const isUpper = letters > 0 && p === p.toUpperCase();
          return isUpper ? `<strong>${esc(p)}</strong>` : esc(p);
        })
        .join("");
    })
    .join("");
  return out;
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
  AppConfig
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
    const currPlain = edEditor.innerText; // preserva saltos de línea
    const A = tokenize(base);
    const B = tokenize(currPlain);
    const ops = diffTokens(A, B);

    let html = "";
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];

        if (op.tag === "equal") {
            const seg = B.slice(op.j0, op.j1).join('');
            html += esc(seg);
            continue; // Pasa a la siguiente operación
        }

        if (op.tag === "insert") {
            // Hemos encontrado una inserción.
            // Acumulamos su contenido y miramos si las siguientes operaciones también son inserciones.
            let content = B.slice(op.j0, op.j1).join('');
            let lookahead = i + 1;

            while (lookahead < ops.length && ops[lookahead].tag === 'insert') {
                const nextOp = ops[lookahead];
                content += B.slice(nextOp.j0, nextOp.j1).join('');
                lookahead++;
            }

            // Si el contenido agrupado no es solo espacio en blanco, lo envolvemos en <mark>
            if (content.trim().length > 0) {
                html += `<mark class="add">${esc(content)}</mark>`;
            } else {
                // Si solo era espacio, lo añadimos sin resaltar
                html += esc(content);
            }

            // Saltamos el índice del bucle principal hasta la última inserción que agrupamos
            i = lookahead - 1;
        }
        // Las operaciones 'delete' se ignoran en la salida visual, así que no se necesita un 'else'.
    }

    edEditor.innerHTML = html || "";
    setCaretOffset(edEditor, caret);
    edSession.html = edEditor.innerHTML;
}

  function openEditorWith(textFromOutput) {
    editorModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const src = textFromOutput || "";
    if (edSession.sourceOutput === src && edSession.html) {
      edBaseText = edSession.baseText || src;
      edBaseAcronyms = edSession.acronyms || new Set();
      edEditor.innerHTML = edSession.html;
      edEditor.focus();
      return;
    }
    edSession.sourceOutput = src;
    edBaseText = src;
    edBaseAcronyms = extractAcronymsSmart(edBaseText);
    edEditor.innerHTML = boldUppercaseSentences(edBaseText);
    renderEditorDiff();
    edSession.baseText = edBaseText;
    edSession.acronyms = edBaseAcronyms;
    edSession.html = edEditor.innerHTML;
    edEditor.focus();
  }
  function closeEditor() {
    document.getElementById('editOutBtn')?.focus();
    editorModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    
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
    // Si es Enter (sin Shift), inserta un salto de párrafo
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertPlainTextAtSelection("\n\n"); // Salto doble
        if (edEditor._renderTimer) cancelAnimationFrame(edEditor._renderTimer);
        edEditor._renderTimer = requestAnimationFrame(renderEditorDiff);
    } 
    // Si es Shift + Enter, inserta un salto de línea simple
    else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        insertPlainTextAtSelection("\n"); // Salto simple
        if (edEditor._renderTimer) cancelAnimationFrame(edEditor._renderTimer);
        edEditor._renderTimer = requestAnimationFrame(renderEditorDiff);
    }
});

    edEditor.addEventListener("beforeinput", (e) => {
      lastInputType = e.inputType || "";
    });

    edEditor.addEventListener("input", () => {
      // Respaldo por si algún navegador dispara insertParagraph
      if (lastInputType === "insertParagraph") {
        lastInputType = "";
        setTimeout(renderEditorDiff, 0);
        return;
      }
      if (edEditor._renderTimer) cancelAnimationFrame(edEditor._renderTimer);
      edEditor._renderTimer = requestAnimationFrame(renderEditorDiff);
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
  edSaveBack.addEventListener("click", ()=>{
    // Mostrar advertencia antes de restaurar
    const ok = confirm("⚠️ ¿Seguro que deseas restaurar el texto al original? Se perderán todos los cambios realizados.");
    if (!ok) return; // si cancela, no hacemos nada

    // Restaurar el texto al estado original de la salida
    const original = edSession?.sourceOutput ?? "";

    edBaseText = original;
    edBaseAcronyms = extractAcronymsSmart(edBaseText);
    edEditor.textContent = original;   // carga el texto plano original
    renderEditorDiff();                // recalcula resaltados/diffs
    edSession.baseText = edBaseText;
    edSession.acronyms = edBaseAcronyms;
    edSession.html     = edEditor.innerHTML;

    showToast("Texto restaurado al original");
    // Ojo: no se cierra el editor, permanece abierto
  });
}

  return { openEditorWith, closeEditor };
}
