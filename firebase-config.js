// Replace these with the values from your own Firebase project:
// console.firebase.google.com → your project → Project settings → your web app
//
// This object is NOT a secret — it's meant to be public in client-side code.
// Firestore access is controlled by firestore.rules, not by hiding this file.

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Needed only for "Enable call notifications" in Callsign (push, even when the app
// is closed). Get this from: Firebase console → Project settings → Cloud Messaging →
// Web configuration → Web Push certificates → Generate key pair.
const VAPID_KEY = "YOUR_VAPID_KEY";
