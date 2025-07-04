// File: frontend/src/components/Dashboard.js

import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase-config'; // Import auth to get the current user

const Dashboard = () => {
  const [title, setTitle] = useState('');
  // ** CHANGE 1: State now holds an array of files, not a single file. **
  const [audioFiles, setAudioFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const navigate = useNavigate();
  
  // ** CHANGE 2: Handle multiple files from the input. **
  const handleFileChange = (e) => {
    if (e.target.files) {
      setAudioFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // ** CHANGE 3: Update validation for the array. **
    if (!title || audioFiles.length === 0) {
      setFeedback('Both title and at least one audio file are required.');
      return;
    }
    
    // Ensure user is logged in before proceeding.
    if (!auth.currentUser) {
        setFeedback('Error: You must be logged in to create a report.');
        return;
    }

    setIsSubmitting(true);
    setFeedback('Step 1/3: Creating report entry...');

    try {
      // Step 1: Call the Cloud Function to securely create the report document.
      // This part remains the same. The function handles adding the inspectorId.
      const functions = getFunctions();
      const createReport = httpsCallable(functions, 'createReport');
      const result = await createReport({ title });
      const { reportId } = result.data;

      if (!reportId) {
        throw new Error("Failed to get a report ID from the server.");
      }

      // ** CHANGE 4: Upload all audio files concurrently. **
      setFeedback(`Step 2/3: Uploading ${audioFiles.length} audio file(s)...`);
      const storage = getStorage();
      
      // Create an array of upload promises, one for each file.
      const uploadPromises = audioFiles.map(file => {
        const storagePath = `audio/${reportId}/${file.name}`;
        const storageRef = ref(storage, storagePath);
        return uploadBytes(storageRef, file).then(uploadResult => getDownloadURL(uploadResult.ref));
      });

      // Wait for all uploads to complete.
      const downloadURLs = await Promise.all(uploadPromises);

      // ** CHANGE 5: Update Firestore with the array of URLs. **
      setFeedback('Step 3/3: Finalizing report...');
      const db = getFirestore();
      const reportRef = doc(db, 'reports', reportId);
      // We now save to 'audioFilePaths' (plural) and pass the array of URLs.
      await updateDoc(reportRef, {
        audioFilePaths: downloadURLs 
      });

      setFeedback(`Success! Report created with ID: ${reportId}. You can now add issues.`);
      navigate(`/report/${reportId}`);

    } catch (error) {
      console.error("Report creation failed:", error);
      setFeedback(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <h2>Dashboard</h2>
      <p>Welcome! Here you can create new inspection reports.</p>
      
      <form onSubmit={handleSubmit}>
        <h3>Create New Report</h3>
        <div>
          <label htmlFor="report-title">Report Title:</label>
          <input
            id="report-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., 'Weekly Site Inspection'"
            required
            disabled={isSubmitting}
          />
        </div>
        <div>
          <label htmlFor="audio-file">Voice Notes (audio):</label>
          <input
            id="audio-file"
            type="file"
            accept="audio/*"
            multiple // ** CHANGE 6: Allow multiple file selection in the UI. **
            onChange={handleFileChange}
            required
            disabled={isSubmitting}
          />
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : 'Start Report'}
        </button>
      </form>
      
      {feedback && <p>{feedback}</p>}
    </div>
  );
};

export default Dashboard;