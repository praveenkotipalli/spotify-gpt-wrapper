import React, { useEffect, useState } from "react";
import axios from 'axios'; // <-- ADDED
import "./App.css";

const BACKEND_URI = "http://127.0.0.1:8000";

function App() {
  const [accessToken, setAccessToken] = useState(localStorage.getItem('spotify_token') || "");

  // --- ADDED - States for the app functionality ---
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successUrl, setSuccessUrl] = useState('');
  // ----------------------------------------------

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get("access_token");
      if (token) {
        localStorage.setItem('spotify_token', token); // <-- SAVE THE TOKEN
        setAccessToken(token);
        window.history.pushState("", document.title, window.location.pathname + window.location.search);
      }
    }
  }, []);

  // --- ADDED - The function to create the playlist ---
  const handleCreatePlaylist = async () => {
    if (!prompt) {
      setError('Please enter a prompt for your playlist.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessUrl('');

    try {
      const response = await axios.post(`${BACKEND_URI}/create-playlist`, {
        prompt: prompt,
        accessToken: accessToken 
      });

      setLoading(false);
      setSuccessUrl(response.data.playlistUrl);
      setPrompt(''); // Clear the input field

    } catch (err) {
      setLoading(false);
      const errorMessage = err.response ? err.response.data.error : 'Something went wrong.';
      
      if (err.response && err.response.status === 401) {
        setError('Your session expired. Please log in again.');
        setAccessToken(''); // Clear the bad token
      } else {
        setError(errorMessage);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('spotify_token'); // <-- REMOVE THE TOKEN
    setAccessToken('');
  };
  // ----------------------------------------------------

  return (
    <div className="app-container">
      {/* Top Logo Section */}
      <header className="header">
        <div className="header-left">
          <img
            src="https://www.freepnglogos.com/uploads/spotify-logo-png/spotify-download-logo-30.png"
            alt="Spotify Logo"
            className="spotify-logo"

          />
          <h1 className="app-title">AI Playlist Creator</h1>
        </div>
        
        {/* --- ADDED - Logout Button (only shows if logged in) --- */}
        {accessToken && (
          <button 
            className="logout-btn"
            onClick={handleLogout} // Simple logout
          >
            Log Out
          </button>
        )}
        {/* -------------------------------------------------------- */}
      </header>

      {/* Center Content */}
      <main className="content">
        {!accessToken ? (
          // --- NOT LOGGED IN VIEW ---
          <> {/* Fragment to hold both elements */}
            <img
              src="catgpt.jpg"
              alt="Music Visual"
              className="center-image"
            />
            <a className="login-btn" href={`${BACKEND_URI}/login`}>
              Login with Spotify
            </a>
          </>
        ) : (
          // --- LOGGED IN VIEW - REPLACED WITH FUNCTIONAL APP ---
          <div className="playlist-creator">
            <p>Welcome! Type a prompt for your playlist.</p>
            <p>(e.g., "A rainy day in a coffee shop")</p>
            
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter your prompt here..."
              rows={4}
            />
            
            <button 
              onClick={handleCreatePlaylist} 
              disabled={loading}
              className="create-btn" // New class
            >
              {loading ? 'Generating...' : 'Create Playlist'}
            </button>

            {/* Status Messages */}
            {error && (
              <div className="error-message">
                <strong>Error:</strong> {error}
              </div>
            )}
            
            {successUrl && (
              <div className="success-message">
                <p>Playlist created successfully!</p>
                <a 
                  href={successUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  Open your new playlist
                </a>
              </div>
            )}

<img
              src="/sponge-unscreen.gif"
              alt="Music Visual"
              className="bottom-gif" 
            />
          </div>
          // ------------------------------------------------------
        )}
      </main>
    </div>
  );
}

export default App;