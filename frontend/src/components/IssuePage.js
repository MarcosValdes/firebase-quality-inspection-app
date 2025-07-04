import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import './IssuePage.css';

export default function IssuePage() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const [issueCount, setIssueCount] = useState(1);
  const [photos, setPhotos] = useState([]);
  const [desc, setDesc] = useState('');
  const [feedback, setFeedback] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    setFeedback(\`Adding issues to Report ID: \${reportId}\`);
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
      alert('Please select at least one photo.');
      return;
    }
    setFeedback('Saving issue…');
    try {
      const fn = getFunctions();
      const addIssue = httpsCallable(fn, 'addIssueToReport');
      const { data: { issueId } } = await addIssue({ reportId, description: desc });
      if (!issueId) throw new Error('No issueId returned.');

      setFeedback('Uploading photos…');
      const storage = getStorage();
      const urls = await Promise.all(
        photos.map(file =>
          uploadBytes(ref(storage, \`images/\${reportId}/\${issueId}/\${file.name}\`), file)
            .then(r => getDownloadURL(r.ref))
        )
      );

      const db = getFirestore();
      await updateDoc(doc(db, 'issues', issueId), { imagePaths: urls });

      setIssueCount(c => c + 1);
      setDesc('');
      setPhotos([]);
      setFeedback('Issue saved! Ready for next.');
    } catch (err) {
      console.error(err);
      setFeedback(\`Error: \${err.message}\`);
    }
  }

  async function finishReport() {
    if (!window.confirm('Finish adding issues and generate final report?')) return;
    setFeedback('Generating report… please wait.');
    try {
      const fn = getFunctions();
      const gen = httpsCallable(fn, 'generateDocxReport');
      const { data: { fileUrl } } = await gen({ reportId });
      setDownloadUrl(fileUrl);
      setFeedback('Report ready. You can download below.');
    } catch (err) {
      console.error(err);
      setFeedback(\`Error: \${err.message}\`);
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
      />

      <div className="button-group">
        <button className="btn-save" onClick={saveNext}>
          Save & Add Next Issue
        </button>
        <button className="btn-finish" onClick={finishReport}>
          Finish Report
        </button>
      </div>

      {downloadUrl && (
        <button className="btn-download" onClick={() => window.open(downloadUrl)}>
          Download Report
        </button>
      )}
      {feedback && <p>{feedback}</p>}
    </div>
  );
}