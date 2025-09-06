import { approxEqual } from "./similarity.js";
import { splitSentences, splitParagraphs } from "./segment.js";
import { normalizeFlat } from "./normalize.js";
import { simScore } from "./similarity.js";

// LCS por oraciones con igualdad aproximada
export function diffSentences(aArr, bArr) {
  const n = aArr.length, m = bArr.length;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (approxEqual(aArr[i - 1], bArr[j - 1]))
        dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
     if (i > 0 && j > 0 && approxEqual(aArr[i - 1], bArr[j - 1])) {
      ops.push({ tag: "equal", a: [i - 1, i], b: [j - 1, j] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ tag: "insert", a: [i, i], b: [j - 1, j] });
      j--;
    } else {
      ops.push({ tag: "delete", a: [i - 1, i], b: [j, j] });
      i--;
    }
  }
  ops.reverse();
  // Compacta
  const merged = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.tag === op.tag && last.a[1] === op.a[0] && last.b[1] === op.b[0]) {
      last.a[1] = op.a[1]; last.b[1] = op.b[1];
    } else merged.push({ ...op });
  }
  // Replaces
  const finalOps = [];
  for (let k = 0; k < merged.length; k++) {
    const cur = merged[k], next = merged[k + 1];
    if (cur && next && cur.tag === "delete" && next.tag === "insert") {
      finalOps.push({ tag: "replace", a: cur.a, b: next.b });
      k++;
    } else finalOps.push(cur);
  }
  return finalOps;
}

export function compareBySentences(templatePar, reportPar) {
  const a = splitSentences(templatePar);
  const b = splitSentences(reportPar);
  const ops = diffSentences(a, b);

  let out = "";
  let reportSentences = 0, templateSentences = 0, changedSentences = 0;

  for (const op of ops) {
    const [ai0, ai1] = op.a;
    const [bj0, bj1] = op.b;
    const aCount = ai1 - ai0;
    const bCount = bj1 - bj0;
    templateSentences += aCount;
    reportSentences += bCount;

    if (op.tag === "equal") {
      out += b.slice(bj0, bj1).join("");
    } else if (op.tag === "insert" || op.tag === "replace") {
      const seg = b.slice(bj0, bj1).join("");
      out += seg.toUpperCase();
      changedSentences += bCount;
    } else if (op.tag === "delete") {
      changedSentences += aCount;
    }
  }

  const denom = Math.max(reportSentences, templateSentences) || 1;
  return {
    text: out,
    stats: { reportSentences, templateSentences, changedSentences, denom },
  };
}

export function bestMatchIndex(tpars, rpar, startIdx, win = 8) {
  const rFlat = normalizeFlat(rpar);
  let bestIdx = -1, best = -1;
  const i0 = Math.max(0, startIdx - win), i1 = Math.min(tpars.length - 1, startIdx + win);
  for (let i = i0; i <= i1; i++) {
    const s1 = simScore(tpars[i], rpar);
    const s2 = simScore(normalizeFlat(tpars[i]), rFlat);
    const s = Math.max(s1, s2);
    if (s > best) { best = s; bestIdx = i; }
  }
  if (bestIdx === -1) {
    for (let i = 0; i < tpars.length; i++) {
      const s = simScore(normalizeFlat(tpars[i]), rFlat);
      if (s > best) { best = s; bestIdx = i; }
    }
  }
  return bestIdx;
}

export function diffTemplateVsReportByParagraphs(templateText, reportText) {
  const tpars = splitParagraphs(templateText);
  const rpars = splitParagraphs(reportText);

  const out = [];
  let cursor = 0;
  let totalReportSent = 0, totalTemplateSent = 0, totalChangedSent = 0, totalDenom = 0;

  for (let k = 0; k < rpars.length; k++) {
    const r = rpars[k];
    if (!r.trim()) { out.push(r); continue; }

    let t = cursor < tpars.length ? tpars[cursor] : "";

    if (t && approxEqual(normalizeFlat(t), normalizeFlat(r))) {
      const res = compareBySentences(t, r);
      out.push(res.text);
      totalReportSent += res.stats.reportSentences;
      totalTemplateSent += res.stats.templateSentences;
      totalChangedSent += res.stats.changedSentences;
      totalDenom += res.stats.denom;
      cursor++;
      continue;
    }

    let idx = -1;
    if (tpars.length) {
      idx = bestMatchIndex(tpars, r, cursor, 8);
      if (idx < 0 && tpars.length) idx = Math.min(cursor, tpars.length - 1);
      t = idx >= 0 ? tpars[idx] : "";
    } else {
      t = "";
    }

    const res = compareBySentences(t, r);
    out.push(res.text);
    totalReportSent += res.stats.reportSentences;
    totalTemplateSent += res.stats.templateSentences;
    totalChangedSent += res.stats.changedSentences;
    totalDenom += res.stats.denom;

    if (idx >= 0) cursor = Math.max(cursor, idx + 1);
  }

  const pct = totalDenom
    ? Math.round((totalChangedSent / totalDenom) * 10000) / 100
    : 0;

  return {
    text: out.join("\n\n"),
    metrics: {
      total_frases_informe: totalReportSent,
      total_frases_plantilla: totalTemplateSent,
      frases_con_cambios: totalChangedSent,
      porcentaje_cambio_frases: pct,
    },
  };
}
