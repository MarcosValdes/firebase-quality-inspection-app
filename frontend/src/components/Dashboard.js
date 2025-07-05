// Import necessary React hooks and components
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
// Import Firebase services and functions
import { auth, db, storage, functions } from '../firebase/firebase-config';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
// Import custom error logging and UI components
import { logErrorToFirestore } from '../firebase/logError';
import ErrorMessage from './common/ErrorMessage';
// Import component-specific styles
import '../styles/Dashboard.css';

/**
 * Dashboard component for creating new inspection reports.
 * Allows users to input a title and upload audio files for the report.
 */
export default function Dashboard() {
  // State for the report title
  const [title, setTitle] = useState('');
  // State for the list of audio files to be uploaded
  const [audioFiles, setAudioFiles] = useState([]);
  // State to track if the form is currently being submitted
  const [isSubmitting, setIsSubmitting] = useState(false);
  // State for storing any errors that occur during submission
  const [error, setError] = useState(null);
  // State for providing feedback to the user during the submission process
  const [feedback, setFeedback] = useState('');
  // Hook for programmatic navigation
  const navigate = useNavigate();

  /**
   * Handles changes to the file input.
   * Adds new files to the audioFiles state, preventing duplicates.
   * @param {React.ChangeEvent<HTMLInputElement>} e The file input change event.
   */
  function handleFileChange(e) {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    setAudioFiles(prev => [
      ...prev,
      ...newFiles.filter(f => !prev.find(p => p.name === f.name))
    ]);
  }

  /**
   * Removes a selected audio file from the list.
   * @param {File} fileToRemove The file to remove.
   */
  function handleRemoveAudioFile(fileToRemove) {
    setAudioFiles(prev => prev.filter(file => file.name !== fileToRemove.name));
  }

  /**
   * Handles the form submission for creating a new report.
   * It validates the form, creates a report entry in Firestore,
   * uploads the audio files to Storage, and updates the report with the file URLs.
   * @param {React.FormEvent<HTMLFormElement>} e The form submission event.
   */
  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    // Validate that a title and at least one audio file are provided
    if (!title || audioFiles.length === 0) {
      setError('Both title and at least one audio file are required.');
      return;
    }
    // Ensure the user is authenticated
    const user = auth.currentUser;
    if (!user) {
      setError('You must be logged in to create a report.');
      return;
    }
    setIsSubmitting(true);
    setFeedback('Step 1/3: Creating report entry…');
    try {
      // Call the 'createReport' Firebase Function to create a new report document
      const createReport = httpsCallable(functions, 'createReport');
      const { data: { reportId } } = await createReport({ title });
      if (!reportId) throw new Error('No reportId returned.');

      setFeedback(`Step 2/3: Uploading ${audioFiles.length} file(s)…`);
      
      // Define the metadata to be sent with the file
      const metadata = {
        customMetadata: {
          'inspectorId': user.uid
        }
      };

      // Upload each audio file to Firebase Storage with the new metadata
      const urls = await Promise.all(
        audioFiles.map(file =>
          uploadBytes(ref(storage, `audio/${reportId}/${file.name}`), file, metadata)
            .then(r => getDownloadURL(r.ref))
        )
      );

      setFeedback('Step 3/3: Finalizing report…');
      // Update the report document with the URLs of the uploaded audio files
      await updateDoc(doc(db, 'reports', reportId), { audioFilePaths: urls });

      setFeedback('Success! Redirecting…');
      // Navigate to the newly created report's page
      navigate(`/report/${reportId}`);
    } catch (err) {
      console.error(err);
      // Log any errors to Firestore for debugging
      logErrorToFirestore(err, { component: "Dashboard", action: "handleSubmit" });
      setError(`Error: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="container">
      <h1>Gardisen Workflow Automation</h1>
      <div className="divider" />
      <h2 className="dashboard">Dashboard</h2>
      <p className="lead">Welcome! Here you can create new inspection report.</p>
      <div className="divider" />

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="report-title">Create New Report</label>
          <input
            id="report-title"
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={isSubmitting}
            placeholder="Report title"
          />
        </div>

        <div className="form-group">
          <label htmlFor="audio-files">Voice Notes (audio)</label>
          <div className="file-input-wrapper">
            <input
              id="audio-files"
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileChange}
              disabled={isSubmitting}
            />
          </div>
          {/* Display the list of selected audio files */}
          {audioFiles.length > 0 && (
            <ul>
              {audioFiles.map(f => (
                <li key={f.name}>
                  {f.name}
                  <button
                    type="button"
                    style={{ color: '#b32400', marginLeft: '10px' }}
                    onClick={() => handleRemoveAudioFile(f)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="submit" className="start" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Start Report'}
        </button>
      </form>

      {/* Display feedback and error messages */}
      {isSubmitting && <p>{feedback}</p>}
      {error && <ErrorMessage message={error} />}
    </div>
  );
}
