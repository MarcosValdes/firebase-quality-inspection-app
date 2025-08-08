const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const ImageModule = require('docxtemplater-image-module-free');
const { inspect } = require('util');
const https = require("https");
const path = require("path");

/**
 * Generates a DOCX file from a template and data. This module is responsible
 * for downloading and buffering any images required by the template.
 * @param {object} data The data to populate the template with. It expects `data.maengel[].fotos` to be an array of URL strings.
 * @param {object} bucket The Cloud Storage bucket object.
 * @param {string} templatePath The path to the DOCX template in Cloud Storage.
 * @returns {Promise<Buffer>} A promise that resolves with the generated DOCX file as a buffer.
 */
module.exports.generateDocx = async function(data, bucket, templatePath) {
    const reportId = data.reportId || 'N/A';
    console.log(`[${reportId}] -- DOCX_GENERATION_START`);
    
    console.log(`[${reportId}] Action: Downloading DOCX template from ${templatePath}.`);
    const docxTemplateBuffer = await bucket.file(templatePath).download();
    
    console.log(`[${reportId}] Action: Template downloaded. Initializing PizZip.`);
    const zip = new PizZip(docxTemplateBuffer[0]);

    // --- Augment data by converting image URLs to the required buffer format ---
    console.log(`[${reportId}] Action: Augmenting data with image buffers as required by the template.`);
    await Promise.all((data.maengel || []).map(async (mangel) => {
        const imageUrls = mangel.fotos || []; // Expects 'fotos' to be an array of URL strings
        if (imageUrls.length > 0) {
            console.log(`[${reportId}] Action: Processing ${imageUrls.length} image(s) for defect ID ${mangel.id}.`);
            
            // Replace the array of URLs with an array of { data, extension } objects
            mangel.fotos = await Promise.all(imageUrls.map(imageUrl =>
                new Promise((resolve, reject) => {
                    https.get(imageUrl, res => {
                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => {
                            const fileBuffer = Buffer.concat(chunks);
                            const urlPath = new URL(imageUrl).pathname;
                            const filename = path.basename(urlPath);
                            const extension = path.extname(filename).slice(1).split('?')[0] || 'png';
                            console.log(`[${reportId}]   - Buffered image ${filename} (${fileBuffer.length} bytes)`);
                            // Resolve with the structure required by the template
                            resolve({ data: fileBuffer, extension: extension });
                        });
                        res.on('error', reject);
                    }).on('error', reject);
                })
            ));
            console.log(`[${reportId}] Action: Finished processing images for defect ID ${mangel.id}.`);
        }
    }));
    console.log(`[${reportId}] Action: Image data augmentation and buffering complete.`);

    // --- Parser Inspection Logic ---
    console.log(`[${reportId}] --- PARSER_INSPECTION_START ---`);
    try {
        const inspector = new Docxtemplater(zip, { modules: [] });
        console.log(`[${reportId}] Inspector: Tags identified by the parser:`, inspect(inspector.getTags(), { depth: null }));
    } catch(e) {
        console.error(`[${reportId}] ERROR during parser inspection:`, e);
    }
    console.log(`[${reportId}] --- PARSER_INSPECTION_END ---`);

    // --- Render the Final Document ---
    console.log(`[${reportId}] Action: Configuring ImageModule for docxtemplater.`);
    const imageModule = new ImageModule({
        centered: false,
        // The `getImage` function now expects an object and should return the buffer from the `data` property.
        getImage: (tagValue) => tagValue.data, 
        getSize: () => [450, 300],
    });

    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        modules: [imageModule],
    });
    
    console.log(`[${reportId}] Action: Setting data for the template.`);
    doc.setData(data);

    try {
        doc.render();
        console.log(`[${reportId}] Action: Document rendered successfully.`);
    } catch (error) {
        console.error(`[${reportId}] A top-level error occurred during doc.render():`, error);
        if (error.properties && error.properties.errors) {
            error.properties.errors.forEach(err => console.error("Docxtemplater Error Detail:", inspect(err, { depth: null })));
        }
        throw error;
    }
    
    const outputBuffer = doc.getZip().generate({ type: "nodebuffer" });
    console.log(`[${reportId}] Action: Final DOCX buffer generated. Size: ${outputBuffer.length} bytes.`);
    
    console.log(`[${reportId}] -- DOCX_GENERATION_END`);
    return outputBuffer;
};