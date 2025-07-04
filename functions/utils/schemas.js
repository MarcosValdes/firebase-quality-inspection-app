const { z } = require("zod");

// Defines the schema for a single issue object.
const issueSchema = z.object({
    id: z.string().nonempty({ message: "Issue ID cannot be empty." }),
    title: z.string().nonempty({ message: "Issue title cannot be empty." }),
    summary: z.string().optional(),
    description: z.string().nonempty({ message: "Issue description cannot be empty." }),
    quality_code: z.string().optional(),
    image_filenames: z.array(z.string()).optional(),
});

// Defines the main schema for the AI-generated report data.
const reportSchema = z.object({
    report_title: z.string().nonempty({ message: "Report title cannot be empty." }),
    summary_of_findings: z.string().optional(),
    issues: z.array(issueSchema),
});

module.exports = { reportSchema };