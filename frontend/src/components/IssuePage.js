import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, onSnapshot, collection } from 'firebase/firestore';
import { functions, storage, db, auth } from '../firebase/firebase-config';
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

    function handleRemovePhoto(indexToRemove) {
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
    }

    async function handleSaveCurrentIssue() {
        if (photos.length === 0 || !desc.trim()) {
            setError('Both a description and at least one photo are required to save an issue.');
            return false;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            const newIssueRef = doc(collection(db, 'issues'));
            const newIssueId = newIssueRef.id;
            const metadata = { customMetadata: { 'inspectorId': auth.currentUser.uid } };

            const urls = await Promise.all(
                photos.map(file =>
                    uploadBytes(ref(storage, `images/${reportId}/${newIssueId}/${file.name}`), file, metadata)
                    .then(r => getDownloadURL(r.ref))
                )
            );

            const addIssue = httpsCallable(functions, 'addIssueToReport');
            await addIssue({ reportId, description: desc, imagePaths: urls });
            return true;
        } catch (err) {
            logErrorToFirestore(err, { component: "IssuePage", action: "handleSaveCurrentIssue" });
            setError(`Error saving issue: ${err.message}`);
            return false;
        } finally {
            setIsSubmitting(false);
        }
    }

    async function saveNext() {
        const success = await handleSaveCurrentIssue();
        if (success) {
            setIssueCount(c => c + 1);
            setDesc('');
            setPhotos([]);
        }
    }

    async function finishReport() {
        setError(null);
        if (desc.trim() || photos.length > 0) {
            const confirmed = window.confirm('You have an unsaved issue. Do you want to save it before finishing the report?');
            if (confirmed) {
                const success = await handleSaveCurrentIssue();
                if (!success) {
                    setError("Could not save the final issue. Please fix the error and try again.");
                    return;
                }
            }
        }
        
        if (!window.confirm('Finish adding issues and generate final report?')) return;
        
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
                            {isSubmitting ? 'Processing...' : 'Save & Add Next Issue'}
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
                    {photos.map((f, i) => (
                        <li key={i}>
                            {f.name}
                            <button
                                type="button"
                                style={{ color: '#b32400', marginLeft: '10px' }}
                                onClick={() => handleRemovePhoto(i)}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
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