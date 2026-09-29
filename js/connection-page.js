import { auth, db, firebaseConfigured } from "./firebase-core.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
const out = document.getElementById("connectionOutput");
const say = (m, ok = true) => { if (out) out.innerHTML = `<p style="color:${ok ? '#198754' : '#dc3545'}">${m}</p>`; };
if (!firebaseConfigured) say("Firebase config is incomplete.", false);
else onAuthStateChanged(auth, async user => {
  if (!user) return say("Firebase initialized. Sign in first to test Firestore read/write.");
  try {
    const r = doc(db, "connectionChecks", user.uid);
    await setDoc(r, { uid: user.uid, checkedAt: serverTimestamp() });
    const s = await getDoc(r);
    say(s.exists() ? "Firebase Authentication + Firestore connection is working." : "Firestore test failed.", s.exists());
  } catch (e) { say(e.message, false); }
});
