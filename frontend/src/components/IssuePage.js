import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { functions, storage, db } from '../firebase/firebase-config';
import { logErrorToFirestore } from '../firebase/logError';
import ErrorMessage from './common/ErrorMessage';
import Loader from './common/Loader';
import '../styles/IssuePage.css';

export default function IssuePage() {
    const { reportId } = useParams();
    const [issueCount, setIssueCount] = useState(1);
    const [photos, setPhotos] = useState([]);
    const [desc, setDesc] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Report state from Firestore
    const [reportStatus, setReportStatus] = useState('loading');
    const [downloadUrl, setDownloadUrl] = useState('');
    const [reportError, setReportError] = useState('');

    useEffect(() => {
        const reportRef = doc(db, "reports", reportId);
        const unsubscribe = onSnapshot(reportRef, (docSnap) => {
            const data = docSnap.data();
            setReportStatus(data?.status || 'unknown');
            setDownloadUrl(data?.finalDocxUrl || '');
            setReportError(data?.errorMessage || '');
        }, (err) => {
            logErrorToFirestore(err, { component: "IssuePage", action: "onSnapshot" });
            setError("Failed to subscribe to report updates.");
        });

        return () => unsubscribe();
    }, [reportId]);

    function handlePhotoChange(e) {
        if (!e.target.files) return;
        setPhotos(prev => [...prev, ...Array.from(e.target.files)]);
    }

    async function saveNext() {
        if (photos.length === 0) {
            setError('Please select at least one photo.');
            return;
        }
        setError(null);
        setIsSubmitting(true);

        try {
            const addIssue = httpsCallable(functions, 'addIssueToReport');
            const { data: { issueId } } = await addIssue({ reportId, description: desc });
            
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
        } catch (err) {
            logErrorToFirestore(err, { component: "IssuePage", action: "saveNext" });
            setError(`Error saving issue: ${err.message}`);
        } finally {
            setIsSubmitting(false);
        }
    }

    async function finishReport() {
        if (!window.confirm('Finish adding issues and generate final report?')) return;
        setError(null);
        
        try {
            const gen = httpsCallable(functions, 'generateDocxReport');
            await gen({ reportId });
        } catch (err) {
            logErrorToFirestore(err, { component: "IssuePage", action: "finishReport" });
            setError(`Error starting report generation: ${err.message}`);
        }
    }

    const renderStatusContent = () => {
        switch (reportStatus) {
            case 'finalizing':
                return <Loader />;
            case 'complete':
                return (
                    <button className="btn-download" onClick={() => window.open(downloadUrl, "_blank")}>
                        Download Report
                    </button>
                );
            case 'error':
                return (
                    <div className="error-box">
                        <p>An error occurred during report generation.</p>
                        {reportError && <p><strong>Details:</strong> {reportError}</p>}
                    </div>
                );
            default:
                 return (
                    <div className="button-group">
                        <button className="btn-save" onClick={saveNext} disabled={isSubmitting}>
                        Save & Add Next Issue
                        </button>
                        <button className="btn-finish" onClick={finishReport} disabled={isSubmitting}>
                        {isSubmitting ? 'Processing...' : 'Finish & Generate Report'}
                        </button>
                    </div>
                 );
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
                        disabled={isSubmitting || reportStatus === 'finalizing' || reportStatus === 'complete'}
                    />
                </div>
            </div>
            {photos.length > 0 && (
                <ul>
                {photos.map((f, i) => <li key={i}>{f.name}</li>)}
                </ul>
            )}
            <div className="divider" />

            <label htmlFor="desc">Issue Description:</label>
            <textarea
                id="desc"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Describe the issue"
                disabled={isSubmitting || reportStatus === 'finalizing' || reportStatus === 'complete'}
            />

            {error && <ErrorMessage message={error} />}

            {renderStatusContent()}

        </div>
    );
}