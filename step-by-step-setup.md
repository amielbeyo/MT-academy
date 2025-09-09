# Step-by-Step Setup (No Coding Required)

Follow these instructions to run the subscription demo without exposing your API keys.

## 1. Install Requirements
- [Install Node.js](https://nodejs.org/) version 18 or newer.
- Create accounts and obtain keys for:
  - **OpenAI** – gives you an API key.
  - **Stripe** – create two subscription products:
    - **$5/month Basic** – 20 prompts per day
    - **$10/month Premium** – unlimited prompts

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
3. Add your OpenAI key in **one line** by copying the example file:
   ```bash
   cp apikey.example.js apikey.js
   # edit apikey.js and replace the placeholder with your OpenAI key
   ```
4. Open the new `.env` file in a text editor and replace the placeholders:
   ```ini
   STRIPE_SECRET=PASTE_YOUR_STRIPE_SECRET_HERE
   STRIPE_BASIC_PRICE=PASTE_BASIC_PRICE_ID
   STRIPE_PREMIUM_PRICE=PASTE_PREMIUM_PRICE_ID
   ```
   > **Important:** Keep `apikey.js` and `.env` private; never share or commit them.

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
- Sign up with your email, log in, and send prompts. Free accounts can send **five prompts per month**.
- Upgrade to a paid plan via Stripe if you need more prompts:
  - Basic: $5/mo for 20 prompts per day
  - Premium: $10/mo for unlimited prompts

Your API keys stay on the server; users never see them. When you want to deploy, set the same environment variables on your hosting provider.
