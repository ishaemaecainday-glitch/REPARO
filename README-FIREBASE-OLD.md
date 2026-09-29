# REPARO + Firebase setup

This version uses Firebase Authentication, Cloud Firestore, and Cloud Storage.

## 1. Create/choose a Firebase project
1. Firebase Console -> Add project.
2. Project settings -> Your apps -> Web (`</>`), register REPARO.
3. Copy the web configuration into `firebase-config.js`.

## 2. Enable Authentication
Firebase Console -> Authentication -> Sign-in method:
- Enable Email/Password.
- Enable Google if you want the Google button to work.
- Add your local/hosting domain to Authorized domains when necessary.

Passwords are NOT written to Firestore. Firebase Authentication stores password credentials using secure salted password hashing. Firestore contains only user profile/role data.

## 3. Create Cloud Firestore
Firebase Console -> Firestore Database -> Create database.
Deploy `firestore.rules`; do not use open test rules in production.

## 4. Enable Storage
Firebase Console -> Storage -> Get started.
Deploy `storage.rules`.

## 5. Deploy rules / hosting with Firebase CLI
Install Firebase CLI, then from this folder:

    firebase login
    firebase use --add
    firebase deploy --only firestore:rules,storage
    firebase deploy --only hosting

You can also paste the rule files into the Firebase Console Rules tabs.

## 6. Create the first admin safely
1. Open `signup.html` and create your own account normally.
2. In Firestore -> `users` -> your UID document, change `role` from `user` to `admin` manually in Firebase Console.
3. Sign out and sign back in. You will be routed to `admin-index.html`.

Do NOT provide an "admin signup" button in the public website. That would let attackers make themselves admins.

## 7. Verify connection
- Open `firebase-connection.html` after inserting your Firebase config.
- Sign in first for the full Firestore read/write test.
- Firestore should show `users/{uid}` after signup and `connectionChecks/{uid}` after the connection test.
- Bookings appear in `bookings`.
- Provider applications appear in `providerApplications` and uploaded permits/photos in Firebase Storage.

## Important development note
Serve the folder with a local HTTP server instead of opening files with `file://`. Example: VS Code Live Server or `python -m http.server 5500`.
