import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { functions, storage, db, auth } from '../firebase/firebase-config';
import { logErrorToFirestore } from '../firebase/logError';
import ErrorMessage from './common/ErrorMessage';
import Loader from './common/Loader';
import '../styles/IssuePage.css';

/**
 * IssuePage component allows users to add issues, including photos and descriptions,
 * to a specific report identified by the reportId from the URL.
 */
export default function IssuePage() {
    // Get the reportId from the URL parameters.
    const { reportId } = useParams();

    // State for the current issue being added.
    const [issueCount, setIssueCount] = useState(1);
    const [photos, setPhotos] = useState([]);
    const [desc, setDesc] = useState('');

    // State for handling UI feedback, like errors and loading states.
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // State for the overall report, synced with Firestore.
    const [reportStatus, setReportStatus] = useState('loading');
    const [downloadUrl, setDownloadUrl] = useState('');
    const [reportError, setReportError] = useState('');

    /**
     * useEffect hook to subscribe to real-time updates of the report document in Firestore.
     * This keeps the component's state in sync with the backend.
     */
    useEffect(() => {
        const reportRef = doc(db, "reports", reportId);
        // onSnapshot listens for real-time changes to the report document.
        const unsubscribe = onSnapshot(reportRef, (docSnap) => {
            const data = docSnap.data();
            setReportStatus(data?.status || 'unknown');
            setDownloadUrl(data?.finalDocxUrl || '');
            setReportError(data?.errorMessage || '');
        }, (err) => {
            // Log any errors during subscription and display a message to the user.
            logErrorToFirestore(err, { component: "IssuePage", action: "onSnapshot" });
            setError("Failed to subscribe to report updates.");
        });

        // Cleanup function to unsubscribe from the listener when the component unmounts.
        return () => unsubscribe();
    }, [reportId]);

    /**
     * Handles the file input change event to add selected photos to the state.
     * @param {React.ChangeEvent<HTMLInputElement>} e The event object.
     */
    function handlePhotoChange(e) {
        if (!e.target.files) return;
        setPhotos(prev => [...prev, ...Array.from(e.target.files)]);
    }

    /**
     * Removes a photo from the state by its index.
     * @param {number} indexToRemove The index of the photo to remove.
     */
    function handleRemovePhoto(indexToRemove) {
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
    }

    /**
     * Saves the current issue (photos and description) to Firestore and Cloud Storage.
     * This function is called when the "Save & Add Next Issue" button is clicked.
     */
    async function saveNext() {
        // Validate that photos and a description have been provided.
        if (photos.length === 0) {
            setError('Please select at least one photo.');
            return;
        }
        if (!desc.trim()) {
            setError('Please enter a description for the issue.');
            return;
        }

        setError(null);
        setIsSubmitting(true);

        try {
            // Call the 'addIssueToReport' cloud function to create an issue document.
            const addIssue = httpsCallable(functions, 'addIssueToReport');
            const { data: { issueId } } = await addIssue({ reportId, description: desc });
            
            // Prepare metadata for the photo upload, including the inspector's ID for security rules.
            const metadata = {
                customMetadata: {
                    'inspectorId': auth.currentUser.uid
                }
            }

            // Upload each photo to Cloud Storage and get its download URL.
            const urls = await Promise.all(
                photos.map(file =>
                    uploadBytes(ref(storage, `images/${reportId}/${issueId}/${file.name}`), file, metadata)
                    .then(r => getDownloadURL(r.ref))
                )
            );

            // Update the issue document in Firestore with the photo URLs.
            await updateDoc(doc(db, 'issues', issueId), { imagePaths: urls });

            // Reset the form for the next issue.
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

    /**
     * Finalizes the report by calling the 'generateDocxReport' cloud function.
     */
    async function finishReport() {
        if (!window.confirm('Finish adding issues and generate final report?')) return;
        setError(null);
        
        try {
            // Call the cloud function to start the report generation process.
            const gen = httpsCallable(functions, 'generateDocxReport');
            await gen({ reportId });
        } catch (err) {
            logErrorToFirestore(err, { component: "IssuePage", action: "finishReport" });
            setError(`Error starting report generation: ${err.message}`);
        }
    }

    /**
     * Renders different UI elements based on the current status of the report.
     * This provides feedback to the user during and after report generation.
     */
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
                 // Default view with buttons to save an issue or finish the report.
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

            {/* Photo upload section */}
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
            {/* Display list of selected photos */}
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

            {/* Issue description section */}
            <label htmlFor="desc">Issue Description:</label>
            <textarea
                id="desc"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="Describe the issue"
                disabled={isSubmitting || reportStatus === 'finalizing' || reportStatus === 'complete'}
            />

            {/* Display error messages if any */}
            {error && <ErrorMessage message={error} />}

            {/* Render status-specific content (e.g., loader, download button) */}
            {renderStatusContent()}

        </div>
    );
}
