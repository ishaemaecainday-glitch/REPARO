import { db, requireAuth } from "./firebase-core.js";

import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const dialog = document.createElement("dialog");

dialog.innerHTML = `
  <form>
    <h2>Report Provider</h2>
    <p>Describe the issue for administrator review.</p>

    <label>
      Reason
      <select name="reason" required>
        <option value="">Select a reason</option>
        <option value="poor_service">Poor service</option>
        <option value="no_show">Did not arrive</option>
        <option value="suspected_scam">Suspected scam</option>
        <option value="harassment">Harassment</option>
        <option value="false_information">False information</option>
        <option value="other">Other</option>
      </select>
    </label>

    <label>
      Details
      <textarea
        name="details"
        rows="5"
        minlength="10"
        maxlength="2000"
        required
      ></textarea>
    </label>

    <p role="status"></p>
    <button type="button" data-close>Cancel</button>
    <button type="submit">Submit Report</button>
  </form>
`;

dialog.className = "customer-report-dialog";
document.body.append(dialog);

const form = dialog.querySelector("form");
const message = dialog.querySelector('[role="status"]');
const submit = dialog.querySelector('[type="submit"]');
const cancel = dialog.querySelector("[data-close]");

let bookingId = "";
let saving = false;

cancel.addEventListener("click", () => {
  if (!saving) dialog.close();
});

dialog.addEventListener("cancel", event => {
  if (saving) event.preventDefault();
});

async function start() {
  const ctx = await requireAuth();
  if (!ctx) return;

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-report-booking]");
    if (!button || dialog.open) return;

    bookingId = button.dataset.reportBooking;
    form.reset();
    message.textContent = "";
    submit.hidden = false;
    cancel.textContent = "Cancel";
    dialog.showModal();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;

    const reason = form.elements.reason.value;
    const details = form.elements.details.value.trim();

    if (details.length < 10) {
      message.textContent = "Please explain the issue in at least 10 characters.";
      return;
    }

    saving = true;
    submit.disabled = true;
    cancel.disabled = true;
    message.textContent = "Submitting…";

    try {
      const bookingRef = doc(db, "bookings", bookingId);
      const reportRef = doc(
        db, "bookings", bookingId, "reports", ctx.user.uid
      );

      await runTransaction(db, async transaction => {
        const bookingSnapshot = await transaction.get(bookingRef);
        const reportSnapshot = await transaction.get(reportRef);

        if (!bookingSnapshot.exists()) {
          throw new Error("Booking no longer exists.");
        }

        const booking = bookingSnapshot.data();

      if (booking.customerId !== ctx.user.uid) {
  throw new Error("You can only report your own booking.");
}

if (
  booking.customerCompleted !== true &&
  booking.status !== "completed"
) {
  throw new Error("Complete this booking before reporting it.");
}

        if (reportSnapshot.exists()) {
          throw new Error("You already reported this booking.");
        }

        transaction.set(reportRef, {
          bookingId,
          providerId: booking.providerId,
          customerId: ctx.user.uid,
          reason,
          details,
          status: "pending",
          createdAt: serverTimestamp()
        });
      });

      message.textContent = "Report submitted for administrator review.";
      submit.hidden = true;
      cancel.textContent = "Close";
    } catch (error) {
      console.error("Customer complaint:", error);
      message.textContent = error.code === "permission-denied"
        ? "Could not submit. Check the report permissions."
        : error.message || "Could not submit the report.";
    } finally {
      saving = false;
      submit.disabled = false;
      cancel.disabled = false;
    }
  });
}

start().catch(error => console.error("Customer reports:", error));