// src/remboursement/PopupPDFManagerRemboursement.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Le popup de gestion des pièces jointes d’un remboursement
// - Ajout de PDF / images
// - Prise de photo
// - Liste des fichiers déjà téléversés
// - Suppression des pièces jointes
// - Synchronisation de pdfCount dans Firestore
// -----------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from "react";
import { storage } from "../firebaseConfig";
import { setDoc } from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
} from "firebase/storage";
import {
  itemDocRef,
  remboursementPdfFolder,
  makeSafeUploadName,
} from "./feuilleDepensesUtils";

export default function PopupPDFManagerRemboursement({
  open,
  onClose,
  recRef,
  refreshKey = 0,
  pendingFiles = [],
  onAddPending,
  onRemovePending,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [files, setFiles] = useState([]);

  const inputAnyRef = useRef(null);
  const inputCameraRef = useRef(null);

  const year = recRef?.year;
  const pp = recRef?.pp;
  const id = recRef?.id;

  const syncPdfCountExact = async (count) => {
    if (!year || !pp || !id) return;
    try {
      await setDoc(
        itemDocRef(year, pp, id),
        { pdfCount: Number(count || 0) },
        { merge: true }
      );
    } catch (e) {
      console.error("syncPdfCountExact error", e);
    }
  };

  useEffect(() => {
    if (!open) return;

    if (!year || !pp || !id) {
      setFiles([]);
      setError(null);
      setBusy(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setError(null);
      setBusy(true);

      try {
        const base = storageRef(storage, remboursementPdfFolder(year, pp, id));
        const res = await listAll(base).catch(() => ({ items: [] }));

        const entries = await Promise.all(
          (res.items || []).map(async (itemRef) => {
            const url = await getDownloadURL(itemRef);
            return { name: itemRef.name, url };
          })
        );

        const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) setFiles(sorted);
        await syncPdfCountExact(sorted.length);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError(e?.message || String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, year, pp, id, refreshKey]);

  const pickAnyFile = () => inputAnyRef.current?.click();
  const pickCamera = () => inputCameraRef.current?.click();

  const handlePickedFile = async (file) => {
    if (!file) return;

    const type = String(file.type || "").toLowerCase();
    const isPdf = type === "application/pdf";
    const isImage = type.startsWith("image/");

    if (!isPdf && !isImage) {
      setError("Sélectionne un PDF ou une image/photo.");
      return;
    }

    if (!year || !pp || !id) {
      setError(null);
      onAddPending?.(file);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const name = makeSafeUploadName(file);
      const path = `${remboursementPdfFolder(year, pp, id)}/${name}`;
      const dest = storageRef(storage, path);

      await uploadBytes(dest, file, {
        contentType:
          file.type ||
          (isPdf ? "application/pdf" : "application/octet-stream"),
      });

      const url = await getDownloadURL(dest);

      setFiles((prev) => {
        const next = [...prev, { name, url }].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        syncPdfCountExact(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPickedAny = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await handlePickedFile(file);
  };

  const onPickedCamera = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    await handlePickedFile(file);
  };

  const onDelete = async (name) => {
    if (!year || !pp || !id) return;
    if (!window.confirm(`Supprimer « ${name} » ?`)) return;

    setBusy(true);
    setError(null);

    try {
      const fileRef = storageRef(
        storage,
        `${remboursementPdfFolder(year, pp, id)}/${name}`
      );
      await deleteObject(fileRef);

      setFiles((prev) => {
        const next = prev.filter((f) => f.name !== name);
        syncPdfCountExact(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const totalCount = (pendingFiles?.length || 0) + (files?.length || 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          width: "min(760px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 28px 64px rgba(0,0,0,0.30)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 22 }}>
            Pièces jointes – Remboursement
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
            title="Fermer"
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        {error ? (
          <div
            style={{
              background: "#fdecea",
              color: "#b71c1c",
              border: "1px solid #f5c6cb",
              padding: "10px 14px",
              borderRadius: 12,
              marginBottom: 12,
              fontWeight: 900,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={pickAnyFile}
            disabled={busy}
            style={{
              border: "2px solid #0f172a",
              background: "#0f172a",
              color: "#fff",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 1000,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Téléversement..." : "Ajouter PDF ou photo"}
          </button>

          <button
            onClick={pickCamera}
            disabled={busy}
            style={{
              border: "2px solid #2563eb",
              background: "#2563eb",
              color: "#fff",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 1000,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Téléversement..." : "📷 Prendre une photo"}
          </button>

          <input
            ref={inputAnyRef}
            type="file"
            accept="application/pdf,image/*"
            onChange={onPickedAny}
            style={{ display: "none" }}
          />

          <input
            ref={inputCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPickedCamera}
            style={{ display: "none" }}
          />

          <div style={{ fontWeight: 900, color: "#64748b" }}>
            {totalCount} fichier(s)
          </div>
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #eee",
            borderRadius: 14,
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ background: "#e5e7eb" }}>
              <th
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderBottom: "1px solid #e0e0e0",
                  fontWeight: 1000,
                }}
              >
                Nom
              </th>
              <th
                style={{
                  textAlign: "center",
                  padding: 10,
                  borderBottom: "1px solid #e0e0e0",
                  fontWeight: 1000,
                }}
              >
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {(pendingFiles || []).map((p) => (
              <tr key={`pending_${p.name}`}>
                <td
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    wordBreak: "break-word",
                  }}
                >
                  <div style={{ fontWeight: 900 }}>{p.name}</div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      color: "#b45309",
                    }}
                  >
                    En attente (sera upload à l’enregistrement)
                  </div>
                </td>

                <td
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      gap: 10,
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    <a
                      href={p.localUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        border: "none",
                        background: "#0ea5e9",
                        color: "#fff",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 1000,
                        textDecoration: "none",
                      }}
                    >
                      Aperçu
                    </a>

                    <button
                      onClick={() => onRemovePending?.(p.name)}
                      style={{
                        border: "1px solid #ef4444",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 1000,
                      }}
                    >
                      Retirer
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {files.map((f) => (
              <tr key={f.name}>
                <td
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    wordBreak: "break-word",
                  }}
                >
                  {f.name}
                </td>

                <td
                  style={{
                    padding: 10,
                    borderBottom: "1px solid #eee",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      gap: 10,
                      flexWrap: "wrap",
                      justifyContent: "center",
                    }}
                  >
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        border: "none",
                        background: "#0ea5e9",
                        color: "#fff",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                        fontWeight: 1000,
                        textDecoration: "none",
                      }}
                    >
                      Ouvrir
                    </a>

                    <button
                      onClick={() => onDelete(f.name)}
                      disabled={busy}
                      style={{
                        border: "1px solid #ef4444",
                        background: "#fee2e2",
                        color: "#b91c1c",
                        borderRadius: 12,
                        padding: "8px 10px",
                        cursor: busy ? "not-allowed" : "pointer",
                        fontWeight: 1000,
                        opacity: busy ? 0.6 : 1,
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {busy && totalCount === 0 ? (
                <tr>
                    <td
                    colSpan={2}
                    style={{ padding: 14, color: "#666", textAlign: "center", fontWeight: 900 }}
                    >
                    Chargement des fichiers...
                    </td>
                </tr>
                ) : !busy && totalCount === 0 ? (
                <tr>
                    <td
                    colSpan={2}
                    style={{ padding: 14, color: "#666", textAlign: "center" }}
                    >
                    Aucun fichier.
                    </td>
                </tr>
                ) : null}
          </tbody>
        </table>

        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}
        >
          <button
            onClick={onClose}
            style={{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 14,
              padding: "10px 14px",
              cursor: "pointer",
              fontWeight: 900,
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}