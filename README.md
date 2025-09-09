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
3. Set these variables inside `backend/.env`:
   - `STRIPE_SECRET` – secret key from your Stripe dashboard
   - `STRIPE_UNLIMITED_PRICE` – price ID for the $5/month unlimited plan

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
4. **Upgrade plan** via Stripe Checkout:
   ```bash
   curl -X POST http://localhost:3000/subscribe \
     -H "Content-Type: application/json" \
     -d '{"userId":"<ID from login>"}'
   ```
   The response includes a Checkout `url` for the user to complete payment.

The site now uses a Stripe payment link for subscriptions; visiting `subscription.html` redirects directly to the secure checkout for the $5/month unlimited plan.

## Notes
- All API keys remain on the server; the frontend never sees them.
- For production, replace the in-memory user store with a database and secure the endpoints with proper authentication.
