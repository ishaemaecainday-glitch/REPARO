import { db } from "./firebase-core.js";
import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const checking = new Set();

export async function cancelExpiredPendingBookings(bookings) {
  for (const booking of bookings) {
    const createdAt = booking.createdAt?.toMillis?.();

    if (
      !booking.id ||
      booking.status !== "pending" ||
      !createdAt ||
      Date.now() - createdAt < DAY_MS ||
      checking.has(booking.id)
    ) {
      continue;
    }

    checking.add(booking.id);

    try {
      const bookingRef = doc(db, "bookings", booking.id);
      const notificationRef = doc(
        db,
        "notifications",
        `booking-timeout-${booking.id}`
      );

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(bookingRef);
        if (!snapshot.exists()) return;

        const current = snapshot.data();
        const bookedAt = current.createdAt?.toMillis?.();

        // Check again because the provider may have responded meanwhile.
        if (
          current.status !== "pending" ||
          !bookedAt ||
          Date.now() - bookedAt < DAY_MS
        ) {
          return;
        }

        transaction.update(bookingRef, {
          status: "cancelled",
          cancelledBy: "system",
          cancelReason: "provider_timeout",
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        if (current.customerId) {
          transaction.set(notificationRef, {
            userId: current.customerId,
            type: "booking",
            title: "Booking automatically cancelled",
            message:
              `Your booking for ${current.service || "a service"} ` +
              "was cancelled because the provider did not respond within 24 hours.",
            bookingId: booking.id,
            read: false,
            createdAt: serverTimestamp()
          });
        }
      });
    } catch (error) {
      console.error("Could not cancel expired booking:", booking.id, error);
    } finally {
      checking.delete(booking.id);
    }
  }
}