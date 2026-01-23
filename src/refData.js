// src/refData.js
import { db } from "./firebaseConfig";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  setDoc,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";

/**
 * Schéma Firestore proposé:
 * - Collection "reglages_annees": documents (id auto) { value: 2025 } triés desc
 * - Collection "reglages_marques": documents (id auto) { name: "Toyota" }
 *    - Subcollection "modeles": documents (id auto) { name: "RAV4" }
 *
 * ✅ AJOUT:
 * - Collection "reglages_clients": documents (id = clé stable) { name: "Garage ABC", nameLower: "garage abc" }
 *
 * Stockage dans les projets: on écrit les chaînes (annee: Number, marque: string, modele: string, clientNom: string)
 */

/* -------------------- HOOKS -------------------- */
export function useAnnees() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    // ⬇️ tri croissant (plus petit -> plus grand)
    const q = query(collection(db, "reglages_annees"), orderBy("value", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => {
        const data = d.data();
        if (typeof data?.value === "number") {
          arr.push({ id: d.id, value: data.value });
        }
      });
      setItems(arr);
    });
    return () => unsub();
  }, []);
  return items;
}

export function useMarques() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "reglages_marques"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data?.name) arr.push({ id: d.id, name: data.name });
      });
      setItems(arr);
    });
    return () => unsub();
  }, []);
  return items;
}

export function useModeles(marqueId) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!marqueId) {
      setItems([]);
      return;
    }
    const q = query(
      collection(db, "reglages_marques", marqueId, "modeles"),
      orderBy("name", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data?.name) arr.push({ id: d.id, name: data.name });
      });
      setItems(arr);
    });
    return () => unsub();
  }, [marqueId]);
  return items;
}

/* -------------------- ✅ CLIENTS -------------------- */
export function useClients() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "reglages_clients"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      const arr = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data?.name) arr.push({ id: d.id, name: data.name });
      });
      setItems(arr);
    });
    return () => unsub();
  }, []);
  return items;
}

/* -------------------- HELPERS (CRUD) -------------------- */
export async function addAnnee(value) {
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1900 || v > 3000) {
    throw new Error("Année invalide.");
  }
  // setDoc avec id = value pour éviter les doublons
  const ref = doc(db, "reglages_annees", String(v));
  await setDoc(ref, { value: v });
}

export async function deleteAnnee(id) {
  await deleteDoc(doc(db, "reglages_annees", id));
}

export async function addMarque(name) {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Nom de marque requis.");
  await addDoc(collection(db, "reglages_marques"), { name: clean });
}

export async function deleteMarque(marqueId) {
  // ATTENTION: ceci ne supprime pas récursivement la subcollection "modeles".
  // Pour rester simple, on laisse l’admin effacer la marque uniquement si pas de modèles,
  // sinon il faut d’abord supprimer les modèles.
  await deleteDoc(doc(db, "reglages_marques", marqueId));
}

export async function addModele(marqueId, name) {
  if (!marqueId) throw new Error("Marque invalide.");
  const clean = (name || "").trim();
  if (!clean) throw new Error("Nom de modèle requis.");
  await addDoc(collection(db, "reglages_marques", marqueId, "modeles"), { name: clean });
}

export async function deleteModele(marqueId, modeleId) {
  if (!marqueId || !modeleId) return;
  await deleteDoc(doc(db, "reglages_marques", marqueId, "modeles", modeleId));
}

/* -------------------- ✅ CRUD CLIENTS -------------------- */
function clientKey(name) {
  const clean = (name || "").toString().trim();
  const lower = clean.toLowerCase();

  // clé stable + safe pour doc id (évite /, etc.)
  // ex: "Garage ABC inc." => "garage%20abc%20inc."
  const key = encodeURIComponent(lower.replace(/\s+/g, " ").trim());
  return { clean, lower, key };
}

export async function addClient(name) {
  const { clean, lower, key } = clientKey(name);
  if (!clean) throw new Error("Nom de client requis.");

  // setDoc avec id stable => évite doublons (comme tes années)
  const ref = doc(db, "reglages_clients", key);
  await setDoc(ref, { name: clean, nameLower: lower });
}

export async function deleteClient(id) {
  if (!id) return;
  await deleteDoc(doc(db, "reglages_clients", id));
}

/* -------------------- UTILS -------------------- */
export function findMarqueIdByName(marques, name) {
  const target = (name || "").trim().toLowerCase();
  const found = marques.find((m) => m.name.trim().toLowerCase() === target);
  return found?.id || null;
}

export function useMarqueIdFromName(marques, currentName) {
  return useMemo(() => findMarqueIdByName(marques, currentName), [marques, currentName]);
}
