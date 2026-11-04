// PDF Standard 14 Helvetica / Helvetica-Bold glyph widths (1/1000 em).
// These must match the F1 and F2 fonts in the quote and sales-order PDFs.
const NORMAL_WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD_WIDTHS = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

export function pdfTextWidth(value: string, size: number, bold = false): number {
  const metrics = bold ? BOLD_WIDTHS : NORMAL_WIDTHS;
  let width = 0;
  for (const char of value) {
    const code = char.charCodeAt(0);
    // The PDF writer normalizes to printable ASCII before measuring.
    width += code >= 32 && code <= 126 ? metrics[code - 32] : 556;
  }
  return width * size / 1000;
}

// Wrap normal words, and split an oversized single word/SKU into character-sized
// lines instead of allowing it to run into the next PDF column.
export function wrapPdfWidth(
  value: string,
  maxWidth: number,
  size: number,
  bold = false,
): string[] {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) throw new Error("PDF text column must have positive width.");
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && pdfTextWidth(current + " " + word, size, bold) <= maxWidth) {
      current += " " + word;
      continue;
    }
    if (current) { lines.push(current); current = ""; }
    for (const char of word) {
      if (current && pdfTextWidth(current + char, size, bold) > maxWidth) {
        lines.push(current);
        current = "";
      }
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines;
}
