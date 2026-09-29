import {
  db,
  requireAuth
} from "./firebase-core.js";
import { cancelExpiredPendingBookings } from "./booking-expiry.js";

import {
  collection,
  doc,
  query,
  where,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const list = document.getElementById("bookingList");
const statusElement = document.getElementById("bookingStatus");
const search = document.getElementById("bookingSearch");
const filters = [...document.querySelectorAll("[data-filter]")];

const validFilters = filters.map(button => button.dataset.filter);

const aliases = {
  upcoming: "confirmed",
  "awaiting-response": "pending"
};

const requested =
  new URLSearchParams(location.search).get("status") || "all";

let selected = aliases[requested] || requested;

if (!validFilters.includes(selected)) {
  selected = "all";
}

let bookings = [];
let ready = false;
let unsubscribe;

const busy = new Set();
const expanded = new Set();
const reportedIds = new Set();
const reportListeners = new Map();

function element(tag, className = "", text) {
  const item = document.createElement(tag);

  if (className) {
    item.className = className;
  }

  if (text !== undefined) {
    item.textContent = text;
  }

  return item;
}

function icon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const use = document.createElementNS(namespace, "use");

  svg.setAttribute("aria-hidden", "true");
  use.setAttribute("href", `#${name}`);
  svg.append(use);

  return svg;
}

function dateOf(value) {
  if (!value) return null;

  const date =
    typeof value.toDate === "function"
      ? value.toDate()
      : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function stateOf(booking) {
  return String(booking.status || "unknown").toLowerCase();
}

function showStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.hidden = !message;
  statusElement.classList.toggle("error", isError);
}

function priceOf(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return "Price not set";
  }

  const amount = Number(value);

  if (Number.isFinite(amount) && amount >= 0) {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP"
    }).format(amount);
  }

  return String(value);
}

function addMetadata(parent, symbol, text) {
  const row = element("div", "meta-row");

  row.append(
    icon(symbol),
    element("span", "", text)
  );

  parent.append(row);
}

function render(ctx) {
  for (const button of filters) {
    const filter = button.dataset.filter;

    button.setAttribute(
      "aria-pressed",
      String(selected === filter)
    );

    button.querySelector("span").textContent = ready
      ? String(
          bookings.filter(booking =>
                     filter === "all" ||
         (filter === "report"
  ? reportedIds.has(booking.id)
  : stateOf(booking) === filter)
          ).length
        )
      : "";
  }

  if (!ready) return;

  const term = search.value.trim().toLowerCase();

  const visible = bookings.filter(booking => {
        const matchesStatus =
      selected === "all" ||
     (selected === "report"
  ? reportedIds.has(booking.id)
  : stateOf(booking) === selected);

    const searchableText = [
      booking.customerName,
      booking.service,
      typeof booking.location === "string"
        ? booking.location
        : ""
    ].join(" ").toLowerCase();

    return matchesStatus && searchableText.includes(term);
  });

  const content = document.createDocumentFragment();

  if (!visible.length) {
    const empty = element("section", "empty");

    empty.append(
      icon("calendar"),
      element("h2", "", "No bookings to show"),
      element(
        "p",
        "",
        term
          ? "Try another search or filter."
          : "Customer bookings will appear here automatically."
      )
    );

    content.append(empty);
  }

  for (const booking of visible) {
    const state = stateOf(booking);
    const card = element("article", "booking-card");
    const top = element("div", "card-top");

    const avatar = element("span", "avatar");
    avatar.append(icon("person"));

    const customer = element("div", "customer");

    customer.append(
      element("h2", "", booking.customerName || "Customer"),
      element("p", "", booking.service || "Service not provided")
    );

    const badgeClass = validFilters.includes(state) ? state : "";

    top.append(
      avatar,
      customer,
      element("span", `badge ${badgeClass}`, state)
    );

    const metadata = element("div", "metadata");
    const scheduled = dateOf(booking.scheduledAt);

    addMetadata(
      metadata,
      "calendar",
      scheduled
        ? scheduled.toLocaleDateString("en-PH", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })
        : "Date not provided"
    );

    if (scheduled) {
      addMetadata(
        metadata,
        "clock",
        scheduled.toLocaleTimeString("en-PH", {
          hour: "numeric",
          minute: "2-digit"
        })
      );
    }

    addMetadata(
      metadata,
      "pin",
      typeof booking.location === "string" &&
      booking.location.trim()
        ? booking.location
        : "Location not provided"
    );

    const bottom = element("div", "card-bottom");

    bottom.append(
      element("span", "price", priceOf(booking.price))
    );

    if (booking.customerId) {
      const message = element("a", "message-link", "Message");

    const bookingChatParams = new URLSearchParams({
  with: booking.customerId,
  back: "bookings",
  status: selected
});

message.href = `chat.html?${bookingChatParams.toString()}`;

      message.prepend(icon("chat"));
      bottom.append(message);
    }
if (state === "confirmed") {
const done = element("button", "booking-done", "✓ Mark as Done");
function askToCompleteBooking() {
  const dialog = document.getElementById("completeBookingDialog");
  const cancel = document.getElementById("keepBookingOpen");
  const confirmButton = document.getElementById("confirmBookingComplete");

  return new Promise(resolve => {
    const finish = confirmed => {
      dialog.close();
      resolve(confirmed);
    };

    cancel.onclick = () => finish(false);
    confirmButton.onclick = () => finish(true);
    dialog.oncancel = event => {
      event.preventDefault();
      finish(false);
    };

    dialog.showModal();
  });
}
  done.type = "button";
  done.disabled = busy.has(booking.id);

done.addEventListener("click", async () => {
  if (!(await askToCompleteBooking())) return;
  await changeStatus(ctx, booking.id, "completed");
});

  bottom.append(done);
}

if (state === "completed") {
  const report = element("button", "booking-report", "Report Customer");
  report.type = "button";

  report.addEventListener("click", () => {
    openCustomerReport(ctx, booking.id);
  });

  bottom.append(report);
}
    const details = element("details");
    details.open = expanded.has(booking.id);

    details.addEventListener("toggle", () => {
      if (!details.isConnected) return;

      if (details.open) {
        expanded.add(booking.id);
      } else {
        expanded.delete(booking.id);
      }
    });

    details.append(
      element("summary", "", "View details"),
      element("p", "", booking.notes || "No additional notes."),
      element("p", "", `Booking reference: ${booking.id}`)
    );

    card.append(top, metadata, bottom, details);

    if (state === "pending") {
      const actions = element("div", "actions");

      const options = [
        ["Decline", "declined", "decline"],
        ["Accept", "confirmed", "accept"]
      ];

      for (const [label, next, className] of options) {
        const button = element("button", className, label);

        button.type = "button";
        button.disabled = busy.has(booking.id);

        button.addEventListener("click", () => {
          changeStatus(ctx, booking.id, next);
        });

        actions.append(button);
      }

      card.append(actions);
    }

    content.append(card);
  }

  list.replaceChildren(content);
}
async function changeStatus(ctx, id, next) {
  const allowed = ["confirmed", "declined", "completed"];

  if (!allowed.includes(next) || busy.has(id)) return;

  busy.add(id);
  render(ctx);
  showStatus("Saving booking status…");

  try {
    const reference = doc(db, "bookings", id);
    const notification = doc(collection(db, "notifications"));

    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(reference);

      if (!snapshot.exists()) {
        throw new Error("This booking no longer exists.");
      }

      const booking = snapshot.data();

      if (booking.providerId !== ctx.user.uid) {
        throw new Error("This booking belongs to another provider.");
      }

      const requiredStatus =
        next === "completed" ? "confirmed" : "pending";

      if (stateOf(booking) !== requiredStatus) {
        throw new Error(
          "This booking has already changed. Check its latest status."
        );
      }

      if (!booking.customerId) {
        throw new Error("The booking is missing its customer ID.");
      }

      const updates = {
        status: next,
        updatedAt: serverTimestamp()
      };

      if (next === "completed") {
        updates.completedAt = serverTimestamp();
        updates.completedBy = ctx.user.uid;
      }

      transaction.update(reference, updates);

      const titles = {
      confirmed: "Confirmed by provider",

declined: "Declined by provider",
        completed: "Service marked completed"
      };

      transaction.set(notification, {
        userId: booking.customerId,
        senderId: ctx.user.uid,
        type: "booking",
        title: titles[next],
        message:
          `${booking.providerName || ctx.profile?.displayName || "Your provider"} ` +
          `marked your booking for ${booking.service || "repair service"} as ${next}.`,
        bookingId: id,
        read: false,
        createdAt: serverTimestamp()
      });
    });

    if (next === "completed") {
      selected = "completed";
      search.value = "";

      const url = new URL(location.href);
      url.searchParams.set("status", "completed");
      history.replaceState(null, "", url);
    }

    showStatus(
      next === "completed"
        ? "Booking completed. The customer has been notified."
        : "Booking updated. The customer has been notified."
    );
  } catch (error) {
    console.error("Booking update:", error);

    showStatus(
      error.code === "permission-denied"
        ? "Could not save. Check the Firestore booking and notification rules."
        : error.message || "Could not update this booking.",
      true
    );
  } finally {
    busy.delete(id);
    render(ctx);
  }
}
function openCustomerReport(ctx, bookingId) {
  const dialog = document.getElementById("reportCustomerDialog");
  const form = document.getElementById("reportCustomerForm");
  const reasonInput = document.getElementById("reportReason");
  const detailsInput = document.getElementById("reportDetails");
  const feedback = document.getElementById("reportFeedback");
  const submit = document.getElementById("submitReport");
  const cancel = document.getElementById("cancelReport");

  if (dialog.open) return;

  let saving = false;

  form.reset();
  feedback.textContent = "";
  submit.disabled = false;
  cancel.disabled = false;
  submit.textContent = "Submit Report";

  cancel.onclick = () => {
    if (!saving) dialog.close();
  };

  dialog.oncancel = event => {
    if (saving) event.preventDefault();
  };

  form.onsubmit = async event => {
    event.preventDefault();

    if (saving || !form.reportValidity()) return;

    const reason = reasonInput.value;
    const details = detailsInput.value.trim();

    const reasons = [
      "non_payment",
      "suspected_scam",
      "harassment",
      "false_information",
      "other"
    ];

    if (!reasons.includes(reason)) return;

    if (details.length < 10 || details.length > 2000) {
      feedback.textContent = "Please enter between 10 and 2,000 characters.";
      return;
    }

    saving = true;
    submit.disabled = true;
    cancel.disabled = true;
    submit.textContent = "Submitting…";
    feedback.textContent = "";

    try {
      const bookingRef = doc(db, "bookings", bookingId);

      // One provider report per booking.
      const reportRef = doc(
        db,
        "bookings",
        bookingId,
        "reports",
        ctx.user.uid
      );

      await runTransaction(db, async transaction => {
        const bookingSnapshot = await transaction.get(bookingRef);
        const reportSnapshot = await transaction.get(reportRef);

        if (!bookingSnapshot.exists()) {
          throw new Error("This booking no longer exists.");
        }

        const booking = bookingSnapshot.data();

        if (
          booking.providerId !== ctx.user.uid ||
          stateOf(booking) !== "completed"
        ) {
          throw new Error("Only your completed bookings can be reported here.");
        }

        if (reportSnapshot.exists()) {
          throw new Error("You already submitted a report for this booking.");
        }

        if (!booking.customerId) {
          throw new Error("This booking is missing its customer ID.");
        }

        transaction.set(reportRef, {
          bookingId,
          providerId: ctx.user.uid,
          customerId: booking.customerId,
          reason,
          details,
          status: "pending",
          createdAt: serverTimestamp()
        });
      });

      dialog.close();
      showStatus("Report submitted for administrator review.");
    } catch (error) {
      console.error("Customer report:", error);

      feedback.textContent =
        error.code === "permission-denied"
          ? "Report could not be saved. Publish the report rules below first."
          : error.message || "Could not submit the report. Please try again.";
    } finally {
      saving = false;
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "Submit Report";
    }
  };

  dialog.showModal();
}
async function start() {
  const ctx = await requireAuth(["provider", "admin"]);

  if (!ctx) return;

  filters.forEach(button => {
    button.addEventListener("click", () => {
      selected = button.dataset.filter;

      const url = new URL(location.href);
      url.searchParams.set("status", selected);

      history.replaceState(null, "", url);
      render(ctx);
    });
  });

  search.addEventListener("input", () => render(ctx));

  render(ctx);

  const bookingsQuery = query(
    collection(db, "bookings"),
    where("providerId", "==", ctx.user.uid)
  );

  unsubscribe = onSnapshot(
    bookingsQuery,
    snapshot => {
      bookings = snapshot.docs
        .map(item => ({
          ...item.data(),
          id: item.id
        }))
        .sort((a, b) => {
          const first = dateOf(a.createdAt)?.getTime() || 0;
          const second = dateOf(b.createdAt)?.getTime() || 0;

          return second - first || a.id.localeCompare(b.id);
        });

         const currentIds = new Set(bookings.map(booking => booking.id));

      // Stop listening to reports for bookings no longer in this list.
      for (const [id, stopReport] of reportListeners) {
        if (!currentIds.has(id)) {
          stopReport();
          reportListeners.delete(id);
          reportedIds.delete(id);
        }
      }

      // Each report document ID is the signed-in provider's UID.
      for (const booking of bookings) {
        if (reportListeners.has(booking.id)) continue;

        const reportRef = doc(
          db,
          "bookings",
          booking.id,
          "reports",
          ctx.user.uid
        );

        const stopReport = onSnapshot(
          reportRef,
          reportSnapshot => {
            if (reportSnapshot.exists()) {
              reportedIds.add(booking.id);
            } else {
              reportedIds.delete(booking.id);
            }
            render(ctx);
          },
          error => {
            console.error("Load booking report:", error);
          }
        );

        reportListeners.set(booking.id, stopReport);
      }

          

      // Stop listening to reports for bookings no longer in this list.
      for (const [id, stopReport] of reportListeners) {
        if (!currentIds.has(id)) {
          stopReport();
          reportListeners.delete(id);
          reportedIds.delete(id);
        }
      }

      // Each report document ID is the signed-in provider's UID.
      for (const booking of bookings) {
        if (reportListeners.has(booking.id)) continue;

        const reportRef = doc(
          db,
          "bookings",
          booking.id,
          "reports",
          ctx.user.uid
        );

        const stopReport = onSnapshot(
          reportRef,
          reportSnapshot => {
            if (reportSnapshot.exists()) {
              reportedIds.add(booking.id);
            } else {
              reportedIds.delete(booking.id);
            }
            render(ctx);
          },
          error => {
            console.error("Load booking report:", error);
          }
        );

        reportListeners.set(booking.id, stopReport);
      }

      ready = true;
      list.setAttribute("aria-busy", "false");
    

       showStatus("");
      render(ctx);
      void cancelExpiredPendingBookings(bookings);
    },
    error => {
      console.error("Load provider bookings:", error);

      ready = false;
      bookings = [];

      list.replaceChildren();
      list.setAttribute("aria-busy", "false");
      render(ctx);

      showStatus(
        error.code === "permission-denied"
          ? "You do not have permission to load these bookings. Check your signed-in account and Firestore booking rules."
          : "Unable to load bookings. Check your connection and reload.",
        true
      );
    }
  );
}

window.addEventListener("pagehide", () => {
  unsubscribe?.();
  reportListeners.forEach(stopReport => stopReport());
  reportListeners.clear();
});

window.addEventListener("pageshow", event => {
  if (event.persisted) {
    location.reload();
  }
});

start().catch(error => {
  console.error("Provider booking page:", error);

  list.setAttribute("aria-busy", "false");

  showStatus(
    "Could not open bookings. Check the console for the Firebase error, then reload.",
    true
  );
});