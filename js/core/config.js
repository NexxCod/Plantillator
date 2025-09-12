const SETTINGS_KEY = "comparador_settings_v1";

// --- Palabras excluidas por defecto (puedes agregar más aquí) ---
const DEFAULT_EXCLUDED_WORDS = [
  "LIRADS",
  "LI-RADS",
  "LR",
  "IV",
  "VI",
  "TC",
  "RM",
  "TAC",
  "PET",
  "BIRADS",
  "BI-RADS",
  "PIRADS",
  "PI-RADS",
  "ACR",
  "RSNA",
  "HU",
  "VCI",
  "VCS",
  "VMS",
  "VMI",
  "T1",
  "T2",
  "FLAIR",
  "DWI",
  "ADC",
  "SUV",
];

/**
 * Carga la configuración desde localStorage o devuelve los valores por defecto.
 * @returns {{excludedWords: Set<string>}}
 */
export function loadSettings() {
  const defaults = {
    excludedWords: new Set(DEFAULT_EXCLUDED_WORDS),
    dictationMode: "toggle",
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;

    const data = JSON.parse(raw);
    const settings = { ...defaults };

    if (data && Array.isArray(data.excludedWords)) {
      const words = data.excludedWords
        .map((w) => w.toUpperCase().trim())
        .filter(Boolean);
      settings.excludedWords = new Set(words);
    }
    if (data && (data.dictationMode === "push" || data.dictationMode === "toggle")) {
      settings.dictationMode = data.dictationMode;
    }
    return settings;
  } catch (e) {
    console.warn("No se pudo cargar la configuración:", e);
    return defaults;
  }
}

/**
 * Guarda el objeto de configuración en localStorage.
 * @param {{excludedWords: Set<string>, dictationMode: 'push' | 'toggle'}} settings
 * @param {(errorMsg: string) => void} [onError]
 */
export function saveSettings(settings, onError) {
  try {
    const dataToStore = {
      excludedWords: [...settings.excludedWords],
      dictationMode: settings.dictationMode || "push",
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(dataToStore));
  } catch (e) {
    if (typeof onError === "function") {
      onError("Error al guardar la configuración: " + e);
    }
  }
}
