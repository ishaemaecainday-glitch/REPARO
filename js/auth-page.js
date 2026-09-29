import { auth, db, firebaseConfigured, showFirebaseConfigError, ensureUserProfile, routeForRole } from "./firebase-core.js";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
  if (!firebaseConfigured) return showFirebaseConfigError();

  const form = document.getElementById("loginForm");
  const email = document.getElementById("email");
  const password = document.getElementById("password");
  const toggle = document.getElementById("togglePassword");
  const googleBtn = document.getElementById("googleBtn");
  const forgot = document.querySelector(".forgot-password");
  let status = document.getElementById("authStatus");

  const show = (message, error = false) => {
    if (!status) {
      status = document.createElement("p");
      status.id = "authStatus";
      form?.appendChild(status);
    }
    status.textContent = message;
    status.style.color = error ? "#dc3545" : "#198754";
  };

  toggle?.addEventListener("click", () => {
    if (!password) return;
    password.type = password.type === "password" ? "text" : "password";
    toggle.setAttribute("aria-label", password.type === "password" ? "Show password" : "Hide password");
  });async function finishLogin(user) {

    try {

        console.log(
            "AUTH UID:",
            user.uid
        );

        console.log(
            "AUTH EMAIL:",
            user.email
        );


        // Read the EXACT Firestore document
        // that belongs to the authenticated UID
        const userRef =
            doc(
                db,
                "users",
                user.uid
            );


        const userSnap =
            await getDoc(userRef);


        // =========================================
        // USER DOCUMENT DOES NOT EXIST
        // =========================================

        if (!userSnap.exists()) {

            console.error(
                "No Firestore user document for UID:",
                user.uid
            );


            show(
                `Account profile not found. UID: ${user.uid}`,
                true
            );


            return;
        }


        // =========================================
        // GET FIRESTORE PROFILE
        // =========================================

        const userData =
            userSnap.data();


        const role =
            String(
                userData.role || ""
            )
            .trim()
            .toLowerCase();


        console.log(
            "FIRESTORE USER:",
            userData
        );


        console.log(
            "DETECTED ROLE:",
            role
        );


        // =========================================
        // ADMIN
        // =========================================

        if (role === "admin") {

            console.log(
                "Redirecting ADMIN..."
            );


            window.location.replace(
                "admin-index.html"
            );

            return;
        }


        // =========================================
        // PROVIDER
        // =========================================

        if (role === "provider") {

            console.log(
                "Redirecting PROVIDER..."
            );


            window.location.replace(
                "rm-index.html"
            );

            return;
        }


        // =========================================
        // CUSTOMER
        // =========================================

        console.log(
            "Redirecting CUSTOMER..."
        );


        window.location.replace(
            "index.html"
        );


    } catch (error) {

        console.error(
            "LOGIN PROFILE ERROR:",
            error
        );


        show(
            error.message ||
            "Could not load account profile.",
            true
        );

    }

}
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!email?.value.trim() || !password?.value) return show("Enter your email and password.", true);
    try {
      show("Signing in...");
      const credential = await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      show("Login successful.");
      await finishLogin(credential.user);
    } catch (error) {
      console.error(error);
      const code = error.code || "";
      show(code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")
        ? "Incorrect email or password." : error.message, true);
    }
  });

  googleBtn?.addEventListener("click", async () => {
    try {
      show("Opening Google...");
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(auth, provider);
      await ensureUserProfile(result.user);
      await finishLogin(result.user);
    } catch (error) {
      console.error(error);
      show(error.code === "auth/popup-closed-by-user" ? "Google sign-in was cancelled." : error.message, true);
    }
  });

  forgot?.addEventListener("click", async event => {
    event.preventDefault();
    const value = email?.value.trim();
    if (!value) {
      show("Enter your registered email address first.", true);
      email?.focus();
      return;
    }
    try {
      await sendPasswordResetEmail(auth, value);
      show("Password reset email sent. Check your inbox or spam folder.");
    } catch (error) {
      console.error(error);
      show(error.code === "auth/invalid-email" ? "Enter a valid email address." : error.message, true);
    }
  });
});
