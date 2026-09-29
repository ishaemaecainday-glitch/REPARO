import { db, requireAuth } from "./firebase-core.js";

import {
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const form = document.getElementById("profileServiceForm");
const status = document.getElementById("profileServiceStatus");
const saveButton = document.getElementById("saveProfileService");

let savedProfile = null;
let editing = false;
let unsubscribe = null;

function showStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b42318" : "#238b7c";
}

function fillForm(profile) {
  form.elements.serviceCategory.value =
    profile.serviceCategory || "";

  form.elements.skills.value =
    Array.isArray(profile.skills)
      ? profile.skills.join(", ")
      : typeof profile.skills === "string"
        ? profile.skills
        : "";

  form.elements.price.value = profile.price ?? "";
  form.elements.availability.value = profile.availability || "";
  form.elements.bio.value = profile.bio || "";
}

async function start() {
  const ctx = await requireAuth(["provider"]);
  if (!ctx) return;

  const userRef = doc(db, "users", ctx.user.uid);

  showStatus("Loading your saved service details…");

  unsubscribe = onSnapshot(
    userRef,
    snapshot => {
      if (!snapshot.exists()) {
        showStatus("Your provider profile was not found.", true);
        return;
      }

      savedProfile = snapshot.data();

      // Keep what the provider is typing if Firestore updates.
      if (!editing) {
        fillForm(savedProfile);
        showStatus("");
      }
    },
    error => {
      console.error("Load service details:", error);
      showStatus(
        "Could not load your details. Check your connection and reload.",
        true
      );
    }
  );

  form.addEventListener("input", () => {
    editing = true;
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!savedProfile || !form.reportValidity()) return;

    const serviceCategory =
      form.elements.serviceCategory.value.trim();

    const skills = [
      ...new Set(
        form.elements.skills.value
          .split(",")
          .map(skill => skill.trim())
          .filter(Boolean)
      )
    ];

    const priceText = form.elements.price.value.trim();
    const price = priceText === "" ? "" : Number(priceText);

    if (!serviceCategory) {
      showStatus("Enter your service category.", true);
      return;
    }

    if (skills.length > 30) {
      showStatus("Enter no more than 30 skills.", true);
      return;
    }

    if (
      price !== "" &&
      (!Number.isFinite(price) || price < 0 || price > 1000000)
    ) {
      showStatus("Enter a valid service rate.", true);
      return;
    }

    const changes = {
      serviceCategory,
      skills,
      price,
      availability:
        form.elements.availability.value.trim(),
      bio:
        form.elements.bio.value.trim(),
      updatedAt: serverTimestamp()
    };

    saveButton.disabled = true;
    showStatus("Saving service details…");

    try {
      await updateDoc(userRef, changes);

      savedProfile = { ...savedProfile, ...changes };
      editing = false;

      showStatus("Service details saved successfully.");

      setTimeout(() => {
        location.href = "rm-profile.html";
      }, 900);
    } catch (error) {
      console.error("Save service details:", error);
      showStatus(
        "Could not save your changes. Please try again.",
        true
      );
      saveButton.disabled = false;
    }
  });
}

window.addEventListener("pagehide", () => {
  unsubscribe?.();
});

start().catch(error => {
  console.error("Open service details:", error);
  showStatus(
    "Could not open service details. Please reload.",
    true
  );
});
