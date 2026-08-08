// Real Firebase config for project naluno-28a00.
// This object is NOT a secret — it's meant to be public in client-side code.
// Firestore access is controlled by firestore.rules, not by hiding this file.

const firebaseConfig = {
  apiKey: "AIzaSyD0j1W7-gFJqbMd6rz4kMhQd5AiB8B2ox0",
  authDomain: "naluno-28a00.firebaseapp.com",
  projectId: "naluno-28a00",
  storageBucket: "naluno-28a00.firebasestorage.app",
  messagingSenderId: "183354363901",
  appId: "1:183354363901:web:e1a4c4eb30ad5937d39394"
};

// Web Push VAPID key (from Firebase Console → Project settings → Cloud Messaging →
// Web configuration → Web Push certificates). Required for call notifications
// when the app is closed.
const VAPID_KEY = "BAU9gGiDeFF9GcX42d0D7mjatsjJlCqs5jq8p02p-ObC9z2G5ELg49bTnObj7B1DOhGaKoaj7Iha3MUVsBIF7Ts";

// Google Sign-In for the Android shell (native plugin).
// Use the WEB OAuth client ID from Google Cloud Console / Firebase
// (type "Web client", ends in .apps.googleusercontent.com) — NOT the Android client ID.
// See GOOGLE-AUTH-SETUP.md
const GOOGLE_WEB_CLIENT_ID = "YOUR_WEB_CLIENT_ID.apps.googleusercontent.com";
