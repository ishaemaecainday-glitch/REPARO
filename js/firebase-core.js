import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

let app = null;
let auth = null;
let db = null;
let storage = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, db, storage, firebaseConfigured, firebaseConfig };

export function showFirebaseConfigError() {
  console.error("Firebase configuration is incomplete.");
  const el = document.getElementById("authStatus") || document.getElementById("signupStatus") || document.getElementById("resetStatus");
  if (el) {
    el.textContent = "Firebase configuration is incomplete.";
    el.style.color = "#dc3545";
  }
}

export async function ensureUserProfile(user, defaults = {}) {
  if (!db || !user) return null;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      displayName: user.displayName || defaults.displayName || "REPARO User",
      email: user.email || defaults.email || "",
      photoURL: user.photoURL || "",
      role: defaults.role || "user",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  const latest = await getDoc(ref);
  return latest.exists() ? latest.data() : null;
}

export async function getUserProfile(uid) {
  if (!db || !uid) return null;
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function waitForUser() {
  return new Promise(resolve => {
    if (!auth) return resolve(null);
    const unsub = onAuthStateChanged(auth, user => {
      unsub();
      resolve(user || null);
    });
  });
}

export function routeForRole(role) {
  if (role === "admin") return "admin-index.html";
  if (role === "provider") return "rm-index.html";
  return "index.html";
}

export async function requireAuth(allowedRoles = null) {
  const user = await waitForUser();
  if (!user) {
    const next = encodeURIComponent(location.pathname.split("/").pop() || "index.html");
    location.href = `login.html?next=${next}`;
    return null;
  }
  const profile = await ensureUserProfile(user);
  if (Array.isArray(allowedRoles) && !allowedRoles.includes(profile?.role)) {
    location.href = routeForRole(profile?.role || "user");
    return null;
  }
  return { user, profile };
}

export function installLogoutHandlers(root = document) {
  const candidates = [...root.querySelectorAll("a,button")].filter(el => /log\s*out/i.test(el.textContent || ""));
  candidates.forEach(el => {
    el.addEventListener("click", async event => {
      event.preventDefault();
      try { await signOut(auth); } catch (e) { console.error(e); }
      location.href = "login.html";
    });
  });
}

export function applyProfileToPage(profile, user) {
  const name = profile?.displayName || user?.displayName || "REPARO User";
  const email = profile?.email || user?.email || "";

  document.querySelectorAll(".greeting-text strong,.profile-fullname,.user-name,.drawer-user-info h3,.sidebar-profile h3").forEach(el => {
    if (el.classList.contains("sidebar-profile")) return;
    if ((el.textContent || "").trim().toLowerCase() !== "admin" || profile?.role === "admin") el.textContent = profile?.role === "admin" && el.matches(".sidebar-profile h3") ? "Admin" : name;
  });
  document.querySelectorAll(".profile-email,.user-email,.sidebar-profile p").forEach(el => {
    if (el.matches(".sidebar-profile p") && profile?.role !== "admin") return;
    el.textContent = email;
  });
}

export function flash(message, type = "success") {
  let box = document.getElementById("reparoToast");
  if (!box) {
    box = document.createElement("div");
    box.id = "reparoToast";
    Object.assign(box.style, {
      position: "fixed", left: "50%", bottom: "88px", transform: "translateX(-50%)",
      zIndex: "99999", maxWidth: "90%", padding: "10px 14px", borderRadius: "10px",
      color: "#fff", fontSize: "13px", boxShadow: "0 6px 20px rgba(0,0,0,.18)"
    });
    document.body.appendChild(box);
  }
  box.style.background = type === "error" ? "#dc3545" : "#198754";
  box.textContent = message;
  box.style.display = "block";
  clearTimeout(box._t);
  box._t = setTimeout(() => box.style.display = "none", 3000);
}
