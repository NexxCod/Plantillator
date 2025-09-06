// Segmentación de oraciones y párrafos (idéntico)
const sentSegmenter =
  typeof Intl !== "undefined" && Intl.Segmenter
    ? new Intl.Segmenter("es", { granularity: "sentence" })
    : null;

export function splitSentences(paragraph) {
  const text = paragraph || "";
  if (!text.trim()) return [text];
  if (sentSegmenter) {
    const segs = [...sentSegmenter.segment(text)];
    return segs.map((s) => text.slice(s.index, s.index + s.segment.length));
  }
  const re = /([^.!?…\n\r]+(?:[.!?…]+)?(?:\s+|$))/gu;
  const parts = text.match(re);
  return parts ? parts : [text];
}

export function splitParagraphs(text) {
  const t = (text || "").replace(/\r\n/g, "\n").trimEnd();
  if (!t) return [];
  return t.split(/\n\s*\n/g);
}
