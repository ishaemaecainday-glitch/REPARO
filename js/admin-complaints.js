import { db, requireAuth } from "./firebase-core.js";

import {
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const list = document.getElementById("complaintList");
const status = document.getElementById("complaintStatus");
const filter = document.getElementById("complaintFilter");
const search = document.getElementById("complaintSearch");

const states = {
  pending: "Pending",
  reviewing: "Under review",
  resolved: "Resolved",
  dismissed: "Dismissed"
};

const reasons = {
  non_payment: "Non-payment",
  suspected_scam: "Suspected scam",
  harassment: "Harassment or abusive behavior",
  false_information: "False booking information",
  poor_service: "Poor service",
  no_show: "Did not arrive",
  other: "Other problem"
};

let reports = [];
let stop;
let closed = false;

// Preserve unsaved notes when another report updates.
const drafts = new Map();
const saving = new Set();
const feedback = new Map();

function element(tag, className = "", text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function milliseconds(value) {
  return typeof value?.toMillis === "function"
    ? value.toMillis()
    : 0;
}
function render(ctx) {
  const term = search.value.trim().toLowerCase();

  const visible = reports.filter(report => {
    const matchesStatus =
      filter.value === "all" || report.status === filter.value;

    const searchable = [
      report.bookingId,
      report.providerId,
      report.customerId,
      report.providerName,
      report.customerName,
      report.reason,
      reasons[report.reason],
      report.details
    ].join(" ").toLowerCase();

    return matchesStatus && searchable.includes(term);
  });

  // Remember which review panels are open before rebuilding the table.
  const openPanels = new Set(
    [...list.querySelectorAll("[data-review-key]")]
      .filter(row => !row.hidden)
      .map(row => row.dataset.reviewKey)
  );

  list.replaceChildren();

  status.textContent =
    `${visible.length} complaint${visible.length === 1 ? "" : "s"}`;

  const wrapper = element("div", "complaints-table-scroll");
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "Complaints table");

  const table = element("table", "complaints-table");
  const caption = element("caption", "complaints-sr-only", "Booking complaints");
  const thead = element("thead");
  const headingRow = element("tr");

  for (const title of [
    "Reported By",
    "Reported Account",
    "Reason",
    "Submitted",
    "Status",
    "Action"
  ]) {
    const heading = element("th", "", title);
    heading.scope = "col";
    headingRow.append(heading);
  }

  thead.append(headingRow);

  const tbody = element("tbody");

  if (!visible.length) {
    const row = element("tr");
    const cell = element(
      "td",
      "complaints-table-empty",
      "No complaints match your search or filter."
    );

    cell.colSpan = 6;
    row.append(cell);
    tbody.append(row);
  }

  visible.forEach((report, index) => {
    const key = report.ref.path;

    const providerReported = report.reporterId === report.providerId;
    const customerReported = report.reporterId === report.customerId;

    const reporterName = providerReported
      ? report.providerName
      : customerReported
        ? report.customerName
        : "Unknown reporter";

    const reportedName = providerReported
      ? report.customerName
      : customerReported
        ? report.providerName
        : "Unknown account";

    const reporterRole = providerReported
      ? "Provider"
      : customerReported ? "Customer" : "Unknown";

    const reportedRole = providerReported
      ? "Customer"
      : customerReported ? "Provider" : "Unknown";

    function personCell(name, role) {
      const cell = element("td");
      cell.append(
        element("strong", "complaint-person-name", name || "Name unavailable"),
        element("span", "complaint-person-role", role)
      );
      return cell;
    }

    const row = element("tr");
    const submitted = milliseconds(report.createdAt);

    const dateCell = element("td", "complaint-date");

    if (submitted) {
      const date = new Date(submitted);

      dateCell.append(
        element("span", "", date.toLocaleDateString("en-PH", {
          month: "short",
          day: "numeric",
          year: "numeric"
        })),
        element("small", "", date.toLocaleTimeString("en-PH", {
          hour: "numeric",
          minute: "2-digit"
        }))
      );
    } else {
      dateCell.textContent = "Pending timestamp";
    }

    const statusCell = element("td");
    const safeState = Object.hasOwn(states, report.status)
      ? report.status
      : "unknown";

    statusCell.append(
      element(
        "span",
        `complaint-status-pill ${safeState}`,
        states[report.status] || "Unknown"
      )
    );

    const actionCell = element("td");
    const reviewButton = element("button", "complaint-open-button", "Review");
    reviewButton.type = "button";

    const detailId = `complaint-review-panel-${index}`;
    reviewButton.setAttribute("aria-controls", detailId);

    actionCell.append(reviewButton);

    row.append(
      personCell(reporterName, reporterRole),
      personCell(reportedName, reportedRole),
      element("td", "", reasons[report.reason] || report.reason || "Complaint"),
      dateCell,
      statusCell,
      actionCell
    );

    const detailRow = element("tr", "complaint-detail-row");
    detailRow.id = detailId;
    detailRow.dataset.reviewKey = key;
    detailRow.hidden = !openPanels.has(key);

    reviewButton.setAttribute("aria-expanded", String(!detailRow.hidden));
    reviewButton.textContent = detailRow.hidden ? "Review" : "Close";

    reviewButton.addEventListener("click", () => {
      detailRow.hidden = !detailRow.hidden;
      reviewButton.setAttribute("aria-expanded", String(!detailRow.hidden));
      reviewButton.textContent = detailRow.hidden ? "Review" : "Close";
    });

    const detailCell = element("td");
    detailCell.colSpan = 6;

    const panel = element("div", "complaint-review-panel");

    panel.append(
      element("h3", "", "Complaint details"),
      element("p", "complaint-booking-reference", `Booking: ${report.bookingId}`),
      element("p", "complaint-description", report.details || "No details provided.")
    );

    const form = element("form", "complaint-review");
    const stateLabel = element("label", "", "Review status");
    const select = element("select");

    for (const [value, label] of Object.entries(states)) {
      const option = element("option", "", label);
      option.value = value;
      select.append(option);
    }

    const noteLabel = element("label", "", "Administrator notes");
    const notes = element("textarea");
    notes.rows = 3;
    notes.maxLength = 2000;
    notes.placeholder = "Record your findings or resolution.";

    const draft = drafts.get(key);
    select.value = draft?.status || report.status || "pending";
    notes.value = draft?.notes ?? report.adminNotes ?? "";

    stateLabel.append(select);
    noteLabel.append(notes);

    function rememberDraft() {
      drafts.set(key, {
        status: select.value,
        notes: notes.value
      });
    }

    select.addEventListener("change", rememberDraft);
    notes.addEventListener("input", rememberDraft);

    const save = element("button", "complaint-save-button", "Save Review");
    save.type = "submit";

    const message = element(
      "p",
      "complaint-feedback",
      feedback.get(key) || ""
    );
    message.setAttribute("role", "status");

    select.disabled = saving.has(key);
    notes.disabled = saving.has(key);
    save.disabled = saving.has(key);
    if (saving.has(key)) save.textContent = "Saving…";

    form.append(stateLabel, noteLabel, save, message);

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving.has(key)) return;

      const next = select.value;
      const adminNotes = notes.value.trim();

      if (!Object.hasOwn(states, next)) return;

      if (
        ["resolved", "dismissed"].includes(next) &&
        adminNotes.length < 10
      ) {
        message.textContent =
          "Add an explanation of at least 10 characters.";
        return;
      }

      rememberDraft();
      saving.add(key);
      render(ctx);

      try {
        await updateDoc(report.ref, {
          status: next,
          adminNotes,
          reviewedBy: ctx.user.uid,
          reviewedAt: serverTimestamp()
        });

       drafts.delete(key);
feedback.set(key, "Review saved.");

// Close the saved complaint's currently displayed details.
for (const row of list.querySelectorAll("[data-review-key]")) {
  if (row.dataset.reviewKey !== key) continue;

  row.hidden = true;

  const toggle = row.previousElementSibling?.querySelector(
    'button[aria-controls]'
  );

  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Review";
  }
}

        reports = reports.map(item =>
          item.ref.path === key
            ? { ...item, status: next, adminNotes }
            : item
        );
      } catch (error) {
        console.error("Save complaint review:", error);
        feedback.set(key, "Could not save the review. Please try again.");
      } finally {
        saving.delete(key);
        if (!closed) render(ctx);
      }
    });

    panel.append(form);
    detailCell.append(panel);
    detailRow.append(detailCell);

    tbody.append(row, detailRow);
  });

  table.append(caption, thead, tbody);
  wrapper.append(table);
  list.append(wrapper);
}

async function loadComplaintNames(report) {
  async function readData(reference) {
    try {
      const snapshot = await getDoc(reference);
      return snapshot.exists() ? snapshot.data() : {};
    } catch (error) {
      console.error("Could not read complaint account details:", error);
      return {};
    }
  }

  const [provider, customer, booking] = await Promise.all([
    report.providerId
      ? readData(doc(db, "users", report.providerId))
      : Promise.resolve({}),

    report.customerId
      ? readData(doc(db, "users", report.customerId))
      : Promise.resolve({}),

    readData(report.ref.parent.parent)
  ]);

  return {
    ...report,

    providerName:
      provider.displayName ||
      provider.fullName ||
      booking.providerName ||
      "Provider name unavailable",

    customerName:
      customer.displayName ||
      customer.fullName ||
      booking.customerName ||
      "Customer name unavailable"
  };
}async function start() {
  status.textContent = "Loading";

  const startupTimer = setTimeout(() => {
    status.textContent =
      "Still waiting for authentication or Firestore. Check your connection.";
  }, 15000);

  let ctx;

  try {
    ctx = await requireAuth(["admin"]);
  } catch (error) {
    clearTimeout(startupTimer);
    throw error;
  }

  if (!ctx) {
    clearTimeout(startupTimer);
    status.textContent = "Please sign in using your administrator account.";
    return;
  }

  status.textContent = "Fetching saved complaints…";

  filter.addEventListener("change", () => render(ctx));
  search.addEventListener("input", () => render(ctx));

  let snapshotVersion = 0;

  stop = onSnapshot(
    collectionGroup(db, "reports"),

    snapshot => {
      clearTimeout(startupTimer);
      if (closed) return;

      const version = ++snapshotVersion;

      reports = snapshot.docs
        .filter(item => {
          const parts = item.ref.path.split("/");

          return (
            parts.length === 4 &&
            parts[0] === "bookings" &&
            parts[2] === "reports"
          );
        })
        .map(item => ({
          ...item.data(),
          bookingId: item.ref.parent.parent.id,
          reporterId: item.id,
          ref: item.ref,
          providerName: "Loading provider name…",
          customerName: "Loading customer name…"
        }))
        .sort((a, b) =>
          milliseconds(b.createdAt) - milliseconds(a.createdAt) ||
          a.ref.path.localeCompare(b.ref.path)
        );

      // Display reports without waiting for profile lookups.
      render(ctx);

      // Names load independently. A slow lookup cannot hide reports.
      for (const report of reports) {
        const fallbackTimer = setTimeout(() => {
          if (closed || version !== snapshotVersion) return;

          applyNames(report.ref.path, {
            providerName: `Provider (${report.providerId || "ID unavailable"})`,
            customerName: `Customer (${report.customerId || "ID unavailable"})`
          });
        }, 10000);

        loadComplaintNames(report)
          .then(namedReport => {
            clearTimeout(fallbackTimer);

            if (closed || version !== snapshotVersion) return;

            applyNames(report.ref.path, {
              providerName: namedReport.providerName,
              customerName: namedReport.customerName
            });
          })
          .catch(error => {
            console.error("Complaint name lookup:", error);
            // The fallback timer will show account IDs if needed.
          });
      }
    },

    error => {
      clearTimeout(startupTimer);
      snapshotVersion++;

      console.error("Load complaints:", error);
      list.replaceChildren();

      status.textContent =
        error.code === "permission-denied"
          ? "Firestore denied access. Check the admin reports read rule."
          : `Could not load complaints: ${error.message}`;
    }
  );

  function applyNames(path, names) {
    reports = reports.map(report =>
      report.ref.path === path
        ? { ...report, ...names }
        : report
    );

    // Avoid interrupting an administrator typing review notes.
    if (!list.contains(document.activeElement)) {
      render(ctx);
    }
  }

  // Refresh deferred names after the administrator leaves a form field.
  list.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!closed && !list.contains(document.activeElement)) {
        render(ctx);
      }
    }, 0);
  });
}

window.addEventListener("pagehide", () => {
  closed = true;
  stop?.();
});

window.addEventListener("pageshow", event => {
  if (event.persisted && closed) {
    location.reload();
  }
});

// This must be outside the start() function.
start().catch(error => {
  console.error("Admin complaints startup:", error);

  status.textContent =
    `Could not open complaints: ${error.message || "Unknown error"}`;
});