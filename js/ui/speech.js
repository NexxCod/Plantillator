// Web Speech controller (MVP) — sólo frontend
export function createSpeechController({
  lang = "es-CL",
  onPartial = () => {},
  onFinal = () => {},
  onStart = () => {},
  onEnd = () => {},
  onError = () => {},
} = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    return {
      supported: false,
      start: () => {},
      stop: () => {},
      toggle: () => {},
      isRunning: () => false,
    };
  }

  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let running = false;

  // Mapeo simple de comandos → puntuación/acciones
  function mapCommands(text) {
    // normaliza para detectar comandos (no altera mayúsculas/siglas finales)
    const t = (text || "").toLowerCase().trim();

    const replacements = [
      [" punto y coma ", "; "],
      [" punto y coma", ";"],
      [" punto final ", ". "],
      [" punto final", "."],
      [" punto ", ". "],
      [" punto", "."],
      [" coma ", ", "],
      [" coma", ","],
      [" dos puntos ", ": "],
      [" dos puntos", ":"],
      [" abrir paréntesis ", "("],
      [" abrir parentesis ", "("],
      [" cerrar paréntesis ", ")"],
      [" cerrar parentesis ", ")"],
      [" abrir comillas ", "«"],
      [" cerrar comillas ", "»"],
      [" nueva línea ", "\n"],
      [" nueva linea ", "\n"],
      [" nuevo párrafo ", "\n\n"],
      [" nuevo parrafo ", "\n\n"],
    ];

    let out = " " + t + " ";
    for (const [k, v] of replacements) out = out.replaceAll(k, v);
    return out.trim();
  }

  rec.onstart = () => { running = true; onStart(); };
  rec.onend = () => { running = false; onEnd(); };
  rec.onerror = (e) => onError(e);

  rec.onresult = (ev) => {
    let partial = "";
    let finals = [];
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const txt = res[0]?.transcript || "";
      if (res.isFinal) {
        finals.push(txt);
      } else {
        partial += txt + " ";
      }
    }
    if (partial) onPartial(mapCommands(partial));
    if (finals.length) onFinal(mapCommands(finals.join(" ")));
  };

  return {
    supported: true,
    start: () => { if (!running) try { rec.start(); } catch(_) {} },
    stop: () => { if (running) try { rec.stop(); } catch(_) {} },
    toggle: () => { running ? rec.stop() : rec.start(); },
    isRunning: () => running,
  };
}

// Helpers de inserción para textarea y contenteditable
export function insertAtCursorTextarea(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after  = el.value.slice(end);
  el.value = before + text + after;
  const pos = start + text.length;
  el.selectionStart = el.selectionEnd = pos;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function insertAtCaretContentEditable(root, text) {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    root.append(document.createTextNode(text));
    return;
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
}
