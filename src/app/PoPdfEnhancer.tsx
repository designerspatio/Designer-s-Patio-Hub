"use client";

import { useEffect } from "react";
import { DP_PDF_LOGO_DATA_URL } from "./PdfBranding";
import { clean, makePoPdf, type PdfImage, type PoDocument } from "./PoPdfDocument";

function base64ToBinary(value: string) {
  return atob(value);
}

async function imageUrlToPdfJpeg(url: string): Promise<PdfImage | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = objectUrl;
    });

    const maxDimension = 1800;
    const scale = Math.min(
      1,
      maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
    URL.revokeObjectURL(objectUrl);

    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;

    return {
      binary: base64ToBinary(base64),
      width,
      height,
    };
  } catch {
    return null;
  }
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

function collectPoDocument(modal: HTMLElement): PoDocument {
  const kicker=clean(modal.querySelector(".detail-kicker")?.textContent);
  const fields=Array.from(modal.querySelectorAll(".po-form-grid .form-field"));
  const details=fields.map(field=>({label:clean(field.querySelector(":scope > span")?.textContent),value:fieldValue(field)})).filter(d=>d.label && d.value && d.value!=="Not entered");
  return {
    number:kicker.match(/#\s*(.+)$/)?.[1] || "Purchase-Order",
    vendor:clean(modal.querySelector(".modal-header h2")?.textContent),
    sale:clean(modal.querySelector(".po-subtitle")?.textContent),
    details,
    notes:details.find(d=>d.label.toLowerCase()==="po notes")?.value || "",
    items:Array.from(modal.querySelectorAll(".po-item-row")).map(row=>{
      const main=row.querySelector(".po-item-main");
      const values=Array.from(row.querySelectorAll(".po-item-number strong")).map(n=>clean(n.textContent));
      return {sku:clean(main?.querySelector("strong")?.textContent),description:clean(main?.querySelector("span")?.textContent),specs:clean(main?.querySelector("small")?.textContent),quantity:values[0]||"",cost:values[1]||"",total:values[2]||""};
    }),
    totals:Array.from(modal.querySelectorAll(".po-total-box > div")).map(n=>({label:clean(n.querySelector("span")?.textContent),value:clean(n.querySelector("strong")?.textContent)})),
  };
}

async function downloadPoPdf(modal: HTMLElement) {
  const data = collectPoDocument(modal);
  const fileName = `PO-${data.number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  const logoImage = await imageUrlToPdfJpeg(DP_PDF_LOGO_DATA_URL);
  const blob = new Blob([makePoPdf(data, logoImage)], { type: "application/pdf" });
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
        button.addEventListener("click", async () => {
          button.disabled = true;
          button.textContent = "Building PDF...";
          try { await downloadPoPdf(modal); }
          catch { window.alert("The purchase order PDF could not be created. Please try again."); }
          finally { button.disabled = false; button.textContent = "Download PDF"; }
        });

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
