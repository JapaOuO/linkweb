import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCJqwIm3fsFY2FPUjx5R-7PrUxDEedRJfA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "webeduc-6e7ed.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "webeduc-6e7ed",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "webeduc-6e7ed.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "900773527249",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:900773527249:web:8b72a0df26f991b3734ff0",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-5205ZYM91E",
};

export const firebaseApp = initializeApp(firebaseConfig);

if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) getAnalytics(firebaseApp);
  });
}
