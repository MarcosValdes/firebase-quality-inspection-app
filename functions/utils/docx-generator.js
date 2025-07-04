const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

/**
 * Generates a DOCX file from a template and data.
 * @param {object} data The data to populate the template with.
 * @param {object} bucket The Cloud Storage bucket object.
 * @param {string} templatePath The path to the DOCX template in Cloud Storage.
 * @returns {Promise<Buffer>} A promise that resolves with the generated DOCX file as a buffer.
 */
module.exports.generateDocx = async function(data, bucket, templatePath) {
    const docxTemplateBuffer = await bucket.file(templatePath).download();
    const zip = new PizZip(docxTemplateBuffer[0]);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        modules: [{
            name: "ImageModule",
            options: {
                centered: false,
                getImage: (tag) => Buffer.from(tag, 'base64'),
                getSize: () => [450, 300],
            }
        }]
    });
    
    doc.setData(data);
    doc.render();
    
    return doc.getZip().generate({ type: "nodebuffer" });
};