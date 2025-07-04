const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require('firebase-functions/params');
const { buildGeminiPrompt } = require("./buildPromptFromIssue");
const { reportSchema } = require("./schemas");

const geminiApiKey = defineString("GEMINI_API_KEY");

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

/**
 * Generates and validates the report JSON using the Gemini model and Zod schema.
 * @returns {Promise<object>} A promise that resolves with the validated AI-generated JSON object.
 * @throws {HttpsError} Throws an error if validation or generation fails.
 */
module.exports.generateReportJSON = async function(transcription, issuesForPrompt, qualityCodesJson, reportTemplateJson) {
  const genAI = new GoogleGenerativeAI(geminiApiKey.value());
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = buildGeminiPrompt(transcription, issuesForPrompt, qualityCodesJson, reportTemplateJson);

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
  } catch(error) {
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