// Import necessary React hooks and components from external libraries and local files.
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, onSnapshot, collection } from 'firebase/firestore';
// Import Firebase configuration and utility functions.
import { functions, storage, db, auth } from '../firebase/firebase-config';
import { logErrorToFirestore } from '../firebase/logError';
// Import custom UI components.
import ErrorMessage from './common/ErrorMessage';
import Loader from './common/Loader';
// Import component-specific styles.
import '../styles/IssuePage.css';

/**
 * IssuePage component allows users to add issues, including photos and descriptions, to a specific report.
 * It interacts with Firebase services for data storage, file uploads, and server-side processing.
 */
export default function IssuePage() {
    //- HOOKS
    // useParams hook to get the reportId from the URL.
    const { reportId } = useParams();
    // useState hooks to manage component state.
    const [issueCount, setIssueCount] = useState(1);
    const [photos, setPhotos] = useState([]);
    const [desc, setDesc] = useState('');
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [reportStatus, setReportStatus] = useState('loading');
    const [downloadUrl, setDownloadUrl] = useState('');
    const [reportError, setReportError] = useState('');

    //-LIFECYCLE
    /**
     * useEffect hook to subscribe to real-time updates of the report document in Firestore.
     * This keeps the component's state synchronized with the backend.
     */
    useEffect(() => {
        const reportRef = doc(db, "reports", reportId);
        // onSnapshot listens for real-time updates to the report document.
        const unsubscribe = onSnapshot(reportRef, (docSnap) => {
            const data = docSnap.data();
            // Update state based on the latest report data.
            setReportStatus(data?.status || 'unknown');
            setDownloadUrl(data?.finalDocxUrl || '');
            setReportError(data?.errorMessage || '');
        }, (err) => {
            // Log any errors during subscription and set an error message for the user.
            logErrorToFirestore(err, { component: "IssuePage", action: "onSnapshot" });
            setError("Failed to subscribe to report updates.");
        });
        // Cleanup function to unsubscribe from the listener when the component unmounts.
        return () => unsubscribe();
    }, [reportId]);

    //-FUNCTIONS
    /**
     * Handles the change event for the file input, adding selected photos to the state.
     * @param {React.ChangeEvent<HTMLInputElement>} e - The event object from the file input.
     */
    function handlePhotoChange(e) {
        if (!e.target.files) return;
        setPhotos(prev => [...prev, ...Array.from(e.target.files)]);
    }

    /**
     * Removes a photo from the photos array based on its index.
     * @param {number} indexToRemove - The index of the photo to be removed.
     */
    function handleRemovePhoto(indexToRemove) {
        setPhotos(prev => prev.filter((_, index) => index !== indexToRemove));
    }

    /**
     * Saves the current issue (photos and description) to Firestore and Firebase Storage.
     * @returns {Promise<boolean>} - A promise that resolves to true if the issue was saved successfully, false otherwise.
     */
    async function handleSaveCurrentIssue() {
        // Validate that both a description and at least one photo are provided.
        if (photos.length === 0 || !desc.trim()) {
            setError('Both a description and at least one photo are required to save an issue.');
            return false;
        }

        setError(null);
        setIsSubmitting(true);
        try {
            // Create a new issue document reference to get a unique ID.
            const newIssueRef = doc(collection(db, 'issues'));
            const newIssueId = newIssueRef.id;
            const metadata = { customMetadata: { 'inspectorId': auth.currentUser.uid } };

            // Upload photos to Firebase Storage and get their download URLs.
            const urls = await Promise.all(
                photos.map(file =>
                    uploadBytes(ref(storage, `images/${reportId}/${newIssueId}/${file.name}`), file, metadata)
                    .then(r => getDownloadURL(r.ref))
                )
            );

            // Call a Firebase Function to add the issue data to the report.
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

    /**
     * Saves the current issue and resets the form to allow adding the next issue.
     */
    async function saveNext() {
        const success = await handleSaveCurrentIssue();
        if (success) {
            // If the issue was saved successfully, reset the form fields.
            setIssueCount(c => c + 1);
            setDesc('');
            setPhotos([]);
        }
    }

    /**
     * Finishes the report generation process. It first checks for any unsaved issue data and prompts the user to save it.
     */
    async function finishReport() {
        setError(null);
        // Check for unsaved data and confirm with the user if they want to save it before finishing.
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
        
        // Confirm that the user wants to finish the report.
        if (!window.confirm('Finish adding issues and generate final report?')) return;
        
        try {
            // Call a Firebase Function to generate the final DOCX report.
            const gen = httpsCallable(functions, 'generateDocxReport');
await gen({ reportId });
} catch (err) {
logErrorToFirestore(err, { component: "IssuePage", action: "finishReport" });
setError(`Error starting report generation: ${err.message}`);
}
}
/**
 * Renders the content based on the current report status.
 * @returns {JSX.Element} - The JSX element to be rendered.
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
//-RENDER
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
