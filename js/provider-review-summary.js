import { db, requireAuth } from "./firebase-core.js";

import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

async function start() {
      const currentPage = location.pathname.split("/").pop();

  if (currentPage !== "service.html") return;
  const ctx = await requireAuth();
  if (!ctx) return;

  const page = location.pathname.split("/").pop();
  const providerId = page === "service.html"
    ? new URLSearchParams(location.search).get("provider")
    : ctx.user.uid;

  if (!providerId) return;

  const host = document.createElement("section");
  host.style.cssText =
    "margin:18px 0;padding:18px;border:1px solid #e0ebe8;" +
    "border-radius:16px;background:white;";

  const heading = document.createElement("h3");
  heading.textContent = "Customer Ratings & Feedback";

  const summary = document.createElement("p");
  summary.setAttribute("role", "status");
  summary.textContent = "Loading ratings…";

  const comments = document.createElement("div");
  host.append(heading, summary, comments);

  const parent = document.querySelector(
    "#providerReviewSection, .profile-app main, .dashboard-content"
  );
  if (!parent) return;
  parent.append(host);

  const stop = onSnapshot(
    query(
      collection(db, "providerReviews"),
      where("providerId", "==", providerId)
    ),
    snapshot => {
      const reviews = snapshot.docs.map(item => item.data())
        .filter(item =>
          Number.isInteger(item.rating) &&
          item.rating >= 1 && item.rating <= 5
        )
        .sort((a, b) =>
          (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
        );

      const average = reviews.length
        ? reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length
        : null;

      summary.textContent = average === null
        ? "No customer ratings yet."
        : `★ ${average.toFixed(1)} / 5 · ${reviews.length} reviews`;

      // Existing summary fields, where present.
      for (const id of [
        "providerRating",
        "providerDashboardRating"
      ]) {
        const target = document.getElementById(id);
        if (target) target.textContent =
          average === null ? "—" : average.toFixed(1);
      }

      const count = document.getElementById("providerReviews");
      if (count) count.textContent = String(reviews.length);

      comments.replaceChildren();

      for (const review of reviews.slice(0, 10)) {
        const entry = document.createElement("p");
        entry.style.cssText =
          "padding:12px 0;border-top:1px solid #edf2ef;" +
          "white-space:pre-wrap;overflow-wrap:anywhere;";
        entry.textContent =
          `${"★".repeat(review.rating)}\n${review.comment || "No written feedback."}`;
        comments.append(entry);
      }
    },
    error => {
      console.error("Provider reviews:", error);
      summary.textContent = "Could not load customer ratings.";
    }
  );

  window.addEventListener("pagehide", stop, { once: true });
}

start().catch(console.error);