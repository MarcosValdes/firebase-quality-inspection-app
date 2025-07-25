const { z } = require("zod");

// Defines the schema for a single photo object within a defect.
const photoSchema = z.object({
  pfad: z.string(),
});

// Defines the schema for a single defect ("Mangel") object.
const maengelSchema = z.object({
  id: z.string(),
  typ: z.string(),
  details: z.string(),
  schweregrad: z.string(),
  empfehlung: z.string(),
  fotos: z.array(photoSchema),
});

// Defines the main schema for the entire AI-generated report data.
// This now matches your Report-Template.json structure.
const reportSchema = z.object({
  auftraggeber: z.string(),
  auftragnehmer: z.string(),
  inspektionsdetails: z.object({
    inspektor_name: z.string(),
    inspektions_datum: z.string(),
    ort: z.string(),
    inspektions_typ: z.string(),
    bauteil_nr: z.string(),
    inspektions_umfang: z.string(),
    methode: z.string(),
    referenzdokumente: z.string(),
    lieferantendokumente: z.string(),
  }),
  allgemeine_kommentare: z.object({
    zusammenfassung_fokus: z.string(),
    schweissqualitaet: z.string(),
    unregelmaessigkeiten_gefunden: z.string(),
    masshaltigkeit: z.string(),
  }),
  gefaehrdungsniveau: z.object({
    ist_kritisch: z.boolean(),
    ist_schwerwiegend: z.boolean(),
  }),
  notwendige_aktivitaeten: z.object({
    reparaturanweisung_erforderlich: z.boolean(),
    massnahmenplan_erforderlich: z.boolean(),
    ncr_erforderlich: z.boolean(),
  }),
  freigabe: z.object({
    erstellt_durch_inspektor: z.string(),
    erstellungsdatum: z.string(),
    geprueft_durch: z.string(),
    pruefungsdatum: z.string(),
    uebergeben_an_ag_datum: z.string(),
  }),
  maengel: z.array(maengelSchema), // Renamed from "issues" to "maengel"
});

module.exports = { reportSchema };