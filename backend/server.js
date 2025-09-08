require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const stripeSecret = process.env.STRIPE_SECRET;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;

// Load the OpenAI key from either an environment variable or `apikey.js`.
let OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  try {
    OPENAI_API_KEY = require('./apikey');
  } catch (_) {
    // `apikey.js` is optional; if missing, OPENAI_API_KEY stays undefined.
  }
}

const app = express();
app.use(express.json());

// In-memory store for demonstration purposes.
const users = new Map();

const FREE_MONTHLY_LIMIT = 5;
const BASIC_DAILY_LIMIT = 20;

// Reset daily and monthly counters.
setInterval(() => {
  users.forEach(u => { u.promptsUsedToday = 0; });
}, 24 * 60 * 60 * 1000).unref();

let currentMonth = new Date().getMonth();
setInterval(() => {
  const now = new Date();
  if (now.getMonth() !== currentMonth) {
    users.forEach(u => { u.promptsUsedMonth = 0; });
    currentMonth = now.getMonth();
  }
}, 24 * 60 * 60 * 1000).unref();

function checkAllowance(user) {
  if (user.plan === 'premium') return true;
  if (user.plan === 'basic') {
    return user.promptsUsedToday < BASIC_DAILY_LIMIT;
  }
  return user.promptsUsedMonth < FREE_MONTHLY_LIMIT;
}

app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const existing = Array.from(users.values()).find(u => u.email === email);
  if (existing) return res.status(400).json({ error: 'Email already registered.' });
  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  users.set(id, { id, email, passwordHash: hash, plan: 'free', promptsUsedToday: 0, promptsUsedMonth: 0 });
  res.json({ id });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = Array.from(users.values()).find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  res.json({ id: user.id, plan: user.plan });
});

app.post('/prompt', async (req, res) => {
  const { userId, prompt } = req.body;
  const user = users.get(userId);
  if (!user) return res.status(401).json({ error: 'Invalid user.' });
  if (!checkAllowance(user)) {
    return res.status(403).json({ error: 'Usage limit reached.' });
  }
  // Call the third‑party API using a server-side key so it is never exposed to the client.
  const apiKey = OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured.' });
  }
  let reply = `Processed prompt: ${prompt}`;
  if (process.env.NODE_ENV !== 'test') {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await response.json();
      if (data.choices) {
        reply = data.choices[0].message.content;
      }
    } catch (e) {
      // If the external API fails, fall back to the demo reply.
    }
  }
  user.promptsUsedToday += 1;
  user.promptsUsedMonth += 1;
  res.json({ reply });
});

app.post('/subscribe', async (req, res) => {
  const { userId, plan } = req.body; // plan = 'basic' or 'premium'
  const user = users.get(userId);
  if (!user) return res.status(401).json({ error: 'Invalid user.' });
  if (!['basic', 'premium'].includes(plan)) return res.status(400).json({ error: 'Invalid plan.' });
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  try {
    // Create a Stripe Checkout session.
    const priceId = plan === 'basic' ? process.env.STRIPE_BASIC_PRICE : process.env.STRIPE_PREMIUM_PRICE;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      client_reference_id: userId
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Stripe error', details: err.message });
  }
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = app;
