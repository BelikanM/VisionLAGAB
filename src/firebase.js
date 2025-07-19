import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDpwr8CE-XJ2Ld_0HIusuZlPCKxWH6UEMk",
  authDomain: "msdos-6eb64.firebaseapp.com",
  databaseURL: "https://msdos-6eb64-default-rtdb.firebaseio.com",
  projectId: "msdos-6eb64",
  storageBucket: "msdos-6eb64.firebasestorage.app",
  messagingSenderId: "392431159146",
  appId: "1:392431159146:web:671ada836ef591d2410713"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;
