const speech = require("@google-cloud/speech");
const path = require("path");
const os = require("os");
const { HttpsError } = require("firebase-functions/v2/https");

/**
 * Transcribes audio files from a report.
 * @param {object} reportData The data of the report.
 * @param {string} reportId The ID of the report.
 * @param {object} bucket The Cloud Storage bucket object.
 * @param {Array<string>} tempFilePaths An array to store temporary file paths for cleanup.
 * @returns {Promise<string>} A promise that resolves with the transcribed text.
 */
module.exports.transcribeAudio = async function(reportData, reportId, bucket, tempFilePaths) {
  let transcription = "[No audio file was provided for this report.]";

  if (reportData.audioFilePaths && Array.isArray(reportData.audioFilePaths) && reportData.audioFilePaths.length > 0) {
      const audioTempPath = path.join(os.tmpdir(), `audio_${reportId}`);
      tempFilePaths.push(audioTempPath);
      
      const audioUrl = reportData.audioFilePaths[0];
      const storageFilePath = decodeURIComponent(audioUrl.split('/o/')[1].split('?')[0]);
      await bucket.file(storageFilePath).download({ destination: audioTempPath });

      const musicMetadata = await import("music-metadata");
      const metadata = await musicMetadata.parseFile(audioTempPath);
      const config = {
          languageCode: "en-US",
          audioChannelCount: metadata.format.numberOfChannels,
          enableAutomaticPunctuation: true,
      };
      if (metadata.format.codec?.includes("PCM")) config.encoding = "LINEAR16";
      else if (metadata.format.codec?.includes("MPEG")) config.encoding = "MP3";
      else throw new HttpsError("invalid-argument", `Unsupported audio codec: ${metadata.format.codec}`);
      config.sampleRateHertz = metadata.format.sampleRate;
      
      const gcsUri = `gs://${bucket.name}/${storageFilePath}`;
      
      const speechClient = new speech.SpeechClient();
      if (metadata.format.duration < 60) {
          const [response] = await speechClient.recognize({ audio: { uri: gcsUri }, config });
          transcription = response.results.map(r => r.alternatives[0]?.transcript || "").join(' ');
      } else {
          const [operation] = await speechClient.longRunningRecognize({ audio: { uri: gcsUri }, config });
          const [response] = await operation.promise();
          transcription = response.results.map(r => r.alternatives[0]?.transcript || "").join(' ');
      }
  }

  return transcription;
};