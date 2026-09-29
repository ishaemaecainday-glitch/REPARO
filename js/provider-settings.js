import {
  auth,
  db,
  requireAuth
} from "./firebase-core.js";

import {
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  CLOUDINARY_CONFIG
} from "./cloudinary-config.js";

let portfolioItems = [];

function setupPortfolioFields() {
  const section = document.createElement("div");

  section.innerHTML = `
    <label for="settingsAvailability">
      Availability / working hours
    </label>

    <input
      id="settingsAvailability"
      data-field="availability"
      type="text"
      maxlength="200"
      placeholder="Monday–Saturday, 8 AM–5 PM"
    >

    <label for="settingsWorkPhotos">Work photos</label>

    <input
      id="settingsWorkPhotos"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
    >

    <p class="muted">
      Add up to 10 photos, maximum 5 MB each.
      Click Save Services to save your changes.
    </p>

    <div id="settingsPortfolioPreview"></div>
  `;

  serviceForm
    .querySelector(".form-actions")
    .before(section);

  const style = document.createElement("style");

  style.textContent = `
    #settingsPortfolioPreview {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 14px 0;
    }

    #settingsPortfolioPreview:empty {
      display: none;
    }

    #settingsPortfolioPreview figure {
      margin: 0;
      padding: 8px;
      min-width: 0;
      border: 1px solid #dce9e5;
      border-radius: 12px;
      background: white;
    }

    #settingsPortfolioPreview img {
      display: block;
      width: 100%;
      height: 110px;
      object-fit: cover;
      border-radius: 8px;
    }

    #settingsPortfolioPreview button {
      width: 100%;
      margin-top: 8px;
      background: #fff1f2;
      color: #b91c1c;
    }

    #settingsWorkPhotos {
      width: 100%;
      box-sizing: border-box;
    }
  `;

  document.head.append(style);

  $("settingsWorkPhotos").addEventListener("change", event => {
    const files = [...event.target.files];
    event.target.value = "";

    if (!files.length) return;

    if (portfolioItems.length + files.length > 10) {
      formStatus(serviceForm, "Maximum 10 work photos.", true);
      return;
    }

    if (files.some(file => (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ))) {
      formStatus(
        serviceForm,
        "Choose JPG, PNG or WebP photos no larger than 5 MB.",
        true
      );
      return;
    }

    files.forEach(file => {
      portfolioItems.push({
        file,
        preview: URL.createObjectURL(file)
      });
    });

   const dirtyFields = new Map(
  editableForms.map(form => [form.id, new Set()])
);

    formStatus(
      serviceForm,
      "Photos selected. Click Save Services."
    );
  });
}

function renderPortfolio() {
  const host = $("settingsPortfolioPreview");
  if (!host) return;

  host.replaceChildren();

  portfolioItems.forEach((item, index) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");

    image.alt = `Work photo ${index + 1}`;

    if (item.preview) {
      image.src = item.preview;
    } else {
      try {
        const url = new URL(item.url);
        if (url.protocol === "https:") image.src = url.href;
      } catch {
        // Invalid saved photo URL.
      }
    }

    const remove = document.createElement("button");

    remove.type = "button";
    remove.textContent = "Remove";

    remove.addEventListener("click", () => {
      if (savingForms.has(serviceForm.id)) return;

      if (item.preview) {
        URL.revokeObjectURL(item.preview);
      }

      portfolioItems.splice(index, 1);

      dirtyFields.get(serviceForm.id).add("workPhotos");
      renderPortfolio();

      formStatus(
        serviceForm,
        "Click Save Services to save photo changes."
      );
    });

    figure.append(image, remove);
    host.append(figure);
  });
}

function loadPortfolio() {
  if (dirtyFields.get(serviceForm.id).has("workPhotos")) {
    return;
  }

  portfolioItems.forEach(item => {
    if (item.preview) URL.revokeObjectURL(item.preview);
  });

  portfolioItems = (
    Array.isArray(latestProfile.workPhotos)
      ? latestProfile.workPhotos
      : []
  )
    .filter(url => typeof url === "string")
    .map(url => ({ url }));

  renderPortfolio();
}

async function uploadPortfolioPhotos() {
  const { cloudName, uploadPreset } = CLOUDINARY_CONFIG;

  if (!cloudName || !uploadPreset) {
    throw new Error("Cloudinary configuration is missing.");
  }

  if (portfolioItems.length > 10) {
    throw new Error("Maximum 10 work photos.");
  }

  for (let index = 0; index < portfolioItems.length; index++) {
    const item = portfolioItems[index];

    // Reuse a successful upload when retrying a failed Firestore save.
    if (item.url) continue;

    formStatus(
      serviceForm,
      `Uploading photo ${index + 1} of ${portfolioItems.length}…`
    );

    const body = new FormData();

    body.append("file", item.file);
    body.append("upload_preset", uploadPreset);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(60000)
      }
    );

    const result = await response.json();

    if (!response.ok || !result.secure_url) {
      throw new Error(
        result.error?.message || "Photo upload failed."
      );
    }

    const url = new URL(result.secure_url);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com"
    ) {
      throw new Error("Invalid photo URL returned.");
    }

    item.url = url.href;
  }

  return portfolioItems.map(item => item.url);
}
const $ = id => document.getElementById(id);

const profileForm = $("profileForm");
const serviceForm = $("serviceForm");
const passwordForm = $("passwordForm");

const editableForms = [profileForm];

const dirtyFields = new Map(
  editableForms.map(form => [form.id, new Set()])
);

const savingForms = new Set();

let latestProfile = {};
let profileReady = false;
let unsubscribe;
let closed = false;

function showStatus(target, message, error = false) {
  target.textContent = message;
  target.classList.toggle("error", error);
}

function formStatus(form, message, error = false) {
  showStatus(
    form.querySelector(".form-status"),
    message,
    error
  );
}

function readableError(error) {
  const messages = {
    "permission-denied":
      "Firestore did not allow this update. Check your account permissions.",

    "auth/invalid-credential":
      "Your current password is incorrect.",

    "auth/wrong-password":
      "Your current password is incorrect.",

    "auth/weak-password":
      "Choose a stronger password that meets your account's password requirements.",

    "auth/password-does-not-meet-requirements":
      "The new password does not meet the required password policy.",

    "auth/requires-recent-login":
      "Please log in again before changing your password.",

    "auth/too-many-requests":
      "Too many attempts. Please wait before trying again.",

    "auth/network-request-failed":
      "Network error. Check your connection and try again.",

    "unavailable":
      "The service is temporarily unavailable. Please try again."
  };

  return messages[error.code] ||
    "The change could not be completed. Please try again.";
}

function valueForField(field) {
  if (field === "skills") {
    return Array.isArray(latestProfile.skills)
      ? latestProfile.skills.join(", ")
      : "";
  }

  if (field === "displayName") {
    return latestProfile.displayName ||
      latestProfile.fullName ||
      "";
  }

  if (field === "contactNumber") {
    return latestProfile.contactNumber ||
      latestProfile.phone ||
      latestProfile.phoneNumber ||
      "";
  }

  return latestProfile[field] ?? "";
}
function fillForm(form) {
  const dirty = dirtyFields.get(form.id);

  for (
    const input of form.querySelectorAll("[data-field]")
  ) {
    const field = input.dataset.field;

    if (!dirty.has(field)) {
      input.value = valueForField(field);
    }
  }

  form.querySelector("fieldset").disabled =
    !profileReady || savingForms.has(form.id);

  if (form === serviceForm) {
    loadPortfolio();
  }
}

function buildChanges(form) {
  const changes = {};
  const dirty = dirtyFields.get(form.id);

  for (const input of form.querySelectorAll("[data-field]")) {
    const field = input.dataset.field;

    if (!dirty.has(field)) continue;

    const value = input.value.trim();

    if (
      (field === "displayName" || field === "serviceCategory") &&
      !value
    ) {
      throw new Error("Please fill in the required fields.");
    }

    if (field === "contactNumber" && value) {
      const digits = value.replace(/\D/g, "");

      if (
        !/^[+\d\s().-]+$/.test(value) ||
        digits.length < 7 ||
        digits.length > 15
      ) {
        throw new Error("Please enter a valid contact number.");
      }
    }

    if (field === "skills") {
      const skills = [
        ...new Set(
          value.split(",")
            .map(skill => skill.trim())
            .filter(Boolean)
        )
      ];

      if (skills.length > 30) {
        throw new Error("Please enter no more than 30 skills.");
      }

      changes.skills = skills;
    } else if (field === "price") {
      const amount = value === "" ? "" : Number(value);

      if (
        amount !== "" &&
        (!Number.isFinite(amount) || amount < 0 || amount > 1000000)
      ) {
        throw new Error("Please enter a valid service rate.");
      }

      changes.price = amount;
    } else {
      changes[field] = value;
    }
  }
if (
  form === serviceForm &&
  dirtyFields.get(form.id).has("workPhotos")
) {
  changes.workPhotos = [];
}
  return changes;
}

async function startSettings() {

  const ctx = await requireAuth(["provider"]);
  if (!ctx) return;

  const reference = doc(db, "users", ctx.user.uid);

  $("settingsEmail").value = ctx.user.email || "";
  $("accountIdentity").textContent =
    ctx.user.email || "Email not provided";
  $("accountId").textContent = ctx.user.uid;

 

  for (const form of editableForms) {
    form.addEventListener("input", event => {
      const field = event.target.dataset.field;

      if (field) {
        dirtyFields.get(form.id).add(field);
        formStatus(form, "You have unsaved changes.");
      }
    });

    form.querySelector("[data-cancel]").addEventListener("click", () => {
      dirtyFields.get(form.id).clear();
      fillForm(form);
      formStatus(form, "Changes discarded.");
    
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (!profileReady || savingForms.has(form.id)) return;
      if (!form.reportValidity()) return;

      let changes;

      try {
        changes = buildChanges(form);
      } catch (error) {
        formStatus(form, error.message, true);
        return;
      }

      if (!Object.keys(changes).length) {
        formStatus(form, "No changes to save.");
        return;
      }

      savingForms.add(form.id);
      form.querySelector("fieldset").disabled = true;
      formStatus(form, "Saving…");
try {
     if (
  form === serviceForm &&
  dirtyFields.get(form.id).has("workPhotos")
) {
  changes.workPhotos = await uploadPortfolioPhotos();
}

await updateDoc(reference, {
  ...changes,
  updatedAt: serverTimestamp()
});

        latestProfile = {
          ...latestProfile,
          ...changes
        };

        dirtyFields.get(form.id).clear();

      const successMessage =
  form.id === "profileForm"
    ? "Profile saved."
    : "Service details saved.";

formStatus(form, successMessage);
showStatus($("settingsStatus"), successMessage);

const section = form.closest("details");

if (section) {
  section.open = false;
  section.querySelector("summary")?.focus();
}
      
      } catch (error) {
        console.error("Save settings:", error);
        formStatus(
  form,
  error.code ? readableError(error) : error.message,
  true
);

const section = form.closest("details");
if (section) section.open = true;
      } finally {
        savingForms.delete(form.id);
        fillForm(form);
      }
    });
  }

  unsubscribe = onSnapshot(
    reference,
    snapshot => {
      if (closed) return;

      if (!snapshot.exists()) {
        profileReady = false;
        editableForms.forEach(fillForm);

        showStatus(
          $("settingsStatus"),
          "Your provider profile was not found.",
          true
        );

        return;
      }

      latestProfile = snapshot.data();
      profileReady = true;

      editableForms.forEach(fillForm);

         if (
        $("settingsStatus").textContent.trim() ===
        "Loading your settings…"
      ) {
        showStatus($("settingsStatus"), "");
      }
    },
    error => {
      console.error("Settings listener:", error);
      profileReady = false;
      editableForms.forEach(fillForm);

      showStatus(
        $("settingsStatus"),
        "Could not load your settings. Check your connection and reload.",
        true
      );
    }
  );

  const passwordAccount = ctx.user.providerData.some(
    provider => provider.providerId === "password"
  );

  passwordForm.hidden = !passwordAccount;

  passwordForm.querySelector("fieldset").disabled =
    !passwordAccount;

  $("resetPassword").hidden = !passwordAccount;
  $("resetPassword").disabled =
    !passwordAccount || !ctx.user.email;

  $("passwordHelp").textContent = passwordAccount
    ? "Enter your current password to choose a new one. Use at least 8 characters."
    : "You sign in through an external account such as Google. Manage your password through that account.";

  $("showPasswords").addEventListener("change", event => {
    const type = event.target.checked ? "text" : "password";

    for (const id of [
      "currentPassword",
      "newPassword",
      "confirmPassword"
    ]) {
      $(id).type = type;
    }
  });

  passwordForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!passwordAccount || !passwordForm.reportValidity()) return;

    const current = $("currentPassword").value;
    const next = $("newPassword").value;
    const confirmation = $("confirmPassword").value;

    if (next !== confirmation) {
      formStatus(passwordForm, "New passwords do not match.", true);
      return;
    }

    if (next === current) {
      formStatus(
        passwordForm,
        "Choose a password different from your current password.",
        true
      );
      return;
    }

    const fieldset = passwordForm.querySelector("fieldset");
    fieldset.disabled = true;

    formStatus(passwordForm, "Changing password…");

    try {
      const credential = EmailAuthProvider.credential(
        ctx.user.email,
        current
      );

      await reauthenticateWithCredential(ctx.user, credential);
      await updatePassword(ctx.user, next);

      passwordForm.reset();

      for (const id of [
        "currentPassword",
        "newPassword",
        "confirmPassword"
      ]) {
        $(id).type = "password";
      }

      formStatus(passwordForm, "Password changed successfully.");
    } catch (error) {
      // Do not log or save password values.
      formStatus(passwordForm, readableError(error), true);
    } finally {
      fieldset.disabled = false;
    }
  });

  $("resetPassword").addEventListener("click", async () => {
    const button = $("resetPassword");
    button.disabled = true;

    showStatus($("resetStatus"), "Sending reset email…");

    try {
      await sendPasswordResetEmail(auth, ctx.user.email);

      showStatus(
        $("resetStatus"),
        "Password reset email sent. Check your inbox and spam folder."
      );
    } catch (error) {
      showStatus(
        $("resetStatus"),
        readableError(error),
        true
      );
    } finally {
      button.disabled = false;
    }
  });

}

window.addEventListener("pagehide", () => {
  closed = true;
  unsubscribe?.();
});

window.addEventListener("pageshow", event => {
  if (event.persisted) location.reload();
});

startSettings().catch(error => {
  console.error("Settings setup:", error);

  showStatus(
    $("settingsStatus"),
    "Unable to open settings. Please reload.",
    true
  );
});