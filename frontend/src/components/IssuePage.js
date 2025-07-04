import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { functions, storage, db } from '../firebase/firebase-config';
import { logErrorToFirestore } from '../firebase/logError';
import ErrorMessage from './common/ErrorMessage';
import '../styles/IssuePage.css';

export default function IssuePage() {
  const { reportId } = useParams();
  const [issueCount, setIssueCount] = useState(1);
  const [photos, setPhotos] = useState([]);
  const [desc, setDesc] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    setFeedback(`Adding issues to Report ID: ${reportId}`);
  }, [reportId]);

  function handlePhotoChange(e) {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    setPhotos(prev => [
      ...prev,
      ...newFiles.filter(f => !prev.find(p => p.name === f.name))
    ]);
  }

  async function saveNext() {
    if (photos.length === 0) {
      setError('Please select at least one photo.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setFeedback('Saving issue…');
    try {
      const addIssue = httpsCallable(functions, 'addIssueToReport');
      const { data: { issueId } } = await addIssue({ reportId, description: desc });
      if (!issueId) throw new Error('No issueId returned.');

      setFeedback('Uploading photos…');
      const urls = await Promise.all(
        photos.map(file =>
          uploadBytes(ref(storage, `images/${reportId}/${issueId}/${file.name}`), file)
            .then(r => getDownloadURL(r.ref))
        )
      );

      await updateDoc(doc(db, 'issues', issueId), { imagePaths: urls });

      setIssueCount(c => c + 1);
      setDesc('');
      setPhotos([]);
      setFeedback('Issue saved! Ready for next.');
    } catch (err) {
      console.error(err);
      logErrorToFirestore(err, { component: "IssuePage", action: "saveNext" });
      setError(`Error saving issue: ${err.message}`);
    } finally {
        setIsSubmitting(false);
    }
  }

  async function finishReport() {
    if (!window.confirm('Finish adding issues and generate final report?')) return;
    setError(null);
    setIsSubmitting(true);
    setFeedback('Generating report… this may take a few minutes.');
    setDownloadUrl('');

    try {
      const gen = httpsCallable(functions, 'generateDocxReport');
      const { data: { fileUrl } } = await gen({ reportId });
      setDownloadUrl(fileUrl);
      setFeedback('Report ready. You can download it below.');
    } catch (err) {
      console.error(err);
      logErrorToFirestore(err, { component: "IssuePage", action: "finishReport" });
      setError(`Error generating report: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="container">
      <h1>Gardisen Workflow Automation</h1>
      <div className="divider" />
      <h2>Adding Issue to Report</h2>
      <h3>"{reportId}"</h3>
      <div className="divider2" />

      <span className="issue-number">Issue #: {issueCount}</span>
      <div className="divider" />

      <div className="issue-header">
        <div className="half">
          <label htmlFor="photos">Issue Photos:</label>
        </div>
        <div className="half">
          <input
            id="photos"
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoChange}
            disabled={isSubmitting}
          />
        </div>
      </div>
      {photos.length > 0 && (
        <ul>
          {photos.map(f => <li key={f.name}>{f.name}</li>)}
        </ul>
      )}
      <div className="divider" />

      <label htmlFor="desc">Issue Description:</label>
      <textarea
        id="desc"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Describe the issue"
        disabled={isSubmitting}
      />

      <div className="button-group">
        <button className="btn-save" onClick={saveNext} disabled={isSubmitting}>
          Save & Add Next Issue
        </button>
        <button className="btn-finish" onClick={finishReport} disabled={isSubmitting}>
          {isSubmitting ? 'Processing...' : 'Finish Report'}
        </button>
      </div>

      {isSubmitting && <p>{feedback}</p>}
      {error && <ErrorMessage message={error} />}

      {downloadUrl && (
        <button className="btn-download" onClick={() => window.open(downloadUrl)}>
          Download Report
        </button>
      )}
    </div>
  );
}