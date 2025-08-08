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
  console.log(`[${reportId}] -- TRANSCRIPTION_START`);
  let transcription = "[No audio file was provided for this report.]";

  // Check if there are any audio files to process
  if (reportData.audioFilePaths && Array.isArray(reportData.audioFilePaths) && reportData.audioFilePaths.length > 0) {
      const audioUrl = reportData.audioFilePaths[0];
      const storageFilePath = decodeURIComponent(audioUrl.split('/o/')[1].split('?')[0]);
      console.log(`[${reportId}] Action: Found audio file to transcribe. Path: ${storageFilePath}. Next: Download to temporary location.`);

      // Create a temporary local path to store the downloaded audio file
      const audioTempPath = path.join(os.tmpdir(), `audio_${reportId}`);
      tempFilePaths.push(audioTempPath); // Add to temp paths for later cleanup
      
      // Download the audio file from Cloud Storage
      await bucket.file(storageFilePath).download({ destination: audioTempPath });
      console.log(`[${reportId}] Action: Audio file downloaded successfully to ${audioTempPath}. Next: Parse audio metadata.`);
      
      // Dynamically import music-metadata to parse audio properties
      const musicMetadata = await import("music-metadata");
      const metadata = await musicMetadata.parseFile(audioTempPath);
      console.log(`[${reportId}] Action: Audio metadata parsed. Duration: ${metadata.format.duration}s, Codec: ${metadata.format.codec}, Sample Rate: ${metadata.format.sampleRate}. Next: Configure Speech-to-Text.`);

      // Configure the request for the Speech-to-Text API based on the audio metadata
      const config = {
          languageCode: "en-US",
          audioChannelCount: metadata.format.numberOfChannels,
          enableAutomaticPunctuation: true,
          sampleRateHertz: metadata.format.sampleRate
      };
      
      // Set the audio encoding based on the codec
      if (metadata.format.codec?.includes("PCM")) config.encoding = "LINEAR16";
      else if (metadata.format.codec?.includes("MPEG")) config.encoding = "MP3";
      else throw new HttpsError("invalid-argument", `Unsupported audio codec: ${metadata.format.codec}`);
      
      console.log(`[${reportId}] Data: Speech-to-Text config prepared: ${JSON.stringify(config)}. Next: Determine transcription method (short or long).`);

      const gcsUri = `gs://${bucket.name}/${storageFilePath}`;
      const speechClient = new speech.SpeechClient();

      // Use the appropriate transcription method based on audio duration
      if (metadata.format.duration < 60) {
          console.log(`[${reportId}] Action: Audio is short (<60s). Using standard 'recognize' method. URI: ${gcsUri}. Next: Await transcription response.`);
          const [response] = await speechClient.recognize({ audio: { uri: gcsUri }, config });
          transcription = response.results.map(r => r.alternatives[0]?.transcript || "").join(' ');
      } else {
          console.log(`[${reportId}] Action: Audio is long (>=60s). Using 'longRunningRecognize' method. URI: ${gcsUri}. Next: Await transcription operation.`);
          const [operation] = await speechClient.longRunningRecognize({ audio: { uri: gcsUri }, config });
          const [response] = await operation.promise();
          transcription = response.results.map(r => r.alternatives[0]?.transcript || "").join(' ');
      }
      console.log(`[${reportId}] Action: Transcription completed successfully. Length: ${transcription.length} characters. Next: Return transcription.`);
  } else {
      console.log(`[${reportId}] Action: No audio files found for this report. Using default placeholder text. Next: Return placeholder.`);
  }
  
  console.log(`[${reportId}] -- TRANSCRIPTION_END`);
  return transcription;
};