import { auth, db, firebaseConfigured, showFirebaseConfigError } from "./firebase-core.js";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  if (!firebaseConfigured) return showFirebaseConfigError();

  const form = document.getElementById("signupForm");
  const fullName = document.getElementById("fullName") || document.getElementById("displayName");
  const email = document.getElementById("email") || document.getElementById("signupEmail");
  const password = document.getElementById("password") || document.getElementById("signupPassword");
  const confirmPassword = document.getElementById("confirmPassword");
  const status = document.getElementById("signupStatus");
  const toggle = document.getElementById("toggleSignupPassword");
  const googleBtn = document.getElementById("googleSignupBtn");

  const show = (msg, err = false) => {
    if (status) {
      status.textContent = msg;
      status.style.color = err ? "#dc3545" : "#198754";
    }
  };

  toggle?.addEventListener("click", () => {
    password.type = password.type === "password" ? "text" : "password";
  });

  const validate = (p, c) => {
    if (p.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(p)) return "Password must contain an uppercase letter.";
    if (!/[a-z]/.test(p)) return "Password must contain a lowercase letter.";
    if (!/[0-9]/.test(p)) return "Password must contain a number.";
    if (!/[^A-Za-z0-9]/.test(p)) return "Password must contain a special character.";
    if (p !== c) return "Passwords do not match.";
    return "";
  };

  const liveMatch = () => {
    if (!confirmPassword?.value) return;
    show(password.value === confirmPassword.value ? "Passwords match." : "Passwords do not match.", password.value !== confirmPassword.value);
  };
  password?.addEventListener("input", liveMatch);
  confirmPassword?.addEventListener("input", liveMatch);

  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const nameValue = fullName?.value.trim() || "";
    const emailValue = email?.value.trim() || "";
    const passValue = password?.value || "";
    const confirmValue = confirmPassword?.value || "";

    if (!nameValue) return show("Please enter your full name.", true);
    if (!emailValue) return show("Please enter your email address.", true);
    const issue = validate(passValue, confirmValue);
    if (issue) return show(issue, true);

    try {
      show("Creating account...");
      const credential = await createUserWithEmailAndPassword(auth, emailValue, passValue);
      const user = credential.user;
      await updateProfile(user, { displayName: nameValue });
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        displayName: nameValue,
        email: emailValue,
        photoURL: "",
        role: "user",
        provider: "password",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await signOut(auth);
      show("Account created successfully! Redirecting to login...");
      setTimeout(() => location.href = "login.html", 900);
    } catch (error) {
      console.error(error);
      const messages = {
        "auth/email-already-in-use": "This email is already registered.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/weak-password": "Password is too weak.",
        "auth/operation-not-allowed": "Email/Password signup is not enabled in Firebase."
      };
      show(messages[error.code] || error.message, true);
    }
  });

  googleBtn?.addEventListener("click", async () => {
    try {
      show("Opening Google...");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const ref = doc(db, "users", user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          uid: user.uid,
          displayName: user.displayName || "REPARO User",
          email: user.email || "",
          photoURL: user.photoURL || "",
          role: "user",
          provider: "google",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
      location.href = "index.html";
    } catch (error) {
      console.error(error);
      show(error.code === "auth/unauthorized-domain" ? "Add this domain to Firebase Authentication Authorized domains." : error.message, true);
    }
  });
});
