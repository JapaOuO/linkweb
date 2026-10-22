import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeApp } from "firebase/app";

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
export let firebaseApp = null;

if (apiKey) {
  const firebaseConfig = {
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  };

  firebaseApp = initializeApp(firebaseConfig);

  if (typeof window !== "undefined") {
    isSupported().then((supported) => {
      if (supported) getAnalytics(firebaseApp);
    });
  }
}
