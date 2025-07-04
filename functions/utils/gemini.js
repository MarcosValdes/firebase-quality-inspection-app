const { GoogleGenerativeAI } = require("@google/generative-ai");
const { HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require('firebase-functions/params');

const geminiApiKey = defineString("GEMINI_API_KEY");

module.exports.generateReportJSON = async function(transcription, issuesForPrompt, qualityCodesJson, reportTemplateJson) {
  const genAI = new GoogleGenerativeAI(geminiApiKey.value());
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
  aiResponseText = aiResponseText.replace(/```json
?/g, "").replace(/```/g, "");
  const aiGeneratedData = JSON.parse(aiResponseText);
  console.log("AI-generated JSON structure received successfully.");
  
  if (!aiGeneratedData || !Array.isArray(aiGeneratedData.issues)) {
      console.error("AI response is missing a valid 'issues' array. Response received:", JSON.stringify(aiGeneratedData, null, 2));
      throw new HttpsError("internal", "The AI model returned an invalid or unexpected data structure. Could not process the report.");
  }

  return aiGeneratedData;
};
