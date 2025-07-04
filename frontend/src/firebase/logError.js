import { db } from "./firebase-config";
import { collection, addDoc } from "firebase/firestore";

export async function logErrorToFirestore(error, context) {
  try {
    await addDoc(collection(db, "logs"), {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: new Date().toISOString(),
    });
  } catch (loggingError) {
    console.error("Failed to log error to Firestore:", loggingError);
    // As a fallback, log the original error to the console.
    console.error("Original error:", error);
  }
}
