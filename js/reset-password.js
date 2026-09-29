import { auth, firebaseConfigured, showFirebaseConfigError } from "./firebase-core.js";
import { verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

document.addEventListener("DOMContentLoaded", async () => {
  if (!firebaseConfigured) return showFirebaseConfigError();
  const form = document.getElementById("resetPasswordForm");
  const email = document.getElementById("resetEmail");
  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmNewPassword");
  const status = document.getElementById("resetStatus");
  const show = (m, e = false) => { if (status) { status.textContent = m; status.style.color = e ? "#dc3545" : "#198754"; } };
  const params = new URLSearchParams(location.search);
  const oobCode = params.get("oobCode");
  if (!oobCode) return show("Invalid password reset link.", true);
  try {
    const userEmail = await verifyPasswordResetCode(auth, oobCode);
    if (email) email.value = userEmail;
  } catch (error) {
    console.error(error);
    return show("This password reset link is invalid or expired.", true);
  }
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const p = newPassword?.value || "";
    const c = confirmPassword?.value || "";
    if (p.length < 8) return show("Password must be at least 8 characters.", true);
    if (!/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/[0-9]/.test(p) || !/[^A-Za-z0-9]/.test(p)) return show("Use uppercase, lowercase, number, and special character.", true);
    if (p !== c) return show("Passwords do not match.", true);
    try {
      await confirmPasswordReset(auth, oobCode, p);
      show("Password changed successfully. Redirecting to login...");
      setTimeout(() => location.href = "login.html", 1200);
    } catch (error) {
      console.error(error);
      show("Could not change password. The link may have expired.", true);
    }
  });
});
