// 1. IMPORT LIBRARIES
import express from 'express';
import { default as axios } from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import querystring from 'querystring';

// 2. INITIALIZE
dotenv.config(); // Load variables from .env file
const app = express();

// 3. SET UP MIDDLEWARE
app.use(express.json()); // To parse JSON bodies from your React app
app.use(cors({
  origin: 'https://spotify-gpt-wrapper.vercel.app/' // Allow your React frontend to make requests
}));
app.use(cookieParser()); // To parse cookies for the auth state

// 4. LOAD GLOBAL VARIABLES
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// const REDIRECT_URI = 'http://127.0.0.1:8000/callback';
const REDIRECT_URI = 'https://spotify-gpt-wrapper-zyw9.vercel.app/callback';
// const FRONTEND_URI = 'http://127.0.0.1:5173'; // Your React app's address
const FRONTEND_URI = 'https://spotify-gpt-wrapper.vercel.app';

const stateKey = 'spotify_auth_state';

// 5. ENDPOINT 1: /login (Starts the Spotify Auth)
app.get('/login', (req, res) => {
  // Generate a random string for the 'state' parameter (for security)
  const state = Math.random().toString(36).substring(2, 15);
  res.cookie(stateKey, state);

  // Define the 'scope' (what permissions we're asking for)
  const scope = [
    'user-read-private',
    'user-read-email',
    'playlist-modify-public',
    'playlist-modify-private'
  ].join(' ');

  // Build the query parameters for Spotify's auth page
  const queryParams = querystring.stringify({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: scope,
    show_dialog: 'true',
    redirect_uri: REDIRECT_URI,
    state: state
  });

  // Redirect the user to Spotify's login page
  res.redirect(`https://accounts.spotify.com/authorize?${queryParams}`);
});

// 6. ENDPOINT 2: /callback (Handles the redirect from Spotify)
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.cookies ? req.cookies[stateKey] : null;

  // Security check: Make sure the 'state' matches
  if (state === null || state !== storedState) {
    res.redirect(`${FRONTEND_URI}?error=state_mismatch`);
    return;
  }

  // Clear the state cookie
  res.clearCookie(stateKey);

  // Prepare the request to get the access token
  const authOptions = {
    method: 'post',
    url: 'https://accounts.spotify.com/api/token',
    data: querystring.stringify({
      code: code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    }),
    headers: {
      'Authorization': 'Basic ' + (Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    json: true
  };

  try {
    // Make the POST request to Spotify to get tokens
    const response = await axios(authOptions);
    const { access_token, refresh_token, expires_in } = response.data;

    // Redirect the user BACK to the React frontend
    // We pass the tokens in the URL hash (fragment) so they are
    // accessible to the React app's JavaScript but not sent to any server.
    res.redirect(`${FRONTEND_URI}/#${querystring.stringify({
      access_token: access_token,
      refresh_token: refresh_token,
      expires_in: expires_in
    })}`);

  } catch (error) {
    console.error("Error getting token:", error.response ? error.response.data : error.message);
    res.redirect(`${FRONTEND_URI}?error=invalid_token`);
  }
});

// 7. ENDPOINT 3: /create-playlist (The "Magic" Wrapper Endpoint)
app.post('/create-playlist', async (req, res) => {
  // Get the prompt and the token from the React app's request
  const { prompt, accessToken } = req.body;

  if (!prompt || !accessToken) {
    return res.status(400).json({ error: 'Prompt and access token are required.' });
  }

  try {
    // --- PART 1: Talk to Gemini AI ---
    console.log('Asking AI for search queries...');
    const aiPrompt = `You are a Spotify playlist assistant. A user wants a playlist for "${prompt}". Based on this, generate a list of 5 specific Spotify search queries. Return your answer ONLY as a valid JSON array of strings. Do not include any other text, just the JSON array.`;

    const geminiResponse = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${GEMINI_API_KEY}`,
      {
        "contents": [{ "parts": [{ "text": aiPrompt }] }]
      }
    );

    const responseText = geminiResponse.data.candidates[0].content.parts[0].text;
    let searchQueries;

    try {
      // The AI response might have ```json ... ``` tags, so let's clean it.
      const cleanedResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      searchQueries = JSON.parse(cleanedResponse);
      console.log('AI generated queries:', searchQueries);
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      return res.status(500).json({ error: 'AI did not return valid JSON.' });
    }

    // --- PART 2: Search Spotify for songs ---
    console.log('Searching Spotify for tracks...');
    const searchPromises = searchQueries.map(query =>
      axios.get('https://api.spotify.com/v1/search', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: {
          q: query,
          type: 'track',
          limit: 5 // Get 5 songs per search query
        }
      })
    );

    const searchResults = await Promise.all(searchPromises);

    // Collect all the track URIs (e.g., "spotify:track:123...")
    const trackUris = searchResults
      .flatMap(result => result.data.tracks.items) // Get all tracks from all results
      .map(track => track.uri); // Get just the URI

    if (trackUris.length === 0) {
      return res.status(404).json({ error: 'No songs found for that prompt.' });
    }

    // --- PART 3: Create the Playlist ---
    // --- PART 3: Create the Playlist ---
    console.log('Creating the playlist...');

    // --- NEW LOGS TO DEBUG ---
    console.log('Using Access Token:', accessToken.substring(0, 10) + '...');
    console.log('Attempting to get user ID...');
    // --- END NEW LOGS ---

    // First, get the user's ID
    const userResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    // --- NEW LOGS TO DEBUG ---
    // If the code reaches here, the /me call worked.
    console.log('Successfully got user ID:', userResponse.data.id);
    // --- END NEW LOGS ---

    const userId = userResponse.data.id;

    // Second, create the new (empty) playlist
    const createPlaylistResponse = await axios.post(
      `https://api.spotify.com/v1/users/${userId}/playlists`,
      {
        name: `AI Playlist: ${prompt}`,
        description: `Generated by AI for the prompt: "${prompt}"`,
        public: false
      },
      {
        headers: { 
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        }
      }
    );

    const newPlaylist = createPlaylistResponse.data;
    console.log('Created playlist:', newPlaylist.name);

    // --- PART 4: Add songs to the playlist ---
    // --- PART 4: Add songs to the playlist ---
    console.log('Adding tracks to the playlist...');
    await axios.post(
      `https://api.spotify.com/v1/playlists/${newPlaylist.id}/tracks`,
      {
        uris: trackUris
      },
      {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json' // <--- THE FIX
        }
      }
    );

    // --- PART 5: Send success response to React ---
    res.json({
      message: 'Playlist created successfully!',
      playlistUrl: newPlaylist.external_urls.spotify // Send the URL back to the frontend
    });

  } catch (error) {
    console.error('An error occurred:', error.response ? error.response.data : error.message);
    // Handle expired token error
    if (error.response && error.response.status === 401) {
      return res.status(401).json({ error: 'Spotify token expired.' });
    }
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// 8. START THE SERVER
const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Backend server listening on http://127.0.0.1:${PORT}`);
});
