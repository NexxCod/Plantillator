// Persistencia de plantillas y último estado
const STORAGE_KEY = "comparador_plantillas_v1";
const LAST_STATE_KEY = "comparador_last_state_v1";

export function loadTemplates() {
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

export function saveTemplates(obj, onError) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {
    if (typeof onError === "function") onError("Error al guardar plantillas: " + e);
  }
}

export function saveLastState(templateTxt, reportTxt) {
  try {
    localStorage.setItem(LAST_STATE_KEY, JSON.stringify({
      template: templateTxt?.value || "",
      report: reportTxt?.value || ""
    }));
  } catch (e) { /* noop */ }
}

export function restoreLastState(templateTxt, reportTxt) {
  try {
    const raw = localStorage.getItem(LAST_STATE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      if (typeof data.template === "string") templateTxt.value = data.template;
      if (typeof data.report === "string") reportTxt.value = data.report;
    }
  } catch (e) { /* noop */ }
}
