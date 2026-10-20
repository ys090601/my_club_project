import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDV9kO0FKmE4jiByOFHVW4ZDCo6J2UykiI",
  authDomain: "my-club-app-ab829.firebaseapp.com",
  projectId: "my-club-app-ab829",
  storageBucket: "my-club-app-ab829.firebasestorage.app",
  messagingSenderId: "21584403143",
  appId: "1:21584403143:web:8db2293f63e0bac3b33ce2"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);