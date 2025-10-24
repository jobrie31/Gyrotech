// src/firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getStorage } from "firebase/storage";

// ⚙️ Config de ton projet
const firebaseConfig = {
  apiKey: "AIzaSyDPjKwMAhzACa0w4xyebpcsJkeStjiDyYM",
  authDomain: "gyrotech-a3234.firebaseapp.com",
  projectId: "gyrotech-a3234",

  // ✅ utilise le VRAI bucket (celui que tu vois dans Cloud Console)
  storageBucket: "gyrotech-a3234.firebasestorage.app",

  messagingSenderId: "1006226251481",
  appId: "1:1006226251481:web:45f06094e07b40f2b828c8",
};

// 🔥 Init
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ✅ force aussi le bucket côté SDK (optionnel mais sûr)
export const storage = getStorage(app, "gs://gyrotech-a3234.firebasestorage.app");

// 👤 Auth + connexion anonyme auto (persistance locale)
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => { /* ignore */ });

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // si personne n’est connecté, on connecte en anonyme
    signInAnonymously(auth).catch((e) =>
      console.error("Anon auth failed:", e)
    );
  } else {
    // utile pour debugger
    console.log("Signed in as:", user.email || `anon:${user.uid}`);
  }
});
