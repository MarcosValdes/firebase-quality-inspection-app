const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const path = require("path");
const fs = require("fs").promises;
const https = require("https-proxy-agent");

const { transcribeAudio } = require("./utils/transcription");
const { generateReportJSON } = require("./utils/geminiProcessor");
const { generateDocx } = require("./utils/docx-generator");
const { uploadGeneratedFiles } = require("./utils/fileUploader");

initializeApp();

const JSON_TEMPLATE_PATH = "Report-Template.json";
const QUALITY_CODES_PATH = "Quality-Codes-Library.json";
const DOCX_TEMPLATE_PATH = "Report-Template.docx";

// --- All functions are now configured with 1GiB of memory ---

exports.createReport = onCall({ cors: true, memory: "1GiB" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in to create a report.");
    }
    const { title } = request.data;
    if (!title || typeof title !== "string" || title.length === 0) {
        throw new HttpsError("invalid-argument", "The function must be called with a valid 'title'.");
    }
    const db = getFirestore();
    const newReport = {
        title,
        inspectorId: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
        status: "in-progress",
    };
    const docRef = await db.collection("reports").add(newReport);
    return { reportId: docRef.id };
});

exports.addIssueToReport = onCall({ cors: true, memory: "1GiB" }, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const { reportId, description, imagePaths } = request.data;
    if (!reportId || !description) {
        throw new HttpsError("invalid-argument", "Request must include 'reportId' and 'description'.");
    }
    const db = getFirestore();
    const newIssue = {
        reportId,
        inspectorId: request.auth.uid,
        description,
        createdAt: FieldValue.serverTimestamp(),
        imagePaths: imagePaths || [],
    };
    const docRef = await db.collection("issues").add(newIssue);
    return { issueId: docRef.id };
});

exports.generateDocxReport = onCall({
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in.");
    }
    const { reportId } = request.data;
    if (!reportId) {
        throw new HttpsError("invalid-argument", "Request must include a valid 'reportId'.");
    }
    const db = getFirestore();
    const reportRef = db.collection("reports").doc(reportId);
    const tempFilePaths = [];
    try {
        const reportDoc = await reportRef.get();
        if (!reportDoc.exists) {
            throw new HttpsError("not-found", "Report not found.");
        }
        const reportData = reportDoc.data();
        if (["finalizing", "complete", "error"].includes(reportData?.status)) {
            throw new HttpsError("failed-precondition", `Report is already in '${reportData.status}' state.`);
        }
        await reportRef.update({ status: "finalizing" });
        const [issuesSnapshot, jsonTemplateBuffer, qualityCodesBuffer] = await Promise.all([
            db.collection("issues").where("reportId", "==", reportId).get(),
            getStorage().bucket().file(JSON_TEMPLATE_PATH).download(),
            getStorage().bucket().file(QUALITY_CODES_PATH).download(),
        ]);
        const reportTemplateJson = JSON.parse(jsonTemplateBuffer[0].toString('utf8'));
        const qualityCodesJson = JSON.parse(qualityCodesBuffer[0].toString('utf8'));
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
        const issueImageMap = new Map(issuesData.map(issue => [issue.id, issue.imagePaths]));
        await Promise.all((aiGeneratedData.maengel || []).map(async (mangel) => {
            const originalImageUrls = issueImageMap.get(mangel.id);
            if (originalImageUrls && originalImageUrls.length > 0) {
                const imageDownloads = originalImageUrls.map(imageUrl =>
                    new Promise((resolve, reject) => {
                        https.get(imageUrl, res => {
                            const chunks = [];
                            res.on('data', chunk => chunks.push(chunk));
                            res.on('end', () => resolve(Buffer.concat(chunks)));
                            res.on('error', reject);
                        });
                    })
                );
                mangel.fotos = (await Promise.all(imageDownloads)).map(imgData => ({ image: imgData }));
            }
        }));
        const outputBuffer = await generateDocx(aiGeneratedData, getStorage().bucket(), DOCX_TEMPLATE_PATH);
        const finalUrl = await uploadGeneratedFiles(reportId, outputBuffer, aiGeneratedData);
        await reportRef.update({
            status: "complete",
            finalDocxUrl: finalUrl,
            generatedAt: FieldValue.serverTimestamp(),
        });
        return { status: "success", fileUrl: finalUrl };
    } catch (error) {
        console.error("Detailed error in generateDocxReport:", error);
        await reportRef.update({
            status: "error",
            errorMessage: error.message || "An unknown error occurred during report generation.",
        });
        throw new HttpsError(error.code || "internal", error.message);
    } finally {
        for (const tempPath of tempFilePaths) {
            try {
                await fs.unlink(tempPath);
            } catch (e) {
                console.warn(`Could not delete temporary file: ${tempPath}`, e);
            }
        }
    }
});