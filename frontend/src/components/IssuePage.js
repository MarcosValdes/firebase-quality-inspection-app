// File: frontend/src/components/IssuePage.js

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';

const IssuePage = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setFeedback(`Adding issues to Report ID: ${reportId}`);
  }, [reportId]);

  const handlePhotoChange = (e) => {
    if (e.target.files) {
      setPhotos(Array.from(e.target.files));
    }
  };

  const handleSubmitIssue = async (e) => {
    e.preventDefault();
    if (photos.length === 0) {
      alert("Please select at least one photo for the issue.");
      return;
    }
    setIsSubmitting(true);
    setFeedback('Saving issue...');

    try {
      // Step 1: Call Cloud Function to create the issue document
      const functions = getFunctions();
      const addIssueToReport = httpsCallable(functions, 'addIssueToReport');
      const result = await addIssueToReport({ reportId, description });
      const { issueId } = result.data;

      if (!issueId) throw new Error("Failed to create issue entry.");

      // Step 2: Upload all photos to Cloud Storage concurrently
      setFeedback('Uploading photos...');
      const storage = getStorage();
      const uploadPromises = photos.map(photo => {
        const storagePath = `images/${reportId}/${issueId}/${photo.name}`;
        const storageRef = ref(storage, storagePath);
        return uploadBytes(storageRef, photo).then(uploadResult => getDownloadURL(uploadResult.ref));
      });

      const downloadURLs = await Promise.all(uploadPromises);

      // Step 3: Update the issue document with the array of photo URLs
      setFeedback('Finalizing issue...');
      const db = getFirestore();
      const issueRef = doc(db, 'issues', issueId);
      await updateDoc(issueRef, { imagePaths: downloadURLs });

      setFeedback(`Issue saved! Ready for the next one.`);
      // Clear form for the next issue entry
      setDescription('');
      setPhotos([]);
      document.getElementById('issue-photos').value = '';

    } catch (error) {
      console.error("Failed to save issue:", error);
      setFeedback(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleFinishReport = async () => {
    if (!window.confirm("Are you sure you are finished adding issues and want to generate the final report?")) {
      return;
    }
    
    setIsSubmitting(true);
    setFeedback("Finalizing report... This may take a few minutes. Please wait.");

    try {
      const functions = getFunctions();
      const generateDocxReport = httpsCallable(functions, 'generateDocxReport');
      const result = await generateDocxReport({ reportId });

      // The result will eventually contain the link to the generated .docx file
      setFeedback(`Report generated successfully! URL: ${result.data.fileUrl}`);
      alert(`Report generated! You can download it from: ${result.data.fileUrl}`);
      navigate('/');

    } catch(error) {
      console.error("Failed to generate report:", error);
      setFeedback(`Error generating report: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <h3>Adding Issue to Report: <code>{reportId}</code></h3>
      <form onSubmit={handleSubmitIssue}>
        <div>
          <label htmlFor="issue-description">Issue Description:</label>
          <textarea
            id="issue-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue..."
            rows="5"
            required
            disabled={isSubmitting}
          />
        </div>
        <div>
          <label htmlFor="issue-photos">Issue Photos:</label>
          <input
            id="issue-photos"
            type="file"
            multiple
            accept="image/*"
            onChange={handlePhotoChange}
            required
            disabled={isSubmitting}
          />
        </div>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save and Add Next Issue'}
        </button>
        <button type="button" onClick={handleFinishReport} disabled={isSubmitting}>
          Finish Report
        </button>
      </form>
      {feedback && <p>{feedback}</p>}
    </div>
  );
};

export default IssuePage;