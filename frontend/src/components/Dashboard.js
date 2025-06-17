import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';

const Dashboard = () => {
  const [title, setTitle] = useState('');
  const [audioFile, setAudioFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAudioFile(file);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    // 1. Validation happens first, before the try block.
    if (!title || !audioFile) {
      alert("Please provide both a title and an audio file.");
      return;
    }

    setIsSubmitting(true);
    setFeedback('Step 1/3: Creating report entry...');

    try {
      // The TRY block contains ONLY the code for the success path.
      const functions = getFunctions();
      const createReport = httpsCallable(functions, 'createReport');
      const result = await createReport({ title });
      const { reportId } = result.data;

      if (!reportId) {
        throw new Error("Failed to get a report ID from the server.");
      }

      setFeedback('Step 2/3: Uploading audio file...');
      const storage = getStorage();
      const storagePath = `audio/${reportId}/${audioFile.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadResult = await uploadBytes(storageRef, audioFile);
      const downloadURL = await getDownloadURL(uploadResult.ref);

      setFeedback('Step 3/3: Finalizing report...');
      const db = getFirestore();
      const reportRef = doc(db, 'reports', reportId);
      await updateDoc(reportRef, {
        audioFilePath: downloadURL
      });

      setFeedback(`Success! Report created with ID: ${reportId}. You can now add issues.`);
      setTitle('');
      setAudioFile(null);
      document.getElementById('audio-file').value = '';

    } catch (error) {
      // The CATCH block contains ONLY the error handling logic.
      // The 'error' variable is only available here.
      console.error("Report creation failed:", error);
      setFeedback(`Error: ${error.message}`);

    } finally {
      // The FINALLY block contains cleanup code that runs in either case.
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <h2>Create a New Quality Report</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label htmlFor="report-title">Report Title:</label>
          <input
            type="text"
            id="report-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name"
            required
            disabled={isSubmitting}
          />
        </div>
        <div>
          <label htmlFor="audio-file">Audio File:</label>
          <input
            type="file"
            id="audio-file"
            accept=".mp3,.wav"
            onChange={handleFileChange}
            required
            disabled={isSubmitting}
          />
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create Report and Add Issues'}
        </button>
      </form>
      {feedback && <p>{feedback}</p>}
    </div>
  );
};

export default Dashboard;