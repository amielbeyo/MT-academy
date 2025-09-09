# Step-by-Step Setup (No Coding Required)

Follow these instructions to run the subscription demo without exposing your API keys.

## 1. Install Requirements
- [Install Node.js](https://nodejs.org/) version 18 or newer.
- Create accounts and obtain keys for:
  - **OpenAI** – gives you an API key.
  - **Stripe** – you'll need a secret key and webhook signing secret.

## 2. Download the Project
- Download or clone this repository and open a terminal in the project folder.

## 3. Add Your Secret Keys
1. Go into the backend folder:
   ```bash
   cd backend
   ```
2. Copy the sample environment file for Stripe values:
   ```bash
   cp .env.example .env
   ```
3. Edit `apikeys.js` with your OpenAI key (it stays on the server):
   ```bash
   # inside backend/
   nano apikeys.js
   ```
4. Open the new `.env` file in a text editor and replace the placeholders:
   ```ini
   STRIPE_SECRET=PASTE_YOUR_STRIPE_SECRET_HERE
   STRIPE_ENDPOINT_SECRET=PASTE_ENDPOINT_SECRET_HERE
   ```
   > **Important:** Keep `apikeys.js` and `.env` private; never share or commit them.

## 4. Install and Test
- Install packages and run tests:
  ```bash
  npm install
  npm test
  ```

## 5. Start the Server
- Launch the backend:
  ```bash
  node server.js
  ```
  The server prints `Server running on 3000` when ready.

## 6. Use the Demo Page
- In your browser, open `subscription.html` from the project root.
- Sign up, log in, send prompts, and upgrade plans via Stripe.

Your API keys stay on the server; users never see them. When you want to deploy, set the same environment variables on your hosting provider.
