# REPARO Firebase-connected version

This folder keeps the supplied REPARO HTML/CSS design and adds Firebase backend code.

## Firebase services used
- Firebase Authentication: Email/Password, Google sign-in, password reset.
- Cloud Firestore: users, bookings, provider applications, service requests, notifications, messages, feedback, logs.
- Cloud Storage: provider profile photos and business permits.

## First-time Firebase Console setup
1. Authentication -> Sign-in method -> enable Email/Password.
2. Authentication -> Sign-in method -> enable Google.
3. Authentication -> Settings -> Authorized domains -> add the domain you use for testing (for Live Server, add `127.0.0.1` if needed).
4. Firestore Database -> create the database.
5. Storage -> Get started.
6. Publish/deploy `firestore.rules` and `storage.rules` from this folder.

## Run locally
Do not double-click the HTML with `file://`.
Use VS Code Live Server, for example:

    http://127.0.0.1:5500/login.html

## Deploy Firebase rules and hosting
Install the Firebase CLI and run from this folder:

    firebase login
    firebase use --add
    firebase deploy --only firestore:rules,storage
    firebase deploy --only hosting

## Create the first admin
Public admin signup is intentionally not included.
1. Register a normal account through `signup.html`.
2. Firebase Console -> Firestore -> `users` -> that user's UID.
3. Change only the `role` field from `user` to `admin`.
4. Sign out and sign in again.

## Provider application flow
Customer -> Become a Provider -> Step 1 -> Step 2 -> Step 3 -> upload photo and business permit -> `providerApplications/{uid}`.
The admin reviews it in Provider Approval. Approving it changes the user's role to `provider` and stores the provider profile fields in `users/{uid}`.

## Password security
REPARO does not store passwords in Firestore. Firebase Authentication manages password credentials. Firestore stores profile/role data only.

## Custom password reset page
`reset-password.html` supports Firebase `oobCode` reset links. If you want Firebase's password-reset email to open this REPARO page instead of the default Firebase handler, configure the Password reset template/action handler in Firebase Authentication to point to your deployed `reset-password.html` URL.

## Important limitation: email/SMS reminders
The Renewal Reminders page is connected to Firestore and records reminder actions. Sending a real external email/SMS requires an email/SMS delivery service, Firebase Extension, or Cloud Function. That external delivery service is not included because no email/SMS provider credentials were supplied.

## Main collections
- `users/{uid}`
- `bookings/{bookingId}`
- `providerApplications/{uid}`
- `serviceRequests/{requestId}`
- `notifications/{notificationId}`
- `messages/{messageId}`
- `feedback/{feedbackId}`
- `activityLogs/{logId}`
- `adminReminders/{reminderId}`
- `connectionChecks/{uid}`
