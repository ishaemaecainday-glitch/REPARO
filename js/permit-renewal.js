import {
  db,
  requireAuth
} from "./firebase-core.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  addDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

import {
  CLOUDINARY_CONFIG
} from "./cloudinary-config.js";

const providerForm = document.getElementById("renewalForm");
const adminList = document.getElementById("renewalRequests");

function showStatus(id, message) {
  const element = document.getElementById(id);
  if (element) element.textContent = message;
}

function todayPhilippines() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function uploadPermit(file) {
  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"
  ];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("Choose a JPG, PNG, WEBP, or PDF permit.");
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new Error("The permit must be 10 MB or smaller.");
  }

  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);

  const endpoint =
    `https://api.cloudinary.com/v1_1/` +
    `${CLOUDINARY_CONFIG.cloudName}/auto/upload`;

  const response = await fetch(endpoint, {
    method: "POST",
    body
  });

  const result = await response.json();

  if (!response.ok || !result.secure_url) {
    throw new Error(
      result.error?.message || "Permit upload failed."
    );
  }

  return {
  url: result.secure_url,
  isPDF: file.type === "application/pdf"
};
}

async function startProviderPage() {
  const ctx = await requireAuth(["provider"]);
  if (!ctx) return;

  const userRef = doc(db, "users", ctx.user.uid);
  const profileSnapshot = await getDoc(userRef);

  if (!profileSnapshot.exists()) {
    showStatus("renewalStatus", "Provider profile not found.");
    return;
  }

  const currentExpiry =
    String(profileSnapshot.data().permitExpiry || "").slice(0, 10);

  showStatus(
    "currentPermit",
    currentExpiry
      ? `Current approved permit expires: ${currentExpiry}`
      : "Your current permit expiration date is not recorded."
  );

  const submit = document.getElementById("renewalSubmit");
  let hasPending = false;

  const pendingQuery = query(
    collection(db, "permitRenewals"),
    where("providerId", "==", ctx.user.uid)
  );

  const stop = onSnapshot(pendingQuery, snapshot => {
    hasPending = snapshot.docs.some(
      item => item.data().status === "pending"
    );

    submit.disabled = hasPending;

    showStatus(
      "pendingRenewal",
      hasPending
        ? "Your renewed permit is awaiting administrator review."
        : ""
    );
  }, error => {
    showStatus("renewalStatus", error.message);
  });

  window.addEventListener("pagehide", stop, { once: true });

  providerForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (hasPending) return;

    const file =
      document.getElementById("renewedPermit").files[0];

    const newExpiry =
      document.getElementById("renewedExpiry").value;

    if (!file) {
      showStatus("renewalStatus", "Select your renewed permit.");
      return;
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(newExpiry) ||
      newExpiry <= todayPhilippines() ||
      (currentExpiry && newExpiry <= currentExpiry)
    ) {
      showStatus(
        "renewalStatus",
        "Enter a new expiration date later than the current one."
      );
      return;
    }

    submit.disabled = true;
    showStatus("renewalStatus", "Uploading permit…");

    try {
      // Check again before creating another pending request.
      const existing = await getDocs(pendingQuery);

      if (existing.docs.some(
        item => item.data().status === "pending"
      )) {
        throw new Error(
          "You already have a permit awaiting review."
        );
      }

      const uploadedPermit = await uploadPermit(file);

      await addDoc(collection(db, "permitRenewals"), {
        providerId: ctx.user.uid,
        providerName:
          profileSnapshot.data().displayName || "Provider",
        previousExpiry: currentExpiry,
        proposedExpiry: newExpiry,
        permitURL: uploadedPermit.url,
permitIsPDF: uploadedPermit.isPDF,
        status: "pending",
        submittedAt: serverTimestamp()
        
      });
providerForm.reset();

showStatus(
  "renewalStatus",
  "Renewed permit submitted. Wait for admin approval."
);

document.getElementById("renewalSuccess")?.showModal();
    } catch (error) {
      console.error("Submit permit renewal:", error);
      showStatus("renewalStatus", error.message);
    } finally {
      submit.disabled = hasPending;
    }
  });
}

async function reviewRenewal(ctx, renewalId, decision) {
  const renewalRef = doc(db, "permitRenewals", renewalId);
  const notificationRef = doc(collection(db, "notifications"));

  await runTransaction(db, async transaction => {
    const renewalSnapshot =
      await transaction.get(renewalRef);

    if (!renewalSnapshot.exists()) {
      throw new Error("Renewal request not found.");
    }

    const renewal = renewalSnapshot.data();

    if (renewal.status !== "pending") {
      throw new Error("This renewal was already reviewed.");
    }

    const providerRef =
      doc(db, "users", renewal.providerId);

    const providerSnapshot =
      await transaction.get(providerRef);

    if (
      !providerSnapshot.exists() ||
      providerSnapshot.data().role !== "provider"
    ) {
      throw new Error("Provider account not found.");
    }

    if (
      decision === "approved" &&
      String(
        providerSnapshot.data().permitExpiry || ""
      ).slice(0, 10) !== renewal.previousExpiry
    ) {
      throw new Error(
        "The provider's permit record has changed. Review it again."
      );
    }

    transaction.update(renewalRef, {
      status: decision,
      reviewedBy: ctx.user.uid,
      reviewedAt: serverTimestamp()
    });

    if (decision === "approved") {
      transaction.update(providerRef, {
        permitURL: renewal.permitURL,
        permitExpiry: renewal.proposedExpiry,
        updatedAt: serverTimestamp()
      });
    }

      transaction.set(notificationRef, {
  userId: renewal.providerId,
  adminId: ctx.user.uid,
      type: "provider_permit_renewal_result",
      title: decision === "approved"
        ? "Renewed Permit Approved"
        : "Renewed Permit Declined",
      message: decision === "approved"
        ? "Your renewed permit has been approved and added to your provider profile."
        : "Your renewed permit was declined. Please contact REPARO administration.",
      read: false,
      createdAt: serverTimestamp()
    });
  });
}
function openPermitViewer(item) {
  const dialog = document.getElementById("permitViewer");
  const body = document.getElementById("permitViewerBody");
  const heading = document.getElementById("permitViewerTitle");

  if (!dialog || !body) return;

  let permitURL;

  try {
    permitURL = new URL(item.permitURL);

    // Only display the uploaded Cloudinary file.
    if (
      permitURL.protocol !== "https:" ||
      permitURL.hostname !== "res.cloudinary.com"
    ) {
      throw new Error("Invalid permit URL.");
    }
  } catch {
    showStatus(
      "adminRenewalStatus",
      "The submitted permit link is invalid."
    );
    return;
  }

  body.replaceChildren();

  heading.textContent =
    `${item.providerName || "Provider"} – Renewed Business Permit`;

  const isPDF =
    item.permitIsPDF === true ||
    /\.pdf(?:[?#]|$)/i.test(permitURL.pathname);

  if (isPDF) {
    const frame = document.createElement("iframe");
    frame.src = permitURL.href;
    frame.title = "Full renewed business permit";
    body.append(frame);
  } else {
    const image = document.createElement("img");
    image.src = permitURL.href;
    image.alt = "Full renewed business permit";

    image.addEventListener("error", () => {
      body.textContent =
        "The permit preview could not be displayed.";
    }, { once: true });

    body.append(image);
  }

  dialog.showModal();
}
function confirmRenewalDecision(item, decision) {
  const dialog = document.getElementById("renewalDecisionDialog");
  const title = document.getElementById("renewalDecisionTitle");
  const message = document.getElementById("renewalDecisionMessage");
  const confirmButton = dialog.querySelector(".decision-confirm");

  const declining = decision === "declined";

  title.textContent = declining
    ? "Decline permit renewal?"
    : "Approve permit renewal?";

  message.textContent = declining
    ? `Decline the renewed permit submitted by ${item.providerName || "this provider"}?`
    : `Approve the renewed permit submitted by ${item.providerName || "this provider"}?`;

  confirmButton.textContent = declining ? "Decline permit" : "Approve permit";
  confirmButton.classList.toggle("is-decline", declining);

  // Reset this so pressing Escape cannot reuse a previous confirmation.
  dialog.returnValue = "cancel";

  return new Promise(resolve => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "confirm"),
      { once: true }
    );
    dialog.showModal();
  });
}
async function startAdminPage() {
  const ctx = await requireAuth(["admin"]);
  if (!ctx) return;

  const viewer = document.getElementById("permitViewer");
  const viewerBody = document.getElementById("permitViewerBody");
  const actions = document.getElementById("permitReviewActions");

  document.getElementById("closePermitViewer")
    ?.addEventListener("click", () => viewer.close());

  viewer?.addEventListener("close", () => {
    viewerBody?.replaceChildren();
    actions?.replaceChildren();
  });

  function makeCell(text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
  }

  function askToReview(item, decision) {
    const dialog = document.getElementById("renewalDecisionDialog");

    // Use your existing centered confirmation dialog if it is present.
    if (dialog) {
      const title = document.getElementById("renewalDecisionTitle");
      const message = document.getElementById("renewalDecisionMessage");
      const confirmButton = dialog.querySelector(".decision-confirm");
      const declining = decision === "declined";

      if (title) {
        title.textContent = declining
          ? "Decline permit renewal?"
          : "Approve permit renewal?";
      }

      if (message) {
        message.textContent =
          `${declining ? "Decline" : "Approve"} the renewed permit from ` +
          `${item.providerName || "this provider"}?`;
      }

      if (confirmButton) {
        confirmButton.textContent = declining
          ? "Decline permit"
          : "Approve permit";
        confirmButton.classList.toggle("is-decline", declining);
      }

      dialog.returnValue = "cancel";

      return new Promise(resolve => {
        dialog.addEventListener(
          "close",
          () => resolve(dialog.returnValue === "confirm"),
          { once: true }
        );
        dialog.showModal();
      });
    }

    return Promise.resolve(
      window.confirm(
        `${decision === "approved" ? "Approve" : "Decline"} ` +
        `${item.providerName || "this provider"}'s renewed permit?`
      )
    );
  }

  function showPermit(item) {
    if (actions) actions.replaceChildren();

    // Your existing function opens the permit inside the page.
    openPermitViewer(item);

    if (item.status !== "pending" || !actions) return;

    for (const [decision, label] of [
      ["approved", "Approve Permit"],
      ["declined", "Decline Permit"]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = decision === "declined"
        ? "permit-decline-btn"
        : "permit-approve-btn";
      button.textContent = label;

      button.addEventListener("click", async () => {
        const confirmed = await askToReview(item, decision);
        if (!confirmed) return;

        button.disabled = true;

        try {
          await reviewRenewal(ctx, item.id, decision);
          viewer.close();
          showStatus(
            "adminRenewalStatus",
            `Permit renewal ${decision}.`
          );
        } catch (error) {
          console.error(error);
          showStatus("adminRenewalStatus", error.message);
          button.disabled = false;
        }
      });

      actions.append(button);
    }
  }

  const stop = onSnapshot(
    collection(db, "permitRenewals"),
    snapshot => {
      adminList.replaceChildren();

      const requests = snapshot.docs
        .map(document => ({
          id: document.id,
          ...document.data()
        }))
        .sort((a, b) =>
          (b.submittedAt?.toMillis?.() || 0) -
          (a.submittedAt?.toMillis?.() || 0)
        );

      if (!requests.length) {
        const row = document.createElement("tr");
        const cell = makeCell("No permit renewals submitted yet.");
        cell.colSpan = 5;
        cell.className = "renewal-empty";
        row.append(cell);
        adminList.append(row);
        return;
      }

      for (const item of requests) {
        const row = document.createElement("tr");

        const provider = makeCell("");
        const name = document.createElement("strong");
        name.textContent = item.providerName || "Provider";
        provider.append(name);

        const previous = makeCell(item.previousExpiry || "Unknown");
        const proposed = makeCell(item.proposedExpiry || "Not provided");

        const statusCell = makeCell("");
        const badge = document.createElement("span");
        const status = String(item.status || "pending").toLowerCase();
        badge.className =
          "renewal-status " +
          (["pending", "approved", "declined"].includes(status)
            ? `status-${status}`
            : "");
        badge.textContent = status;
        statusCell.append(badge);

        const action = makeCell("");
        const viewButton = document.createElement("button");
        viewButton.type = "button";
        viewButton.className = "renewal-view-btn";
        viewButton.textContent = "View Business Permit";
        viewButton.addEventListener("click", () => showPermit(item));
        action.append(viewButton);

        row.append(
          provider,
          previous,
          proposed,
          statusCell,
          action
        );

        adminList.append(row);
      }
    },
    error => {
      showStatus("adminRenewalStatus", error.message);
    }
  );

  window.addEventListener("pagehide", stop, { once: true });
}
if (providerForm) {
  startProviderPage().catch(console.error);
}

if (adminList) {
  startAdminPage().catch(console.error);
}