// src/remboursement/feuilleDepensesUtils.jsx
// -----------------------------------------------------------------------------
// CE CODE CONTIENT :
// - Les fonctions utilitaires générales
// - Le format d'argent
// - Le parsing des nombres / dates
// - Les helpers de périodes de paie (PP)
// - Les helpers Firestore
// - Les helpers Storage
// - Les helpers de nom d'employé / fichiers
// -----------------------------------------------------------------------------

import { collection, doc } from "firebase/firestore";
import { db } from "../firebaseConfig";

/* ---------------------- Utils générales ---------------------- */
export function fmtMoney(n) {
  const x = Number(n || 0);
  return x.toLocaleString("fr-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseNumberLoose(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return n;
}

export function formatYYYYMMDDInput(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function parseISO_YYYYMMDD(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;

  const dt = new Date(y, mo - 1, d);
  dt.setHours(0, 0, 0, 0);

  if (Number.isNaN(dt.getTime())) return null;

  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }

  return dt;
}

export function startOfSunday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function sundayOnOrBefore(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function fmtDateISO(d) {
  if (!d) return "—";

  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

export function fallbackNameFromUser(user, initialEmploye = "Jo") {
  const display = String(user?.displayName || "").trim();
  if (display) return display;

  const email = String(user?.email || "").trim().toLowerCase();
  if (email) {
    const local = email.split("@")[0] || "";
    if (local) {
      return local
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase())
        .trim();
    }
  }

  return initialEmploye;
}

export function makeSafeUploadName(file) {
  const original = String(file?.name || "fichier").trim();
  const safeBase = original.replace(/[^\w.\-()]/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const lowerType = String(file?.type || "").toLowerCase();
  const hasExt = /\.[a-z0-9]{2,6}$/i.test(safeBase);

  if (hasExt) return `${stamp}_${safeBase}`;
  if (lowerType === "application/pdf") return `${stamp}_${safeBase}.pdf`;

  if (lowerType.startsWith("image/")) {
    const ext = (lowerType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "");
    return `${stamp}_${safeBase}.${ext}`;
  }

  return `${stamp}_${safeBase}`;
}

/* ---------------------- Helpers PP ---------------------- */

export function getCyclePP1StartForDate(anyDate) {
  const d = anyDate instanceof Date ? new Date(anyDate) : new Date(anyDate);
  d.setHours(0, 0, 0, 0);

  const y = d.getFullYear();
  const dec14ThisYear = new Date(y, 11, 14);
  dec14ThisYear.setHours(0, 0, 0, 0);

  const pp1ThisYear = sundayOnOrBefore(dec14ThisYear);

  if (d >= pp1ThisYear) return pp1ThisYear;

  const dec14PrevYear = new Date(y - 1, 11, 14);
  dec14PrevYear.setHours(0, 0, 0, 0);

  return sundayOnOrBefore(dec14PrevYear);
}

export function getPPFromPayBlockStart(payBlockStart) {
  const start =
    payBlockStart instanceof Date
      ? new Date(payBlockStart)
      : new Date(payBlockStart);

  start.setHours(0, 0, 0, 0);

  const pp1 = getCyclePP1StartForDate(start);
  const diffDays = Math.floor((start.getTime() - pp1.getTime()) / 86400000);
  const idx = Math.floor(diffDays / 14) + 1;

  if (idx < 1 || idx > 26) {
    return {
      pp: "PP?",
      index: null,
      start: null,
      end: null,
    };
  }

  return {
    pp: `PP${idx}`,
    index: idx,
    start,
    end: addDays(start, 13),
  };
}

export function buildPPTabs() {
  return Array.from({ length: 26 }, (_, i) => `PP${i + 1}`);
}

export function ppStartForYearAndPP(year, ppIndex1to26) {
  const idx = Number(ppIndex1to26);

  if (!Number.isFinite(idx) || idx < 1 || idx > 26) {
    const fallback = new Date(Number(year), 0, 1);
    fallback.setHours(0, 0, 0, 0);
    return { start: fallback, end: addDays(fallback, 13) };
  }

  const anchor = new Date(Number(year), 0, 10);
  anchor.setHours(0, 0, 0, 0);

  const pp1 = getCyclePP1StartForDate(anchor);
  const start = addDays(pp1, (idx - 1) * 14);
  const end = addDays(start, 13);

  return { start, end };
}

/* ---------------------- Firestore paths ---------------------- */
export function itemsColRef(year, pp) {
  return collection(
    db,
    "depensesRemboursements",
    String(year),
    "pps",
    String(pp),
    "items"
  );
}

export function itemDocRef(year, pp, id) {
  return doc(
    db,
    "depensesRemboursements",
    String(year),
    "pps",
    String(pp),
    "items",
    String(id)
  );
}

/* ---------------------- Storage paths ---------------------- */
export function remboursementPdfFolder(year, pp, id) {
  return `depensesRemboursements/${String(year)}/${String(pp)}/items/${String(
    id
  )}/pdfs`;
}