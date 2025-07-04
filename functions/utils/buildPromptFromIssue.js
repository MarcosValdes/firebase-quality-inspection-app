/**
 * Constructs the prompt for the Gemini model based on various data sources.
 * @param {string} transcription The transcribed audio text.
 * @param {Array<object>} issuesForPrompt An array of issue objects formatted for the prompt.
 * @param {object} qualityCodesJson The JSON object containing quality codes.
 * @param {object} reportTemplateJson The JSON template for the report structure.
 * @returns {string} The complete prompt string for the Gemini API.
 */
module.exports.buildGeminiPrompt = function(transcription, issuesForPrompt, qualityCodesJson, reportTemplateJson) {
  return `
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
};
