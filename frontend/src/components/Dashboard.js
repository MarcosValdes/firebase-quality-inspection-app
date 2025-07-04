import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase-config';
import './Dashboard.css';

export default function Dashboard() {
  const [title, setTitle] = useState('');
  const [audioFiles, setAudioFiles] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const navigate = useNavigate();

  function handleFileChange(e) {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    setAudioFiles(prev => [
      ...prev,
      ...newFiles.filter(f => !prev.find(p => p.name === f.name))
    ]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title || audioFiles.length === 0) {
      setFeedback('Both title and at least one audio file are required.');
      return;
    }
    if (!auth.currentUser) {
      setFeedback('You must be logged in to create a report.');
      return;
    }
    setIsSubmitting(true);
    setFeedback('Step 1/3: Creating report entry…');
    try {
      const fn = getFunctions();
      const createReport = httpsCallable(fn, 'createReport');
      const { data: { reportId } } = await createReport({ title });
      if (!reportId) throw new Error('No reportId returned.');

      setFeedback(\`Step 2/3: Uploading \${audioFiles.length} file(s)…\`);
      const storage = getStorage();
      const urls = await Promise.all(
        audioFiles.map(file =>
          uploadBytes(ref(storage, \`audio/\${reportId}/\${file.name}\`), file)
            .then(r => getDownloadURL(r.ref))
        )
      );

      setFeedback('Step 3/3: Finalizing report…');
      const db = getFirestore();
      await updateDoc(doc(db, 'reports', reportId), { audioFilePaths: urls });

      setFeedback('Success! Redirecting…');
      navigate(\`/report/\${reportId}\`);
    } catch (err) {
      console.error(err);
      setFeedback(\`Error: \${err.message}\`);
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
          {audioFiles.length > 0 && (
            <ul>
              {audioFiles.map(f => <li key={f.name}>{f.name}</li>)}
            </ul>
          )}
        </div>

        <button type="submit" className="start" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Start Report'}
        </button>
      </form>

      {feedback && <p>{feedback}</p>}
    </div>
  );
}