const speech = require("@google-cloud/speech");
const path = require("path");
const os = require("os");
const { parseFile } = require("music-metadata");
const { HttpsError } = require("firebase-functions/v2/https");

module.exports.transcribeAudio = async function(reportData, reportId, bucket, tempFilePaths) {
  let transcription = "[No audio file was provided for this report.]";

  if (reportData.audioFilePaths && Array.isArray(reportData.audioFilePaths) && reportData.audioFilePaths.length > 0) {
      const audioTempPath = path.join(os.tmpdir(), `audio_${reportId}`);
      tempFilePaths.push(audioTempPath); 
      
      // For simplicity, we process the first audio file. The logic can be expanded to loop over all.
      const audioUrl = reportData.audioFilePaths[0];
      const storageFilePath = decodeURIComponent(audioUrl.split('/o/')[1].split('?')[0]);
      await bucket.file(storageFilePath).download({ destination: audioTempPath });

      const metadata = await parseFile(audioTempPath);
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
          transcription = response.results.map(r => r.alternatives[0].transcript).join('
');
      } else {
          const [operation] = await speechClient.longRunningRecognize({ audio: { uri: gcsUri }, config });
          const [response] = await operation.promise();
          transcription = response.results.map(r => r.alternatives[0].transcript).join('
');
      }
      console.log("Transcription successful.");
  } else {
      console.log("No audio file paths found in report. Skipping transcription process.");
  }

  return transcription;
};
