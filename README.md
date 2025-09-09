# MT Academy Subscription Setup

This project provides a minimal Express backend and demo frontend for a subscription-based prompt service.

## Prerequisites
- [Node.js](https://nodejs.org/) 18 or newer
- Stripe account with subscription products
- OpenAI API key

## Configuration
1. Copy the sample environment file and fill in your Stripe secrets:
   ```bash
   cd backend
   cp .env.example .env
   # edit .env to include real Stripe values
   ```
2. The OpenAI key is stored in `backend/apikeys.js`. Replace the placeholder with your real key; the server reads it so users never see the key.
3. The Gemini key is stored in `backend/geminikey.js`. Replace the placeholder with your real Gemini API key.
4. Set these variables inside `backend/.env`:
   - `STRIPE_SECRET` – secret key from your Stripe dashboard
   - `STRIPE_ENDPOINT_SECRET` – webhook signing secret for checkout events
   - `STRIPE_PRICE_ID` – price ID for the subscription product
   - `STRIPE_SUCCESS_URL` – URL users return to after successful checkout
   - `STRIPE_CANCEL_URL` – URL users return to if they cancel checkout
   - `EMAIL_HOST` – SMTP server host used to send confirmations
   - `EMAIL_PORT` – SMTP port (e.g., 587)
   - `EMAIL_USER` – SMTP username
   - `EMAIL_PASS` – SMTP password
   - `EMAIL_FROM` – sender address for confirmation emails

## Installation
Install dependencies and verify the tests:
```bash
cd backend
npm install
npm test
```

## Running the server
Start the backend on port 3000 (or any `PORT` value you set):
```bash
node server.js
```

## Using the API
1. **Create an account**
   ```bash
   curl -X POST http://localhost:3000/signup \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"secret"}'
   ```
   The server emails a Stripe payment link so new users can upgrade when ready.
2. **Login** to retrieve the user ID and plan:
   ```bash
   curl -X POST http://localhost:3000/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"secret"}'
   ```
3. **Send a prompt** (enforced by plan limits):
   ```bash
   curl -X POST http://localhost:3000/prompt \
     -H "Content-Type: application/json" \
     -d '{"userId":"<ID from login>","prompt":"hello"}'
   ```
4. **Send a Gemini prompt** (also limited for free plans):
   ```bash
   curl -X POST http://localhost:3000/gemini \
     -H "Content-Type: application/json" \
     -d '{"userId":"<ID from login>","prompt":"hello"}'
   ```
5. **Check current plan**:
   ```bash
   curl http://localhost:3000/plan/<ID from login>
   ```
6. **Upgrade plan** via Stripe Checkout:
   ```bash
   curl -X POST http://localhost:3000/subscribe \
     -H "Content-Type: application/json" \
     -d '{"userId":"<ID from login>"}'
   ```
   The response contains a `url` field with the hosted Stripe Checkout page.
7. **Confirm checkout** after Stripe redirects back with `session_id`:
   ```bash
   curl -X POST http://localhost:3000/confirm \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"<SESSION_ID_FROM_QUERY>"}'
   ```
   The server verifies payment and upgrades the user's plan.

The frontend demo page `subscription.html` interacts with the same endpoints and notes that free accounts get five prompts per month, while the paid plan is unlimited for $5 per month.

## Notes
- All API keys remain on the server; the frontend never sees them.
- For production, replace the in-memory user store with a database and secure the endpoints with proper authentication.
