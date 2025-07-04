const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");

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
