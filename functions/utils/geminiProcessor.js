const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require('firebase-functions/params');
const { buildGeminiPrompt } = require("./buildPromptFromIssue");

const geminiApiKey = defineString("GEMINI_API_KEY");

/**
 * A helper function to retry an async function a specified number of times with a delay.
 * @param {Function} fn The async function to retry.
 * @param {number} retries The number of retry attempts.
 * @param {number} delay The delay between retries in milliseconds.
 * @returns {Promise<any>} A promise that resolves with the result of the async function.
 */
async function withRetry(fn, retries = 3, delay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.log(`Attempt ${i + 1} failed. Retrying in ${delay}ms...`);
            await new Promise(res => setTimeout(res, delay * (i + 1))); // Incremental backoff
        }
    }
    throw lastError;
}

/**
 * Generates a report JSON using the Gemini model, with retries.
 * @param {string} transcription The transcribed audio text.
 * @param {Array<object>} issuesForPrompt An array of issue objects formatted for the prompt.
 * @param {object} qualityCodesJson The JSON object containing quality codes.
 * @param {object} reportTemplateJson The JSON template for the report structure.
 * @returns {Promise<object>} A promise that resolves with the AI-generated JSON object.
 * @throws {HttpsError} Throws an error if the Gemini API call fails or returns an invalid response.
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

  try {
    const aiResponseText = result.response.text();
    const cleanedText = aiResponseText.replace(/```json
?/g, "").replace(/```/g, "");
    const aiGeneratedData = JSON.parse(cleanedText);

    if (!aiGeneratedData || !Array.isArray(aiGeneratedData.issues)) {
        throw new Error("The AI model returned an invalid or unexpected data structure.");
    }
    return aiGeneratedData;
  } catch(error) {
    console.error("Failed to parse Gemini response:", error, { text: result.response.text() });
    throw new HttpsError("internal", "Failed to parse the AI model's response.", { originalError: error });
  }
};