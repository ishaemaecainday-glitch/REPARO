export const firebaseConfig = {
  apiKey: "AIzaSyA_Ho1U6a7wErOEj4VitGJynLSKxOFNiB0",
  authDomain: "reparo-80852.firebaseapp.com",
  projectId: "reparo-80852",
  storageBucket: "reparo-80852.firebasestorage.app",
  messagingSenderId: "815724135829",
  appId: "1:815724135829:web:d2b671cda44bd61667a29c",
  measurementId: "G-TQ9VNRC954"
};

export const firebaseConfigured = Object.values(firebaseConfig).every(
  value => typeof value === "string" && value.trim() && !value.includes("REPLACE_ME")
);
