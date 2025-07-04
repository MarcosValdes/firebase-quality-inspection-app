import React, { useState } from 'react';
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from '../firebase/firebase-config';
import { logErrorToFirestore } from '../firebase/logError';
import ErrorMessage from './common/ErrorMessage';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      // User will be redirected by the App component's auth listener
    } catch (err) {
      console.error("Error logging in:", err);
      logErrorToFirestore(err, { component: "LoginPage", action: "handleLogin" });
      setError(err.message);
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <div>
      <h2>Login</h2>
      <form onSubmit={handleLogin}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          disabled={isSubmitting}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          disabled={isSubmitting}
        />
        <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Logging in..." : "Login"}
        </button>
      </form>
      {error && <ErrorMessage message={error} />}
    </div>
  );
};

export default LoginPage;