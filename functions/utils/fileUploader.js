const { getStorage } = require("firebase-admin/storage");

/**
 * Uploads the generated DOCX and JSON files to Cloud Storage.
 * @param {string} reportId The ID of the report.
 * @param {Buffer} docxBuffer The buffer containing the generated DOCX file.
 * @param {object} jsonData The AI-generated JSON data.
 * @returns {Promise<string>} A promise that resolves with the signed URL of the generated DOCX file.
 */
module.exports.uploadGeneratedFiles = async function(reportId, docxBuffer, jsonData) {
    const bucket = getStorage().bucket();

    // Upload DOCX
    const docxPath = `final-reports/${reportId}.docx`;
    const docxFile = bucket.file(docxPath);
    await docxFile.save(docxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // Upload JSON
    const jsonPath = `final-reports/${reportId}.json`;
    await bucket.file(jsonPath).save(JSON.stringify(jsonData, null, 2), {
        contentType: "application/json",
    });

    const [signedUrl] = await docxFile.getSignedUrl({ action: 'read', expires: '03-09-2491' });
    return signedUrl;
}
