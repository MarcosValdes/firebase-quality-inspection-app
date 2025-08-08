// Import Firebase Functions and Admin SDK modules
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// Import Node.js built-in modules
const path = require("path");
const fs = require("fs").promises;

// Import utility functions from local files 
const { transcribeAudio } = require("./utils/transcription");
const { generateReportJSON } = require("./utils/geminiProcessor");
const { generateDocx } = require("./utils/docx-generator");
const { uploadGeneratedFiles } = require("./utils/fileUploader");

// Initialize the Firebase Admin SDK to interact with Firebase services
initializeApp();

// Define constants for Cloud Storage file paths to avoid magic strings
const JSON_TEMPLATE_PATH = "Report-Template.json";
const QUALITY_CODES_PATH = "Quality-Codes-Library.json";
const DOCX_TEMPLATE_PATH = "Report-Template.docx";

/**
 * Creates a new report document in Firestore.
 * This is the first step in the report generation process.
 * @param {object} request - The request object from the client.
 * @param {string} request.data.title - The title of the report.
 * @returns {Promise<{reportId: string}>} A Promise that resolves with the ID of the new report.
 * @throws {HttpsError} Throws "unauthenticated" if the user is not logged in.
 * @throws {HttpsError} Throws "invalid-argument" if the title is missing or invalid.
 */
exports.createReport = onCall({ cors: true, memory: "1GiB" }, async (request) => {
    console.log("CREATE_REPORT_START: Function triggered.");
    // Ensure the user is authenticated before proceeding
    if (!request.auth) {
        console.error("CREATE_REPORT_ERROR: User is not authenticated.");
        throw new HttpsError("unauthenticated", "You must be logged in to create a report.");
    }
    const { title } = request.data;
    const { uid } = request.auth;
    console.log(`Data: Received request from user ${uid} with title: "${title}".`);

    // Validate the incoming 'title' argument
    if (!title || typeof title !== "string" || title.length === 0) {
        console.error("CREATE_REPORT_ERROR: Invalid 'title' argument.");
        throw new HttpsError("invalid-argument", "The function must be called with a valid 'title'.");
    }

    const db = getFirestore();
    console.log("Action: Firestore instance obtained. Next: Define new report document.");
    
    // Define the structure of the new report document
    const newReport = {
        title,
        inspectorId: uid, // Associate the report with the logged-in user
        createdAt: FieldValue.serverTimestamp(), // Use the server's timestamp
        status: "in-progress", // Set the initial status
    };
    console.log(`Data: Report object created: ${JSON.stringify(newReport)}. Next: Add to 'reports' collection.`);

    // Add the new report document to the 'reports' collection
    const docRef = await db.collection("reports").add(newReport);
    console.log(`Action: Report document created in Firestore with ID: ${docRef.id}. Next: Return ID to client.`);
    
    // Return the ID of the newly created document
    console.log("CREATE_REPORT_END: Function finished successfully.");
    return { reportId: docRef.id };
});

/**
 * Adds a new issue document associated with a report.
 * @param {object} request - The request object from the client.
 * @param {string} request.data.reportId - The ID of the report to which this issue belongs.
 * @param {string} request.data.description - The description of the issue.
 * @param {Array<string>} [request.data.imagePaths] - An optional array of Cloud Storage paths to images for this issue.
 * @returns {Promise<{issueId: string}>} A Promise that resolves with the ID of the new issue.
 * @throws {HttpsError} Throws "unauthenticated" if the user is not logged in.
 * @throws {HttpsError} Throws "invalid-argument" if reportId or description are missing.
 */
exports.addIssueToReport = onCall({ cors: true, memory: "1GiB" }, async (request) => {
    console.log("ADD_ISSUE_START: Function triggered.");
    // Ensure the user is authenticated
    if (!request.auth) {
        console.error("ADD_ISSUE_ERROR: User is not authenticated.");
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const { reportId, description, imagePaths } = request.data;
    const { uid } = request.auth;
    console.log(`Data: Received request from user ${uid} for report ${reportId}.`);
    
    // Validate required arguments
    if (!reportId || !description) {
        console.error("ADD_ISSUE_ERROR: Invalid arguments. reportId or description missing.");
        throw new HttpsError("invalid-argument", "Request must include 'reportId' and 'description'.");
    }

    const db = getFirestore();
    console.log("Action: Firestore instance obtained. Next: Define new issue document.");
    
    // Define the structure of the new issue document
    const newIssue = {
        reportId,
        inspectorId: uid,
        description,
        createdAt: FieldValue.serverTimestamp(),
        imagePaths: imagePaths || [], // Default to an empty array if not provided
    };
    console.log(`Data: Issue object created: ${JSON.stringify(newIssue)}. Next: Add to 'issues' collection.`);

    // Add the new issue document to the 'issues' collection
    const docRef = await db.collection("issues").add(newIssue);
    console.log(`Action: Issue document created in Firestore with ID: ${docRef.id}. Next: Return ID to client.`);
    
    // Return the ID of the newly created document
    console.log("ADD_ISSUE_END: Function finished successfully.");
    return { issueId: docRef.id };
});

/**
 * The main function to generate the final DOCX report.
 * It orchestrates transcription, AI content generation, and document creation.
 * @param {object} request - The request object from the client.
 * @param {string} request.data.reportId - The ID of the report to generate.
 * @returns {Promise<{status: string, fileUrl: string}>} A Promise that resolves with the success status and the public URL of the final DOCX file.
 * @throws {HttpsError} Throws various errors based on authentication, arguments, and downstream failures.
 */
exports.generateDocxReport = onCall({
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true
}, async (request) => {
    const { reportId } = request.data;
    console.log(`[${reportId}] GENERATE_DOCX_REPORT_START: Function triggered for report ID: ${reportId}.`);

    if (!request.auth) {
        console.error(`[${reportId}] GENERATE_DOCX_REPORT_ERROR: User is not authenticated.`);
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    if (!reportId) {
        console.error(`[${reportId}] GENERATE_DOCX_REPORT_ERROR: 'reportId' is missing.`);
        throw new HttpsError("invalid-argument", "Request must include a valid 'reportId'.");
    }

    const db = getFirestore();
    const reportRef = db.collection("reports").doc(reportId);
    const tempFilePaths = [];
    console.log(`[${reportId}] Action: Initialized. db, reportRef, and tempFilePaths created.`);

    try {
        console.log(`[${reportId}] --- 1. Fetch and Prepare Data ---`);
        const reportDoc = await reportRef.get();
        if (!reportDoc.exists) {
            throw new HttpsError("not-found", "Report not found.");
        }
        const reportData = reportDoc.data();
        console.log(`[${reportId}] Action: Report document fetched. Status: ${reportData.status}.`);

        if (["finalizing", "complete", "error"].includes(reportData?.status)) {
            throw new HttpsError("failed-precondition", `Report is already in '${reportData.status}' state.`);
        }
        
        await reportRef.update({ status: "finalizing" });
        console.log(`[${reportId}] Action: Report status updated to 'finalizing'. Fetching all related data in parallel.`);

        const [issuesSnapshot, jsonTemplateBuffer, qualityCodesBuffer] = await Promise.all([
            db.collection("issues").where("reportId", "==", reportId).get(),
            getStorage().bucket().file(JSON_TEMPLATE_PATH).download(),
            getStorage().bucket().file(QUALITY_CODES_PATH).download(),
        ]);
        console.log(`[${reportId}] Action: Parallel data fetch complete. Found ${issuesSnapshot.size} issues.`);
        
        const reportTemplateJson = JSON.parse(jsonTemplateBuffer[0].toString('utf8'));
        const qualityCodesJson = JSON.parse(qualityCodesBuffer[0].toString('utf8'));

        console.log(`[${reportId}] --- 2. Process Data and Call AI ---`);
        const transcription = await transcribeAudio(reportData, reportId, getStorage().bucket(), tempFilePaths);
        
        const issuesData = issuesSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        const issuesForPrompt = issuesData.map(issue => ({
            id: issue.id,
            description: issue.description || "No description provided.",
            imageFilenames: (issue.imagePaths || []).map(url => path.basename(decodeURIComponent(url.split('/o/')[1].split('?')[0]))),
        }));
        
        const aiGeneratedData = await generateReportJSON(
            reportData.title,
            transcription,
            issuesForPrompt,
            qualityCodesJson,
            reportTemplateJson
        );
        console.log(`[${reportId}] Action: AI data generation complete. Received ${aiGeneratedData.maengel?.length || 0} defects from AI.`);
        
        console.log(`[${reportId}] --- 3. Augment AI Data with Image URLs ---`);
        const issueImageMap = new Map(issuesData.map(issue => [issue.id, issue.imagePaths]));
        (aiGeneratedData.maengel || []).forEach(mangel => {
            mangel.fotos = issueImageMap.get(mangel.id) || [];
        });
        console.log(`[${reportId}] Action: Image URL augmentation complete.`);


        console.log(`[${reportId}] --- 4. Generate and Finalize Report ---`);
        const outputBuffer = await generateDocx({ ...aiGeneratedData, reportId }, getStorage().bucket(), DOCX_TEMPLATE_PATH);

        const finalUrl = await uploadGeneratedFiles(reportId, outputBuffer, aiGeneratedData);

        await reportRef.update({
            status: "complete",
            finalDocxUrl: finalUrl,
            generatedAt: FieldValue.serverTimestamp(),
        });
        console.log(`[${reportId}] Action: Final Firestore update successful. Status set to 'complete'.`);
        
        console.log(`[${reportId}] GENERATE_DOCX_REPORT_END: Function finished successfully.`);
        return { status: "success", fileUrl: finalUrl };

    } catch (error) {
        console.error(`[${reportId}] GENERATE_DOCX_REPORT_ERROR: An error occurred during execution:`, error);
        await reportRef.update({
            status: "error",
            errorMessage: error.message || "An unknown error occurred during report generation.",
        });
        throw new HttpsError(error.code || "internal", error.message);
    } finally {
        console.log(`[${reportId}] Action: Entering 'finally' block. Cleaning up ${tempFilePaths.length} temporary file(s).`);
        for (const tempPath of tempFilePaths) {
            try {
                await fs.unlink(tempPath);
                console.log(`[${reportId}] Action: Deleted temporary file: ${tempPath}.`);
            } catch (e) {
                console.warn(`[${reportId}] WARNING: Could not delete temporary file: ${tempPath}`, e);
            }
        }
        console.log(`[${reportId}] Action: Temporary file cleanup complete.`);
    }
});