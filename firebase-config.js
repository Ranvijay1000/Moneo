// Copy the web app configuration from Firebase Console → Project settings.
// Leave these values empty to keep using the browser-only demo mode.
export const firebaseConfig = {
  apiKey: "AIzaSyBOEjh4tsjmiAgqzOfTkVubF4yiFCKf59Q",
  authDomain: "moneo-66d91.firebaseapp.com",
  projectId: "moneo-66d91",
  storageBucket: "moneo-66d91.firebasestorage.app",
  messagingSenderId: "335438323753",
  appId: "1:335438323753:web:cd0fed44ba69ee4ac4fc38",
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
