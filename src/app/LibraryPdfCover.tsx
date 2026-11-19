"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

type LibraryPdfCoverProps = {
  storage: SupabaseClient["storage"] | undefined;
  bucket: "catalogs" | "price-lists";
  filePath: string | null;
};

export default function LibraryPdfCover({ storage, bucket, filePath }: LibraryPdfCoverProps) {
  const coverRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"pending" | "loading" | "ready" | "unavailable">("pending");

  useEffect(() => {
    const cover = coverRef.current;
    const canvas = canvasRef.current;
    if (!filePath || !storage || !cover || !canvas) return;

    let disposed = false;
    let document: PDFDocumentLoadingTask | undefined;

    async function renderCover(target: HTMLCanvasElement, path: string, client: SupabaseClient["storage"]) {
      setStatus("loading");
      try {
        const [pdfjs, { data, error }] = await Promise.all([
          import("pdfjs-dist"),
          client.from(bucket).createSignedUrl(path, 600),
        ]);
        if (disposed) return;
        if (error || !data?.signedUrl) throw new Error("PDF unavailable");

        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf-preview/pdf.worker.min.mjs";
        document = pdfjs.getDocument({
          url: data.signedUrl,
          cMapUrl: "/pdf-preview/cmaps/",
          standardFontDataUrl: "/pdf-preview/standard_fonts/",
          wasmUrl: "/pdf-preview/wasm/",
          disableAutoFetch: true,
          disableStream: true,
        });
        const pdf = await document.promise;
        const page = await pdf.getPage(1);
        if (disposed) return;

        const size = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(480 / size.width, 480 / size.height) });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        await page.render({ canvas: target, viewport }).promise;
        if (!disposed) setStatus("ready");
      } catch {
        if (!disposed) setStatus("unavailable");
      } finally {
        const finished = document;
        document = undefined;
        await finished?.destroy().catch(() => {});
      }
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      void renderCover(canvas, filePath, storage);
    }, { rootMargin: "120px" });
    observer.observe(cover);
    return () => {
      disposed = true;
      observer.disconnect();
      const active = document;
      document = undefined;
      void active?.destroy().catch(() => {});
    };
  }, [bucket, filePath, storage]);

  return (
    <span className="library-card-cover" ref={coverRef}>
      <canvas ref={canvasRef} hidden={status !== "ready"} aria-hidden="true" />
      {status !== "ready" && (
        <span className="library-card-placeholder">
          <span className="library-card-file-icon" aria-hidden="true">PDF</span>
          {!filePath ? "No PDF attached" : status === "unavailable" ? "Preview unavailable" : status === "loading" ? "Loading preview…" : "PDF preview"}
        </span>
      )}
    </span>
  );
}
