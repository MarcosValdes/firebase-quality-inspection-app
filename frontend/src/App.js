// File: frontend/src/App.js

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from './firebase/firebase-config';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import './App.css';
import IssuePage from './components/IssuePage';
import Loader from './components/common/Loader';
import ErrorMessage from './components/common/ErrorMessage';
import { logErrorToFirestore } from './firebase/logError';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    }, (err) => {
      logErrorToFirestore(err, { component: "App", action: "onAuthStateChanged" });
      setError("Failed to check authentication status. Please try refreshing the page.");
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
        await signOut(auth);
    } catch (err) {
        logErrorToFirestore(err, { component: "App", action: "handleLogout" });
        setError("Failed to logout. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="App-container">
        <Loader />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="App-container">
        <header className="App-header">
          <h1>Gardisen Workflow Automation</h1>
          {user && <button onClick={handleLogout} className="btn-logout">Logout</button>}
        </header>
        <main>
            {error && <ErrorMessage message={error} />}
            <Routes>
                <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" />} />
                <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" />} />
                <Route path="/report/:reportId" element={user ? <IssuePage /> : <Navigate to="/login" />} />
            </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;