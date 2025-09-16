import { tokens, tokenBigrams, normalizeFlat } from "./normalize.js";

export function coverageBothWays(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return {aInB:1, bInA:1};
  if (ta.length === 0 || tb.length === 0) return {aInB:0, bInA:0};
  const A = new Set(ta), B = new Set(tb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return { aInB: inter / A.size, bInA: inter / B.size };
}

export const SIM_THRESHOLD_SENT = 0.9; // oraciones
export const COVERAGE_THRESHOLD = 0.9; // contenimiento

export function jaccard(aSet, bSet) {
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const denom = aSet.size + bSet.size - inter;
  return denom ? inter / denom : 1;
}

export function simScore(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  const A = new Set(ta), B = new Set(tb);
  const JA = jaccard(A, B);
  const Aa = new Set(tokenBigrams(ta)), Bb = new Set(tokenBigrams(tb));
  const JB = jaccard(Aa, Bb);
  return 0.4 * JA + 0.6 * JB;
}

export function coverageContain(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 && tb.length === 0) return 1;
  if (ta.length === 0 || tb.length === 0) return 0;
  const A = new Set(ta), B = new Set(tb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return Math.max(inter / A.size, inter / B.size);
}


export function approxEqual(a, b) {
  const af = normalizeFlat(a), bf = normalizeFlat(b);
  if (af === bf) return true;

  const { aInB, bInA } = coverageBothWays(af, bf);
  // Sólo si son prácticamente la misma oración (no "plantilla + colita")
  if (aInB >= COVERAGE_THRESHOLD && bInA >= COVERAGE_THRESHOLD) return true;

  // Si no, que decida la similitud Jaccard+bigramas
  return simScore(a, b) >= SIM_THRESHOLD_SENT;
}
