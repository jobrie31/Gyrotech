// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";   // 👈 NEW

// ⚙️ Config de ton projet
const firebaseConfig = {
  apiKey: "AIzaSyDPjKwMAhzACa0w4xyebpcsJkeStjiDyYM",
  authDomain: "gyrotech-a3234.firebaseapp.com",
  projectId: "gyrotech-a3234",

  // si ce bucket marche pour toi, garde-le
  storageBucket: "gyrotech-a3234.firebasestorage.app",

  messagingSenderId: "1006226251481",
  appId: "1:1006226251481:web:45f06094e07b40f2b828c8",
};

// 🔥 Init
const app = initializeApp(firebaseConfig);

// 🔎 Firestore
export const db = getFirestore(app);

// ✅ Storage
export const storage = getStorage(app, "gs://gyrotech-a3234.firebasestorage.app");

// ☁️ Cloud Functions (pour sendInvoiceEmail)
export const functions = getFunctions(app);

// 👤 Auth (PERSISTENCE SEULEMENT, PAS de login auto anonyme)
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Erreur de persistance auth:", err);
});
