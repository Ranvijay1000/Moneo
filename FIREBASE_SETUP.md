# Turn on shared accounts and loans

The app runs in browser-only demo mode until a Firebase project is configured. Firebase Authentication provides real accounts, and Cloud Firestore syncs a shared loan to both participants in real time.

## Create the Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) and create a project.
2. In **Build → Authentication → Sign-in method**, enable **Email/Password**.
3. In **Build → Firestore Database**, create a database. Start in production mode.
4. In **Project settings → General**, add a Web app and copy its Firebase configuration.
5. Paste the configuration values into `firebase-config.js`.
6. In Firestore **Rules**, publish the contents of `firestore.rules`.
7. Serve the app over HTTPS (or localhost during development). Firebase modules do not run from a `file://` URL.

Once configured, sign-up and login use Firebase Authentication. Cloud accounts log in with their email address; username-only login stays available in browser-only demo mode. Each account publishes a username and email as exact-match lookup entries; the directory cannot be listed. In the loan form, enter the other person's moneo username or email to check whether they have an account. If found, creating a loan shares it with that account immediately. Both people can see and settle the shared record. If the person isn't found, the loan remains private to the current account.

## Important

Firebase's web configuration is intended to be present in a web client. Firestore Security Rules protect account data and shared loans. Do not loosen the rules to public read/write access. The old browser-only demo accounts do not migrate automatically; each person creates a Firebase account after setup. Use the same published Firestore rules in the Firebase console before enabling real user data.
