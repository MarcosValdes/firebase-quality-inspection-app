// No require statements at the top level

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
    // --- LAZY LOADING: All libraries are required inside the function ---
    const { VertexAI } = require('@google-cloud/aiplatform');
    const { HttpsError } = require("firebase-functions/v2/https");
    const { buildGeminiPrompt } = require("./buildPromptFromIssue");
    const { reportSchema } = require("./schemas");
    
    const vertex_ai = new VertexAI({
        project: 'gardisen-quality-inspections',
        location: 'us-central1',
    });
    
    const model = 'gemini-1.5-pro-001';
    
    const generativeModel = vertex_ai.getGenerativeModel({
        model: model,
    });
    
    const prompt = buildGeminiPrompt(
        reportTitle,
        transcription,
        issuesForPrompt,
        qualityCodesJson,
        reportTemplateJson
    );

    let result;
    try {
        const generate = async () => {
            const request = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
            return await generativeModel.generateContent(request);
        };
        result = await withRetry(generate);
    } catch (error) {
        console.error("Vertex AI model generation failed after multiple retries:", error);
        throw new HttpsError("internal", "Vertex AI model generation failed. Please try again later.", { originalError: error });
    }

    let aiGeneratedData;
    try {
        const aiResponseText = result.response.candidates[0].content.parts[0].text;
        const cleanedText = aiResponseText.replace(/```(?:json)?/g, "").trim();
        aiGeneratedData = JSON.parse(cleanedText);
    } catch (error) {
        console.error("Failed to parse Vertex AI response:", error, { response: result.response });
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