// File: frontend/src/firebase-config.js

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBqtn4sg8Zsyi_29lYrKgL6Vqmr-ZR2yX8",
  authDomain: "gardisen-quality-inspections.firebaseapp.com",
  projectId: "gardisen-quality-inspections",
  storageBucket: "gardisen-quality-inspections.firebasestorage.app",
  messagingSenderId: "597599413079",
  appId: "1:597599413079:web:6f94050bd865de9d209412",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize and export Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;