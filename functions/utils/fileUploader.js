const { getStorage } = require("firebase-admin/storage");

/**
 * Uploads the generated DOCX and JSON files to Cloud Storage.
 * @param {string} reportId The ID of the report.
 * @param {Buffer} docxBuffer The buffer containing the generated DOCX file.
 * @param {object} jsonData The AI-generated JSON data.
 * @returns {Promise<string>} A promise that resolves with the signed URL of the generated DOCX file.
 */
module.exports.uploadGeneratedFiles = async function(reportId, docxBuffer, jsonData) {
    console.log(`[${reportId}] -- FILE_UPLOAD_START`);
    const bucket = getStorage().bucket();

    // --- Upload DOCX ---
    const docxPath = `final-reports/${reportId}.docx`;
    const docxFile = bucket.file(docxPath);
    console.log(`[${reportId}] Action: Uploading generated DOCX to gs://${bucket.name}/${docxPath}. Size: ${docxBuffer.length} bytes. Next: Await upload completion.`);
    await docxFile.save(docxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    console.log(`[${reportId}] Action: DOCX file uploaded successfully. Next: Upload JSON data.`);

    // --- Upload JSON ---
    const jsonPath = `final-reports/${reportId}.json`;
    const jsonString = JSON.stringify(jsonData, null, 2);
    console.log(`[${reportId}] Action: Uploading AI-generated JSON to gs://${bucket.name}/${jsonPath}. Size: ${jsonString.length} bytes. Next: Await upload completion.`);
    await bucket.file(jsonPath).save(jsonString, {
        contentType: "application/json",
    });
    console.log(`[${reportId}] Action: JSON file uploaded successfully. Next: Generate signed URL for the DOCX file.`);

    // --- Generate Signed URL ---
    const [signedUrl] = await docxFile.getSignedUrl({ action: 'read', expires: '03-09-2491' });
    console.log(`[${reportId}] Action: Signed URL generated successfully. Next: Return URL.`);
    
    console.log(`[${reportId}] -- FILE_UPLOAD_END`);
    return signedUrl;
}