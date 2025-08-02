const { VertexAI } = require('@google-cloud/vertexai');
const { HttpsError } = require("firebase-functions/v2/https");
const { buildGeminiPrompt } = require("./buildPromptFromIssue");
const { reportSchema } = require("./schemas");

async function withRetry(fn, retries = 3, delay = 1000) {
    console.log("Action: Entering withRetry function. Justification: This function will attempt to execute a provided function, retrying on failure. Next: Execute the function in a try-catch block.");
    let lastError;
    for (let i = 0; i < retries; i++) {
        console.log(`Action: Retry attempt ${i + 1}. Justification: Attempting to execute the wrapped function. Next: Execute the function and handle potential errors.`);
        try {
            const result = await fn();
            console.log(`Action: Attempt ${i + 1} successful. Justification: The wrapped function executed without throwing an error. Data: A result was received. Next: Return the result.`);
            return result;
        } catch (error) {
            lastError = error;
            console.log(`Action: Attempt ${i + 1} failed. Justification: The wrapped function threw an error. Next: Wait for ${delay * (i + 1)}ms before the next attempt.`);
            console.error(`Error during attempt ${i + 1}:`, error);
            await new Promise(res => setTimeout(res, delay * (i + 1)));
        }
    }
    console.log("Action: Maximum retries reached. Justification: The function failed all retry attempts. Next: Throw the last captured error.");
    throw lastError;
}

module.exports.generateReportJSON = async function(
    reportTitle,
    transcription,
    issuesForPrompt,
    qualityCodesJson,
    reportTemplateJson
) {
    console.log(`Action: Invoking generateReportJSON. Justification: Starting the process to generate a report from transcription and issue data. Data: reportTitle = "${reportTitle}". Next: Log remaining input data.`);
    console.log(`Data: transcription (first 100 chars) = "${transcription.substring(0, 100)}..."`);
    console.log(`Data: issuesForPrompt = ${JSON.stringify(issuesForPrompt, null, 2)}`);
    console.log(`Data: qualityCodesJson = ${JSON.stringify(qualityCodesJson, null, 2)}`);
    console.log(`Data: reportTemplateJson = ${JSON.stringify(reportTemplateJson, null, 2)}`);

    const PROJECT_ID = "gardisen-quality-inspections";
    const LOCATION = "us-central1";
    const MODEL_NAME = "gemini-1.5-pro-preview-0409";

    console.log("Action: Initializing VertexAI. Justification: Creating a client to interact with the Vertex AI platform using Application Default Credentials. Next: Get the specific generative model.");
    const vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });

    const generativeModel = vertexAI.getGenerativeModel({
        model: MODEL_NAME,
        generation_config: {
          "maxOutputTokens": 8192,
          "temperature": 0.2,
          "topP": 1,
        },
        safety_settings: [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ],
    });

    console.log("Action: Building Gemini prompt. Justification: Calling buildGeminiPrompt to construct the input for the AI model. Next: Call the AI model.");
    const prompt = buildGeminiPrompt(
        reportTitle,
        transcription,
        issuesForPrompt,
        qualityCodesJson,
        reportTemplateJson
    );

    let result;
    try {
        console.log("Action: Preparing to call the AI model via withRetry. Justification: Wrapping the model generation call in a retry mechanism to handle transient errors. Next: Execute withRetry.");
        const generate = async () => {
            console.log("Action: Executing generativeModel.generateContent. Justification: Sending the prompt to the Vertex AI Gemini API. Next: Await response.");
            const request = {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
            };
            const response = await generativeModel.generateContent(request);
            return response;
        };
        result = await withRetry(generate);
        console.log(`Action: AI model call successful. Justification: Received a response from the Vertex AI API.`);
    } catch (error) {
        console.error("Vertex AI model generation failed after multiple retries:", error);
        throw new HttpsError("internal", "Vertex AI model generation failed. Please try again later.", { originalError: error });
    }

    let aiGeneratedData;
    try {
        console.log("Action: Extracting text from AI response. Justification: Raw API response must be converted to text for parsing. Next: Clean the extracted text.");
        const aiResponseText = result.response.candidates[0].content.parts[0].text;
        console.log(`Action: Extracted text from response. Data: \`aiResponseText\` = """
${aiResponseText}
""". Next: Clean the extracted text.`);

        console.log("Action: Cleaning AI response text. Justification: Removing markdown formatting (e.g., ```json) to ensure valid JSON. Next: Parse cleaned text.");
        const cleanedText = aiResponseText.replace(/```(?:json)?/g, "").trim();
        console.log(`Action: Cleaned response text. Data: \`cleanedText\` = """
${cleanedText}
""". Next: Parse text to JSON.`);

        console.log("Action: Parsing cleaned text to JSON. Justification: Converting the JSON string into a JavaScript object. Next: Validate the object against the Zod schema.");
        aiGeneratedData = JSON.parse(cleanedText);
        console.log(`Action: JSON parsing successful. Data: \`aiGeneratedData\` = ${JSON.stringify(aiGeneratedData, null, 2)}. Next: Proceed to Zod validation.`);
    } catch (error) {
        console.error("Failed to parse Vertex AI response:", error, { response: result?.response });
        throw new HttpsError("internal", "Failed to parse the AI model's response.", { originalError: error });
    }

    try {
        console.log("Action: Validating AI-generated data with Zod schema. Justification: Ensuring the AI response matches the required 'reportSchema' structure. Next: Return validated data.");
        const validatedData = reportSchema.parse(aiGeneratedData);
        console.log(`Action: Zod validation successful. Data: \`validatedData\` = ${JSON.stringify(validatedData, null, 2)}. Next: Return validated data and complete execution.`);
        return validatedData;
    } catch (error) {
        console.error("--- AI Generated Data (before Zod validation): ---");
        console.log(JSON.stringify(aiGeneratedData, null, 2));
        console.error("Zod validation failed:", error.errors);
        const errorDetails = error.errors.map(e => `[${e.path.join('.')}] ${e.message}`).join('; ');
        console.log(`Action: Zod validation failed. Data: \`errorDetails\` = "${errorDetails}". Next: Throw HttpsError.`);
        throw new HttpsError("internal", `AI response validation failed: ${errorDetails}`, { validationErrors: error.errors });
    }
};