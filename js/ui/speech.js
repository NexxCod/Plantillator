// js/ui/speech.js

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

  let running = false; // Estado interno que controlaremos nosotros // --- LÓGICA DE ESTADO MEJORADA --- // Los eventos de la API ahora solo se encargan de la parte visual/notificaciones

  rec.onstart = () => {
    // Si por alguna razón el navegador lo inicia y nuestro estado es falso, lo corregimos.
    if (!running) running = true;
    onStart();
  };

  rec.onend = () => {
    // Si el navegador lo detiene (ej. por silencio) y nuestro estado es verdadero, lo corregimos.
    if (running) running = false;
    onEnd();
  };

  rec.onerror = (e) => {
    // Si hay un error, nos aseguramos de que el estado quede como 'detenido'.
    if (running) running = false;
    onError(e);
  }; // ... (la función mapCommands y rec.onresult se mantienen igual)

  function mapCommands(text) {
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

  // --- MÉTODOS DE CONTROL CON ESTADO SINCRONIZADO ---
  const start = () => {
    if (running) return; // Si ya está corriendo, no hacer nada
    try {
      rec.start();
      running = true; // Actualizamos el estado INMEDIATAMENTE
    } catch (e) {
      console.warn("Error al iniciar el dictado:", e.message);
      running = false; // Nos aseguramos que el estado sea correcto si falla
    }
  };

  const stop = () => {
    if (!running) return; // Si ya está detenido, no hacer nada
    try {
      rec.stop();
      running = false; // Actualizamos el estado INMEDIATAMENTE
    } catch (e) {
      console.warn("Error al detener el dictado:", e.message);
      running = false;
    }
  };

  return {
    supported: true,
    start,
    stop,
    toggle: () => {
      running ? stop() : start();
    },
    isRunning: () => running, // Esta función ahora es 100% fiable
  };
}

// Helpers de inserción para textarea y contenteditable
export function insertAtCursorTextarea(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
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
  sel.removeAllRanges();
  sel.addRange(range);
}
