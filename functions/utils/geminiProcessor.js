const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAuth } = require("google-auth-library"); // <-- NEW auth library
const { HttpsError } = require("firebase-functions/v2/https");
const { buildGeminiPrompt } = require("./buildPromptFromIssue");
const { reportSchema } = require("./schemas");

async function withRetry(fn, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.log(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
    throw lastError;
}

module.exports.generateReportJSON = async function(
    reportTitle,
    transcription,
    issuesForPrompt,
    qualityCodesJson,
    reportTemplateJson
) {

    // --- ADD THIS LINE TO VERIFY DEPLOYMENT ---
    console.log("--- Running geminiProcessor.js with @google/generative-ai SDK ---");

    // --- NEW: Authenticate using the function's service account ---
    const auth = new GoogleAuth({
        scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
    const genAI = new GoogleGenerativeAI(auth);

    // --- The rest of the code uses the simpler SDK ---
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });

    const prompt = buildGeminiPrompt(
        reportTitle,
        transcription,
        issuesForPrompt,
        qualityCodesJson,
        reportTemplateJson
    );

    let result;
    try {
        const generate = () => model.generateContent(prompt);
        result = await withRetry(generate);
    } catch (error) {
        console.error("Gemini model generation failed after multiple retries:", error);
        throw new HttpsError("internal", "Gemini model generation failed. Please try again later.", { originalError: error });
    }

    let aiGeneratedData;
    try {
        const aiResponseText = result.response.text();
        const cleanedText = aiResponseText.replace(/```(?:json)?/g, "").trim();
        aiGeneratedData = JSON.parse(cleanedText);
    } catch (error) {
        console.error("Failed to parse Gemini response:", error, { text: result.response.text() });
        throw new HttpsError("internal", "Failed to parse the AI model's response.", { originalError: error });
    }

    try {
        const validatedData = reportSchema.parse(aiGeneratedData);
        return validatedData;
    } catch (error) {
        console.error("Zod validation failed:", error.errors);
        const errorDetails = error.errors.map(e => `[${e.path.join('.')}] ${e.message}`).join('; ');
        throw new HttpsError("internal", `AI response validation failed: ${errorDetails}`, { validationErrors: error.errors });
    }
};