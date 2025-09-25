# MT academy

Welcome! This project already knows how to talk to OpenAI and Gemini for you—all you need to do is paste your keys in one spot.

## 1. Paste your keys (one time)
1. Open `server/private-keys.js` in any text editor.
2. Replace the placeholder strings with your real OpenAI and Gemini keys. Keep the quotes around each key. If you are not using Gemini yet, leave that value as an empty string (`''`).
3. Save the file. The keys stay on the server side and are never sent to the browser.

## 2. Run the site locally
1. In a terminal inside this folder run:
   ```bash
   npm install
   ```
2. After the install finishes, start the server:
   ```bash
   npm start
   ```
3. Visit <http://localhost:3000> while the terminal stays open. The server will proxy all AI calls with the keys you saved.

## Optional: `.env` support
If you prefer environment variables, you can still create a `.env` file with `OPENAI_API_KEY=` and `GEMINI_API_KEY=` entries. The server will use `.env` values first and fall back to `server/private-keys.js` when they are missing.
