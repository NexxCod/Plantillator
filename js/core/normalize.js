// Normalización y tokenización
export function normalizeForCompare(s) {
  const str = (s || "").normalize("NFKC");
  const noDiacritics = str.normalize("NFD").replace(/[\u00c0-\u024f]/g, (c) => DIACRITICS[c] || c);
  return noDiacritics
    .toLowerCase()
    .replace(/[ \t\r]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/([,.;:!?…])(?=\S)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}
export const normalizeFlat = (s) => normalizeForCompare(s).replace(/\n+/g, " ");
export function tokens(s) {
  const t = normalizeForCompare(s);
  return t.match(/[\p{L}\p{N}]+/gu) || [];
}
export function tokenBigrams(toks) {
  const out = [];
  for (let i = 0; i < toks.length - 1; i++) out.push(toks[i] + " " + toks[i + 1]);
  return out;
}
