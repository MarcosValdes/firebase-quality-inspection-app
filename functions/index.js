// Add all necessary imports from Firebase, Google Cloud, and other libraries.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const path = require("path");
const { getStorage } = require("firebase-admin/storage");
const os = require("os");
const fs = require("fs").promises; // Use promise-based fs for async/await
const https = require("https");
const { defineString } = require('firebase-functions/params');

const { transcribeAudio } = require("./utils/transcription");
const { generateReportJSON } = require("./utils/gemini");
const { generateDocx } = require("./utils/docx-generator");

// Initialize the Firebase Admin SDK.
initializeApp();

// --- CONFIGURATION ---
// The paths to the context and template files in your Cloud Storage bucket.
const DOCX_TEMPLATE_PATH = "Report-Template.docx";
const JSON_TEMPLATE_PATH = "Report-Template.json";
const QUALITY_CODES_PATH = "Quality-Codes-Library.json";
// --- END CONFIGURATION ---



/**
 * Creates a new inspection report document in Firestore.
 *
 * @param {object} request The request object from the client.
 * @param {string} request.auth.uid The UID of the authenticated user.
 * @param {object} request.data The data sent from the client.
 * @param {string} request.data.title The title of the report.
 * @returns {Promise<{reportId: string}>} A promise that resolves with the new report's ID.
 * @throws {HttpsError} Throws an error if the user is not authenticated or if the
 * arguments are invalid.
 */
exports.createReport = onCall((request) => {
  // 1. Check for authentication.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in to create a report.");
  }

  // 2. Get data from the request and validate it.
  const { title } = request.data;
  const inspectorId = request.auth.uid;

  if (!title || typeof title !== "string" || title.length === 0) {
    throw new HttpsError("invalid-argument", "The function must be called with a valid 'title'.");
  }

  // 3. Create a new document in the 'reports' collection.
  const db = getFirestore();
  const newReport = {
    title: title,
    inspectorId: inspectorId,
    createdAt: FieldValue.serverTimestamp(),
    status: "in-progress",
    audioFilePath: null, // This will be updated by the client after audio upload.
  };

  return db.collection("reports").add(newReport)
    .then((docRef) => {
      console.log("New report created with ID:", docRef.id);
      return { reportId: docRef.id }; // 4. Return the new report's ID to the client.
    })
    .catch((error) => {
      console.error("Error creating report:", error);
      throw new HttpsError("internal", "Failed to create the report document.");
    });
});

/**
 * Adds a new issue document to a report in Firestore.
 *
 * @param {object} request The request object from the client.
 * @param {string} request.auth.uid The UID of the authenticated user.
 * @param {object} request.data The data sent from the client.
 * @param {string} request.data.reportId The ID of the report to add the issue to.
 * @param {string} request.data.description The description of the issue.
 * @returns {Promise<{issueId: string}>} A promise that resolves with the new issue's ID.
 * @throws {HttpsError} Throws an error if the user is not authenticated or if the
 * arguments are invalid.
 */
exports.addIssueToReport = onCall((request) => {
  // Check for authentication.
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }

  // Get data from the request and validate it.
  const { reportId, description } = request.data;
  const inspectorId = request.auth.uid;

  if (!reportId || !description) {
    throw new HttpsError("invalid-argument", "Request must include a valid 'reportId' and 'description'.");
  }

  // Create a new document in the 'issues' collection.
  const db = getFirestore();
  const newIssue = {
    reportId: reportId,
    inspectorId: inspectorId,
    description: description,
    createdAt: FieldValue.serverTimestamp(),
    imagePaths: [], // Client will update this after photo uploads.
  };

  return db.collection("issues").add(newIssue)
    .then((docRef) => {
      console.log("New issue created with ID:", docRef.id);
      return { issueId: docRef.id };
    })
    .catch((error) => {
      console.error("Error creating issue:", error);
      throw new HttpsError("internal", "Failed to create the issue document.");
    });
});

/**
 * A robust, callable Cloud Function to generate a complete quality inspection report.
 * It aggregates data, transcribes multiple audio files, uses AI to generate content, and creates a .docx file.
 */
exports.generateDocxReport = onCall({
  timeoutSeconds: 540,
  memory: "1GiB"
}, async (request) => {
  // 1. Enhanced Input Validation
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be logged in to generate a report.");
  }
  const { reportId } = request.data;
  if (!reportId || typeof reportId !== "string" || reportId.length === 0) {
    throw new HttpsError("invalid-argument", "Request must include a valid 'reportId'.");
  }

  const db = getFirestore();
  const bucket = getStorage().bucket();
  const tempFilePaths = []; // Array for tracking temporary files for cleanup.
  const reportRef = db.collection("reports").doc(reportId);

  try {
    const reportDoc = await reportRef.get();
    if (!reportDoc.exists) {
      throw new HttpsError("not-found", "Report document not found.");
    }
    const reportData = reportDoc.data();

    // Prevent concurrent or duplicate report generations.
    if (reportData.status === "finalizing" || reportData.status === "complete") {
      throw new HttpsError("already-exists", `Report generation is already ${reportData.status}.`);
    }

    // Update the report status to "finalizing".
    await reportRef.update({ status: "finalizing" });

    // --- Step 1: Parallel Data Fetching & Pre-processing ---
    console.log(`Starting robust report generation for ID: ${reportId}`);
    
    const [issuesSnapshot, jsonTemplateBuffer, qualityCodesBuffer] = await Promise.all([
        db.collection("issues").where("reportId", "==", reportId).get(),
        bucket.file(JSON_TEMPLATE_PATH).download(),
        bucket.file(QUALITY_CODES_PATH).download()
    ]);
    
    const reportTemplateJson = JSON.parse(jsonTemplateBuffer[0].toString('utf8'));
    const qualityCodesJson = JSON.parse(qualityCodesBuffer[0].toString('utf8'));

    // --- Step 2: Robust Audio Transcription (Conditional) ---
    const transcription = await transcribeAudio(reportData, reportId, bucket, tempFilePaths);

    // --- Step 3: Create Issues Context for Gemini Prompt ---
    const issuesData = issuesSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const issuesForPrompt = issuesData.map(issue => ({
        id: issue.id,
        description: issue.description,
        imageFilenames: issue.imagePaths.map(url => path.basename(decodeURIComponent(url.split('/o/')[1].split('?')[0])))
    }));

    // --- Step 4: AI Content Generation (Gemini) ---
    const aiGeneratedData = await generateReportJSON(transcription, issuesForPrompt, qualityCodesJson, reportTemplateJson);
    
    // --- Step 4a: Save AI-generated JSON ---
    const jsonPath = `final-reports/${reportId}.json`;
    await bucket.file(jsonPath).save(JSON.stringify(aiGeneratedData, null, 2), {
      contentType: "application/json",
    });

    // --- Step 5: Image Processing & Data Merging for DOCX ---
    console.log("Processing images for DOCX insertion...");
    const issueImageMap = new Map(issuesData.map(issue => [issue.id, issue.imagePaths]));
    
    for(const issue of aiGeneratedData.issues) {
        const originalImageUrls = issueImageMap.get(issue.id);
        if(originalImageUrls && originalImageUrls.length > 0) {
            const imageDownloads = originalImageUrls.map(imageUrl => 
                new Promise((resolve, reject) => {
                    https.get(imageUrl, res => {
                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
                        res.on('error', reject);
                    });
                })
            );
            const base64Images = await Promise.all(imageDownloads);
            issue.images = base64Images.map(imgData => ({ image: imgData }));
        }
    }
    
    // --- Step 6: DOCX Generation ---
    const outputBuffer = await generateDocx(aiGeneratedData, bucket, DOCX_TEMPLATE_PATH);

    // --- Step 7: Finalization and Storage ---
    console.log("Uploading final report to Cloud Storage...");
    const finalReportPath = `final-reports/${reportId}.docx`;
    const file = bucket.file(finalReportPath);
    await file.save(outputBuffer, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const [finalUrl] = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    await reportRef.update({
      status: "complete",
      finalDocxUrl: finalUrl,
    });

    console.log("Report generation complete!");
    return { status: "success", fileUrl: finalUrl };

  } catch (error) {
    console.error("Detailed error in generateDocxReport:", error);
    let userMessage = "An error occurred during report generation.";
    if (error.code && error.details) userMessage = error.details;
    else if (error instanceof Error) userMessage = error.message;
    
    // Update the report status to "failed" in Firestore.
    if (error.code !== "already-exists") {
        await reportRef.update({
            status: "failed",
            error: userMessage
        });
    }
    
    throw new HttpsError(error.code || "internal", userMessage);
  } finally {
    // --- Step 8: Guaranteed Resource Cleanup ---
    console.log("Cleaning up temporary files...");
    for (const tempPath of tempFilePaths) {
      try {
        if (await fs.stat(tempPath).catch(() => false)) {
            await fs.unlink(tempPath);
        }
      } catch (e) {
        console.warn(`Could not delete temporary file: ${tempPath}`, e);
      }
    }
  }
});