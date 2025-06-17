// File: functions/index.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

exports.createReport = onCall((request) => {
  // 1. Check for authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in to create a report.");
  }

  // 2. Get data from the request
  const { title } = request.data;
  const inspectorId = request.auth.uid;

  if (!title || typeof title !== "string" || title.length === 0) {
    throw new HttpsError("invalid-argument", "The function must be called with a valid 'title'.");
  }

  // 3. Create a new document in the 'reports' collection
  const db = getFirestore();
  const newReport = {
    title: title,
    inspectorId: inspectorId,
    createdAt: FieldValue.serverTimestamp(),
    status: "in-progress",
    audioFilePath: null, // This will be updated by the client after upload
  };

  return db.collection("reports").add(newReport)
    .then((docRef) => {
      console.log("New report created with ID:", docRef.id);
      return { reportId: docRef.id }; // 4. Return the new report's ID
    })
    .catch((error) => {
      console.error("Error creating report:", error);
      throw new HttpsError("internal", "Failed to create the report document.");
    });
});