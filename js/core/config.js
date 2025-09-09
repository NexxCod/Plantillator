const SETTINGS_KEY = "comparador_settings_v1";

// --- Palabras excluidas por defecto (puedes agregar más aquí) ---
const DEFAULT_EXCLUDED_WORDS = [
    "LIRADS", "LI-RADS", "LR", "IV", "VI",
    "TC", "RM", "TAC", "PET",
    "BIRADS", "BI-RADS",
    "PIRADS", "PI-RADS",
    "ACR", "RSNA",
    "HU", "VCI", "VCS", "VMS", "VMI",
    "T1", "T2", "FLAIR", "DWI", "ADC", "SUV"
];

/**
 * Carga la configuración desde localStorage o devuelve los valores por defecto.
 * @returns {{excludedWords: Set<string>}}
 */
export function loadSettings() {
    const defaults = {
        excludedWords: new Set(DEFAULT_EXCLUDED_WORDS)
    };
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return defaults;

        const data = JSON.parse(raw);
        if (data && Array.isArray(data.excludedWords)) {
            // Convierte el array a un Set de mayúsculas para búsqueda rápida y case-insensitive
            const words = data.excludedWords.map(w => w.toUpperCase().trim()).filter(Boolean);
            return { excludedWords: new Set(words) };
        }
        return defaults;
    } catch (e) {
        console.warn("No se pudo cargar la configuración:", e);
        return defaults;
    }
}

/**
 * Guarda el objeto de configuración en localStorage.
 * @param {{excludedWords: Set<string>}} settings 
 * @param {(errorMsg: string) => void} [onError]
 */
export function saveSettings(settings, onError) {
    try {
        const dataToStore = {
            // Guarda como un Array de strings, que es serializable a JSON
            excludedWords: [...settings.excludedWords]
        };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(dataToStore));
    } catch (e) {
        if (typeof onError === "function") {
            onError("Error al guardar la configuración: " + e);
        }
    }
}