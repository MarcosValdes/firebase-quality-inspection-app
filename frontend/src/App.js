// File: frontend/src/App.js

import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from './firebase-config';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
  };

  if (loading) {
    return (
      <div className="App">
        <header className="App-header">
          <h1>Loading Application...</h1>
        </header>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="App">
        <header className="App-header">
          <h1>Gardisen Workflow Automation</h1>
          {user && <button onClick={handleLogout}>Logout</button>}
        </header>
        <main>
          <Routes>
            <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" />} />
            <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;