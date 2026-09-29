import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import nodemailer from "nodemailer";

const required = [
  "FIREBASE_SERVICE_ACCOUNT",
  "SMTP_USER",
  "SMTP_APP_PASSWORD"
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing GitHub Actions secret: ${name}`);
  }
}

initializeApp({
  credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});

const db = getFirestore();

const mailer = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_APP_PASSWORD
  }
});

const pending = await db.collection("adminReminders")
  .where("emailStatus", "==", "pending")
  .limit(50)
  .get();

for (const reminderDoc of pending.docs) {
  const reminder = reminderDoc.data();

  try {
    if (reminder.type !== "permit-renewal" || !reminder.providerId) {
      throw new Error("Invalid permit reminder");
    }

    const userDoc = await db.collection("users")
      .doc(reminder.providerId)
      .get();

    const provider = userDoc.data();
    const email = provider?.email;

    if (
      !userDoc.exists ||
      provider.role !== "provider" ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error("Provider email is missing or invalid");
    }

    const expiry = reminder.permitExpiry;
    const subject = "REPARO: Business permit renewal reminder";
    const body =
      `Hello ${provider.displayName || provider.fullName || "Provider"},\n\n` +
      `Your business permit expires or expired on ${expiry}.\n` +
      "Please sign in to REPARO and upload your renewed permit for admin review.\n\n" +
      "REPARO Administration";

    await mailer.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject,
      text: body
    });

    await reminderDoc.ref.update({
      emailStatus: "sent",
      emailSentAt: FieldValue.serverTimestamp()
    });

    console.log(`Sent permit reminder: ${reminderDoc.id}`);
  } catch (error) {
    // Keep it pending so the next scheduled run can retry.
    console.error(`Reminder ${reminderDoc.id}: ${error.message}`);
  }
}
