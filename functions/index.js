// Add all necessary imports from Firebase, Google Cloud, and other libraries.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const speech = require("@google-cloud/speech");
const path = require("path");
const { getStorage } = require("firebase-admin/storage");
const os = require("os");
const fs = require("fs").promises; // Use promise-based fs for async/await
const { parseFile } = require("music-metadata");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const https = require("https");
const { defineString } = require('firebase-functions/params');

// Initialize the Firebase Admin SDK.
initializeApp();

// --- CONFIGURATION ---
const geminiApiKey = defineString("GEMINI_API_KEY");
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

  try {
    // --- Step 1: Parallel Data Fetching & Pre-processing ---
    console.log(`Starting robust report generation for ID: ${reportId}`);
    
    const [reportDoc, issuesSnapshot, jsonTemplateBuffer, qualityCodesBuffer] = await Promise.all([
        db.collection("reports").doc(reportId).get(),
        db.collection("issues").where("reportId", "==", reportId).get(),
        bucket.file(JSON_TEMPLATE_PATH).download(),
        bucket.file(QUALITY_CODES_PATH).download()
    ]);

    if (!reportDoc.exists) throw new HttpsError("not-found", "Report document not found.");
    const reportData = reportDoc.data();
    
    const reportTemplateJson = JSON.parse(jsonTemplateBuffer[0].toString('utf8'));
    const qualityCodesJson = JSON.parse(qualityCodesBuffer[0].toString('utf8'));

    // --- Step 2: Robust Audio Transcription (Conditional) ---
    let transcription = "[No audio file was provided for this report.]";

    if (reportData.audioFilePaths && Array.isArray(reportData.audioFilePaths) && reportData.audioFilePaths.length > 0) {
        const audioTempPath = path.join(os.tmpdir(), `audio_${reportId}`);
        tempFilePaths.push(audioTempPath); 
        
        // For simplicity, we process the first audio file. The logic can be expanded to loop over all.
        const audioUrl = reportData.audioFilePaths[0];
        const storageFilePath = decodeURIComponent(audioUrl.split('/o/')[1].split('?')[0]);
        await bucket.file(storageFilePath).download({ destination: audioTempPath });

        const metadata = await parseFile(audioTempPath);
        const config = {
            languageCode: "en-US",
            audioChannelCount: metadata.format.numberOfChannels,
            enableAutomaticPunctuation: true,
        };
        if (metadata.format.codec?.includes("PCM")) config.encoding = "LINEAR16";
        else if (metadata.format.codec?.includes("MPEG")) config.encoding = "MP3";
        else throw new HttpsError("invalid-argument", `Unsupported audio codec: ${metadata.format.codec}`);
        config.sampleRateHertz = metadata.format.sampleRate;
        
        const gcsUri = `gs://${bucket.name}/${storageFilePath}`;
        
        if (metadata.format.duration < 60) {
            const [response] = await new speech.SpeechClient().recognize({ audio: { uri: gcsUri }, config });
            transcription = response.results.map(r => r.alternatives[0].transcript).join('\n');
        } else {
            const [operation] = await new speech.SpeechClient().longRunningRecognize({ audio: { uri: gcsUri }, config });
            const [response] = await operation.promise();
            transcription = response.results.map(r => r.alternatives[0].transcript).join('\n');
        }
        console.log("Transcription successful.");
    } else {
        console.log("No audio file paths found in report. Skipping transcription process.");
    }
    
    // --- Step 3: Create Issues Context for Gemini Prompt ---
    const issuesData = issuesSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    const issuesForPrompt = issuesData.map(issue => ({
        id: issue.id,
        description: issue.description,
        imageFilenames: issue.imagePaths.map(url => path.basename(decodeURIComponent(url.split('/o/')[1].split('?')[0])))
    }));

    // --- Step 4: AI Content Generation (Gemini) ---
    console.log("Constructing prompt and calling Gemini API...");
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      Based on the following context files, your task is to generate a single, valid JSON object that strictly follows the structure of the provided "JSON Report Template". Populate the fields using the information from the other files. Ensure the 'description' for each issue is a professionally rewritten version of the raw notes, using the full audio transcript for context. Maintain the exact relationship between issues and their 'image_filenames'. Also, preserve the original 'id' for each issue.

      CONTEXT 1: AUDIO TRANSCRIPT:
      ${transcription}
      ---
      CONTEXT 2: ISSUES AND IMAGES JSON:
      ${JSON.stringify(issuesForPrompt, null, 2)}
      ---
      CONTEXT 3: QUALITY CODES LIBRARY:
      ${JSON.stringify(qualityCodesJson, null, 2)}
      ---
      CONTEXT 4: JSON REPORT TEMPLATE (YOUR OUTPUT MUST MATCH THIS STRUCTURE):
      ${JSON.stringify(reportTemplateJson, null, 2)}
      ---

      Now, generate only the final JSON object. Do not include any other text, explanations, or markdown formatting.`;

    const result = await model.generateContent(prompt);
    let aiResponseText = result.response.text();
    aiResponseText = aiResponseText.replace(/```json\n?/g, "").replace(/```/g, "");
    const aiGeneratedData = JSON.parse(aiResponseText);
    console.log("AI-generated JSON structure received successfully.");
    
    // --- ** NEW ROBUSTNESS CHECK: Validate the AI's Response ** ---
    if (!aiGeneratedData || !Array.isArray(aiGeneratedData.issues)) {
        console.error("AI response is missing a valid 'issues' array. Response received:", JSON.stringify(aiGeneratedData, null, 2));
        throw new HttpsError("internal", "The AI model returned an invalid or unexpected data structure. Could not process the report.");
    }
    // --- END OF NEW CHECK ---

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
    console.log("Generating DOCX file from template...");
    const docxTemplateBuffer = await bucket.file(DOCX_TEMPLATE_PATH).download();
    const zip = new PizZip(docxTemplateBuffer[0]);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        modules: [{
            name: "ImageModule",
            options: {
                centered: false,
                getImage: (tag) => Buffer.from(tag, 'base64'),
                getSize: () => [450, 300],
            }
        }]
    });
    
    doc.setData(aiGeneratedData);
    doc.render();
    const outputBuffer = doc.getZip().generate({ type: "nodebuffer" });

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
    throw new HttpsError("internal", userMessage);
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
