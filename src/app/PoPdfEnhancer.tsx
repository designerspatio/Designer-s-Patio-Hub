"use client";

import { useEffect } from "react";

type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  gapBefore?: number;
};

function clean(value: string | null | undefined) {
  return (value || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2022]/g, " | ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wrap(text: string, maxChars = 88) {
  const value = clean(text);
  if (!value) return [""];
  const words = value.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function fieldValue(field: Element) {
  const input = field.querySelector("input, select, textarea") as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement
    | null;

  if (!input) {
    const strong = field.querySelector("strong");
    return clean(strong?.textContent);
  }

  if (input instanceof HTMLSelectElement) {
    return clean(input.selectedOptions[0]?.textContent || input.value);
  }

  return clean(input.value);
}

function collectPoLines(modal: HTMLElement): { lines: PdfLine[]; fileName: string } {
  const kicker = clean(modal.querySelector(".detail-kicker")?.textContent);
  const vendor = clean(modal.querySelector(".modal-header h2")?.textContent);
  const sale = clean(modal.querySelector(".po-subtitle")?.textContent);
  const poNumber =
    kicker.match(/#\s*([^\s]+)/)?.[1] ||
    kicker.replace(/PURCHASE ORDER/i, "").replace("#", "").trim() ||
    "Purchase-Order";

  const lines: PdfLine[] = [
    { text: "DESIGNER'S PATIO", size: 17, bold: true },
    { text: kicker || `PURCHASE ORDER #${poNumber}`, size: 15, bold: true, gapBefore: 3 },
    { text: vendor || "Vendor", size: 12, bold: true, gapBefore: 4 },
  ];

  if (sale) lines.push({ text: sale, size: 10 });

  const fields = Array.from(modal.querySelectorAll(".po-form-grid .form-field"));
  const detailLines: string[] = [];

  for (const field of fields) {
    const label = clean(field.querySelector(":scope > span")?.textContent);
    const value = fieldValue(field);
    if (!label || !value || value === "Not entered") continue;
    detailLines.push(`${label}: ${value}`);
  }

  if (detailLines.length) {
    lines.push({ text: "ORDER DETAILS", size: 11, bold: true, gapBefore: 14 });
    detailLines.forEach((entry) => lines.push({ text: entry, size: 9.5 }));
  }

  const rows = Array.from(modal.querySelectorAll(".po-item-row"));
  if (rows.length) {
    lines.push({ text: "VENDOR MERCHANDISE", size: 11, bold: true, gapBefore: 14 });

    rows.forEach((row, index) => {
      const main = row.querySelector(".po-item-main");
      const sku = clean(main?.querySelector("strong")?.textContent);
      const description = clean(main?.querySelector("span")?.textContent);
      const specs = clean(main?.querySelector("small")?.textContent);
      const numbers = Array.from(row.querySelectorAll(".po-item-number")).map((node) => {
        const label = clean(node.querySelector("span")?.textContent);
        const value = clean(node.querySelector("strong")?.textContent);
        return label && value ? `${label}: ${value}` : "";
      }).filter(Boolean);

      lines.push({
        text: `${index + 1}. ${sku || "No SKU"}${description ? ` - ${description}` : ""}`,
        size: 9.5,
        bold: true,
        gapBefore: index === 0 ? 2 : 7,
      });

      if (specs) lines.push({ text: specs, size: 9 });
      if (numbers.length) lines.push({ text: numbers.join("    "), size: 9 });
    });
  }

  const totals = Array.from(modal.querySelectorAll(".po-total-box > div"))
    .map((node) => {
      const label = clean(node.querySelector("span")?.textContent);
      const value = clean(node.querySelector("strong")?.textContent);
      return label && value ? `${label}: ${value}` : "";
    })
    .filter(Boolean);

  if (totals.length) {
    lines.push({ text: "TOTALS", size: 11, bold: true, gapBefore: 14 });
    totals.forEach((entry) => lines.push({ text: entry, size: 10, bold: true }));
  }

  const noteField = fields.find(
    (field) => clean(field.querySelector(":scope > span")?.textContent).toLowerCase() === "po notes"
  );
  const notes = noteField ? fieldValue(noteField) : "";
  if (notes) {
    lines.push({ text: "VENDOR NOTES", size: 11, bold: true, gapBefore: 14 });
    lines.push({ text: notes, size: 9.5 });
  }

  lines.push({
    text: "Please reference this purchase order number on all acknowledgements, invoices, and correspondence.",
    size: 8.5,
    gapBefore: 18,
  });

  return {
    lines,
    fileName: `PO-${clean(poNumber).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`,
  };
}

function escapePdf(value: string) {
  return clean(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makePdf(lines: PdfLine[]) {
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let y = 742;

  const pushPage = () => {
    if (page.length) pages.push(page);
    page = [];
    y = 742;
  };

  for (const item of lines) {
    const size = item.size || 10;
    const wrapped = wrap(item.text, size >= 14 ? 66 : size >= 11 ? 76 : 92);
    const gap = item.gapBefore || 0;
    const required = gap + wrapped.length * (size + 4) + 2;

    if (y - required < 52) pushPage();
    y -= gap;

    wrapped.forEach((text, idx) => {
      page.push({
        text,
        size,
        bold: item.bold,
        gapBefore: idx === 0 ? 0 : 0,
      });
      y -= size + 4;
    });
  }

  pushPage();

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  const pageObjectNumbers = pages.map((_, i) => 5 + i * 2);
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers
    .map((n) => `${n} 0 R`)
    .join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  pages.forEach((pageLines, pageIndex) => {
    let cursorY = 742;
    const commands: string[] = [];

    if (pageIndex > 0) {
      commands.push(
        "BT",
        "/F2 10 Tf",
        "48 760 Td",
        `(DESIGNER'S PATIO - PURCHASE ORDER CONTINUED) Tj`,
        "ET"
      );
    }

    for (const line of pageLines) {
      const size = line.size || 10;
      const font = line.bold ? "F2" : "F1";
      if (line.gapBefore) cursorY -= line.gapBefore;
      commands.push(
        "BT",
        `/${font} ${size} Tf`,
        `48 ${cursorY.toFixed(1)} Td`,
        `(${escapePdf(line.text)}) Tj`,
        "ET"
      );
      cursorY -= size + 4;
    }

    commands.push(
      "BT",
      "/F1 8 Tf",
      `48 30 Td`,
      `(Page ${pageIndex + 1} of ${pages.length}) Tj`,
      "ET"
    );

    const stream = commands.join("\n");
    const pageObj = pageObjectNumbers[pageIndex];
    const contentObj = pageObj + 1;

    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";

  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  return new Blob([pdf], { type: "application/pdf" });
}

function downloadPoPdf(modal: HTMLElement) {
  const { lines, fileName } = collectPoLines(modal);
  const blob = makePdf(lines);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PoPdfEnhancer() {
  useEffect(() => {
    const attach = () => {
      const modals = Array.from(document.querySelectorAll<HTMLElement>(".po-modal"));

      modals.forEach((modal) => {
        const actions = modal.querySelector<HTMLElement>(".modal-actions");
        if (!actions || actions.querySelector("[data-po-pdf-button]")) return;

        const saveButton = Array.from(actions.querySelectorAll("button")).find((button) =>
          /save purchase order|saving/i.test(clean(button.textContent))
        );

        if (!saveButton) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "modal-secondary";
        button.textContent = "Download PDF";
        button.setAttribute("data-po-pdf-button", "true");
        button.addEventListener("click", () => downloadPoPdf(modal));

        actions.insertBefore(button, actions.firstChild);
      });
    };

    attach();

    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
