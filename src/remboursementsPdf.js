import html2canvas from "html2canvas";
import { PDFDocument, rgb } from "pdf-lib";
import {
  ref as storageRef,
  listAll,
  getDownloadURL,
  getMetadata,
  deleteObject,
} from "firebase/storage";
import { storage } from "./firebaseConfig";

/* ---------------------- Utils internes ---------------------- */
function fmtMoney(n) {
  const x = Number(n || 0);
  return x.toLocaleString("fr-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseNumberLoose(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}

function remboursementPdfFolder(year, pp, id) {
  return `depensesRemboursements/${String(year)}/${String(pp)}/items/${String(
    id
  )}/pdfs`;
}

async function blobToUint8Array(blob) {
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

async function urlToUint8Array(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Impossible de télécharger le fichier joint.");
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)?.[1] || "image/png";
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
}

/* ---------------------- Téléchargement ---------------------- */
function downloadBlobClassic(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadBlob(blob, fileName) {
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "Fichier PDF",
            accept: {
              "application/pdf": [".pdf"],
            },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err?.name === "AbortError") {
        return false;
      }

      console.warn(
        "showSaveFilePicker a échoué, fallback vers téléchargement classique :",
        err
      );
    }
  }

  downloadBlobClassic(blob, fileName);
  return true;
}

/* ---------------------- Pièces jointes ---------------------- */
function guessAttachmentKind(name = "", contentType = "") {
  const n = String(name || "").toLowerCase();
  const t = String(contentType || "").toLowerCase();

  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf") return "pdf";
  if (/\.(png|jpg|jpeg|webp|gif|bmp|heic|heif)$/i.test(n)) return "image";
  if (/\.pdf$/i.test(n)) return "pdf";
  return "unknown";
}

async function listStoredAttachmentsForRecord(year, pp, id) {
  const folderRef = storageRef(storage, remboursementPdfFolder(year, pp, id));
  const res = await listAll(folderRef).catch(() => ({ items: [] }));

  const files = await Promise.all(
    (res.items || []).map(async (itemRef) => {
      const url = await getDownloadURL(itemRef);
      let contentType = "";
      try {
        const meta = await getMetadata(itemRef);
        contentType = meta?.contentType || "";
      } catch {}

      return {
        name: itemRef.name,
        url,
        fullPath: itemRef.fullPath,
        contentType,
        kind: guessAttachmentKind(itemRef.name, contentType),
      };
    })
  );

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteStoredAttachmentsForRecord(year, pp, id) {
  if (!year || !pp || !id) return;

  const folderRef = storageRef(storage, remboursementPdfFolder(year, pp, id));
  const res = await listAll(folderRef).catch(() => ({ items: [] }));

  await Promise.all(
    (res.items || []).map(async (itemRef) => {
      await deleteObject(itemRef);
    })
  );
}

/* ---------------------- Snapshot HTML ---------------------- */
function makeSnapshotHtml(rec) {
  const rows = Array.isArray(rec?.rows) ? rec.rows : [];
  const totals = rec?.totals || {};
  const notes = String(rec?.notes || "");

  const safe = (v) =>
    String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const amountForRow = (r) => {
    const km = parseNumberLoose(r?.km) || 0;
    const taux =
      parseNumberLoose(r?.taux) ?? parseNumberLoose(rec?.globalTaux) ?? 0;
    return km * taux;
  };

  const rowsHtml = rows
    .map(
      (r) => `
        <tr>
          <td style="border:1px solid #94a3b8;padding:8px;vertical-align:top;">${safe(r?.date)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;vertical-align:top;">${safe(r?.lieuDepart)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;vertical-align:top;">${safe(r?.clientOuLieu)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;vertical-align:top;">${safe(r?.adresse)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;text-align:right;vertical-align:top;">${safe(r?.km)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;text-align:right;vertical-align:top;">${safe(r?.taux)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;text-align:right;vertical-align:top;">${safe(amountForRow(r) ? fmtMoney(amountForRow(r)) : "")}</td>
          <td style="border:1px solid #94a3b8;padding:8px;text-align:right;vertical-align:top;">${safe(r?.depenses)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;vertical-align:top;">${safe(r?.typeDeplacement)}</td>
          <td style="border:1px solid #94a3b8;padding:8px;vertical-align:top;">${safe(r?.contrat)}</td>
        </tr>
      `
    )
    .join("");

  return `
    <div style="width:1100px;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;padding:22px;box-sizing:border-box;">
      <div style="border:2px solid #334155;border-radius:14px;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:1px solid #cbd5e1;background:linear-gradient(to bottom,#fff,#f8fafc);">
          <div style="font-size:28px;font-weight:900;">Feuille dépenses</div>
          <div style="margin-top:8px;font-size:20px;font-weight:800;">${safe(rec?.year)} — ${safe(rec?.pp)}</div>
          <div style="margin-top:4px;color:#475569;font-size:15px;">
            ${safe(rec?.ppStart)} → ${safe(rec?.ppEnd)}
          </div>
        </div>

        <div style="padding:16px 18px 6px 18px;">
          <div style="display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:12px;">
            <div style="font-size:24px;font-weight:900;"><b>Employé :</b> ${safe(rec?.employeNom || "—")}</div>
            <div style="font-size:16px;"><b>Date réf. :</b> ${safe(rec?.dateRef || "—")}</div>
          </div>

          <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:16px;">
            <thead>
              <tr>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Date</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Lieu/Départ</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Client / lieu</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Adresse</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">KM</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Taux</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Montant</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Dépenses</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Type</th>
                <th style="border:1px solid #94a3b8;padding:8px;background:#f1f5f9;">Contrat</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || ""}
              <tr>
                <td colspan="4" style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;font-weight:900;text-align:center;">TOTAL</td>
                <td style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;font-weight:900;text-align:right;">${safe(fmtMoney(totals?.kmTotal || 0))}</td>
                <td style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;"></td>
                <td style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;font-weight:900;text-align:right;">${safe(fmtMoney(totals?.montantTotal || 0))}</td>
                <td style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;font-weight:900;text-align:right;">${safe(fmtMoney(totals?.depensesTotal || 0))}</td>
                <td style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;"></td>
                <td style="border:1px solid #94a3b8;padding:10px;background:#eef2ff;font-weight:900;text-align:right;">${safe(fmtMoney(totals?.remboursement || 0))} $</td>
              </tr>
            </tbody>
          </table>

          <div style="margin-top:18px;border:1px solid #cbd5e1;border-radius:12px;padding:12px;background:#fafafa;">
            <div style="font-size:14px;font-weight:900;margin-bottom:8px;">Notes</div>
            <div style="font-size:13px;white-space:pre-wrap;min-height:70px;">${safe(notes || "—")}</div>
          </div>

          <div style="margin-top:16px;display:flex;justify-content:flex-end;">
            <div style="border:1px solid #94a3b8;border-radius:12px;padding:12px 16px;background:#fbfdff;min-width:420px;">
              <div style="text-align:center;font-size:16px;font-weight:900;line-height:1.25;margin-bottom:10px;">
                ${safe(rec?.employeNom || "Employé")} • ${safe(rec?.ppStart || "—")} • ${safe(rec?.pp || "—")}
              </div>

              <div style="margin-top:10px;padding-top:10px;border-top:2px solid #0f172a;display:flex;justify-content:space-between;gap:12px;font-size:16px;font-weight:900;">
                <span>Total remboursement</span>
                <span>${safe(fmtMoney(totals?.remboursement || 0))} $</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function renderSnapshotToPngDataUrl(rec) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-20000px";
  host.style.top = "0";
  host.style.zIndex = "-1";
  host.style.pointerEvents = "none";
  host.innerHTML = makeSnapshotHtml(rec);
  document.body.appendChild(host);

  try {
    const node = host.firstElementChild;
    const canvas = await html2canvas(node, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
    return canvas.toDataURL("image/png");
  } finally {
    document.body.removeChild(host);
  }
}

/* ---------------------- Construction du PDF ---------------------- */
async function buildDownloadPdfForRemboursement(rec, attachments = []) {
  const pdfDoc = await PDFDocument.create();

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const maxW = pageWidth - margin * 2;
  const maxH = pageHeight - margin * 2;

  const pngDataUrl = await renderSnapshotToPngDataUrl(rec);
  const pngBytes = await blobToUint8Array(dataUrlToBlob(pngDataUrl));
  const pngImage = await pdfDoc.embedPng(pngBytes);

  const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
  const pngDims = pngImage.scale(1);
  const scale = Math.min(maxW / pngDims.width, maxH / pngDims.height);

  page1.drawImage(pngImage, {
    x: margin,
    y: pageHeight - margin - pngDims.height * scale,
    width: pngDims.width * scale,
    height: pngDims.height * scale,
  });

  for (const att of attachments) {
    if (!att?.url) continue;

    if (att.kind === "image") {
      const bytes = await urlToUint8Array(att.url);
      const isPng =
        /\.png$/i.test(att.name) ||
        String(att.contentType || "").toLowerCase().includes("png");

      const img = isPng
        ? await pdfDoc.embedPng(bytes)
        : await pdfDoc.embedJpg(bytes);

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const dims = img.scale(1);
      const scaleImg = Math.min(maxW / dims.width, maxH / dims.height);

      page.drawText(`Pièce jointe : ${att.name}`, {
        x: margin,
        y: pageHeight - 16,
        size: 10,
        color: rgb(0.35, 0.35, 0.35),
      });

      page.drawImage(img, {
        x: margin,
        y: pageHeight - margin - dims.height * scaleImg - 14,
        width: dims.width * scaleImg,
        height: dims.height * scaleImg,
      });
    } else if (att.kind === "pdf") {
      const bytes = await urlToUint8Array(att.url);
      const attachedPdf = await PDFDocument.load(bytes);
      const copiedPages = await pdfDoc.copyPages(
        attachedPdf,
        attachedPdf.getPageIndices()
      );
      copiedPages.forEach((p) => pdfDoc.addPage(p));
    }
  }

  return await pdfDoc.save();
}

/* ---------------------- Export principal ---------------------- */
export async function downloadRemboursementPdf(rec) {
  if (!rec?.id || !rec?.year || !rec?.pp) {
    throw new Error("Remboursement invalide.");
  }

  const attachments = await listStoredAttachmentsForRecord(
    rec.year,
    rec.pp,
    rec.id
  );

  const pdfBytes = await buildDownloadPdfForRemboursement(rec, attachments);

  const fileName = `Remboursement_${String(rec.employeNom || "Employe")
    .replace(/[^\w\-]+/g, "_")}_${rec.year}_${rec.pp}_${rec.dateRef || "sans_date"}.pdf`;

  const blob = new Blob([pdfBytes], { type: "application/pdf" });

  const saved = await downloadBlob(blob, fileName);
  return saved;
}