const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const db = getFirestore();
const DAY_MS = 24 * 60 * 60 * 1000;

exports.expirePendingBookings = onSchedule(
  { schedule: "* * * * *", timeZone: "Etc/UTC" },
  async () => {
    const cutoff = Date.now() - DAY_MS;

    const pending = await db.collection("bookings")
      .where("status", "==", "pending")
      .get();

    for (const item of pending.docs) {
      const createdAt = item.data().createdAt;

      if (!createdAt?.toMillis || createdAt.toMillis() > cutoff) {
        continue;
      }

      await db.runTransaction(async transaction => {
        const currentSnapshot = await transaction.get(item.ref);

        if (!currentSnapshot.exists) return;

        const booking = currentSnapshot.data();
        const bookedAt = booking.createdAt;

        // Check again inside the transaction: the provider may have replied.
        if (
          booking.status !== "pending" ||
          !bookedAt?.toMillis ||
          bookedAt.toMillis() > Date.now() - DAY_MS
        ) {
          return;
        }

        const notification = db.collection("notifications")
          .doc(`booking-timeout-${item.id}`);

        transaction.update(item.ref, {
          status: "cancelled",
          cancelReason: "provider_timeout",
          cancelledBy: "system",
          cancelledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });

        if (booking.customerId) {
          transaction.set(notification, {
            userId: booking.customerId,
            type: "booking",
            title: "Booking automatically cancelled",
            message:
              `Your booking for ${booking.service || "a service"} ` +
              "was cancelled because the provider did not respond within 24 hours.",
            bookingId: item.id,
            read: false,
            createdAt: FieldValue.serverTimestamp()
          });
        }
      });
    }
  }
);