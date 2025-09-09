require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const stripeSecret = process.env.STRIPE_SECRET;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;
const nodemailer = require('nodemailer');

// Persist user data to disk so subscriptions survive restarts.
const USERS_FILE = path.join(__dirname, 'users.json');
const users = new Map();

function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    data.forEach(u => users.set(u.id, u));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('Failed to load users', e);
    }
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(Array.from(users.values())));
  } catch (e) {
    console.error('Failed to save users', e);
  }
}

loadUsers();

// Load the OpenAI key from `apikeys.js` so it stays on the server.
let OPENAI_API_KEY;
try {
  OPENAI_API_KEY = require('./apikeys');
} catch (_) {
  // `apikeys.js` is optional; if missing, OPENAI_API_KEY stays undefined.
}

// Load the Gemini key from `geminikey.js` so it stays on the server.
let GEMINI_API_KEY;
try {
  GEMINI_API_KEY = require('./geminikey');
} catch (_) {
  // `geminikey.js` is optional; if missing, GEMINI_API_KEY stays undefined.
}

const app = express();
app.use(cors());

// Stripe webhook must receive the raw body before JSON parsing
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !process.env.STRIPE_ENDPOINT_SECRET) {
    return res.status(400).end();
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_ENDPOINT_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const user = users.get(session.client_reference_id);
    if (user) {
      user.plan = 'unlimited';
      user.stripeSubscriptionId = session.subscription;
      saveUsers();
    }
  }
  res.json({ received: true });
});

app.use(express.json());

// Configure email transport if environment variables are provided.
let mailer = null;
if (process.env.EMAIL_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
} else if (process.env.NODE_ENV === 'test') {
  // Use a mock transport during tests to avoid real emails.
  mailer = nodemailer.createTransport({ jsonTransport: true });
}

const FREE_MONTHLY_LIMIT = 5;

// Reset monthly usage counts at the start of each new month.
let currentMonth = new Date().getMonth();
setInterval(() => {
  const now = new Date();
  if (now.getMonth() !== currentMonth) {
    users.forEach(u => { u.promptsUsedMonth = 0; });
    currentMonth = now.getMonth();
    saveUsers();
  }
}, 24 * 60 * 60 * 1000).unref();

function checkAllowance(user) {
  if (user.plan === 'unlimited') return true;
  return user.promptsUsedMonth < FREE_MONTHLY_LIMIT;
}

app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const existing = Array.from(users.values()).find(u => u.email === email);
  if (existing) return res.status(400).json({ error: 'Email already registered.' });
  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  users.set(id, { id, email, passwordHash: hash, plan: 'free', promptsUsedMonth: 0 });
  saveUsers();
  const paymentLink = `https://buy.stripe.com/fZu14n3Pzaoo85Q4vR2cg01?client_reference_id=${id}`;
  if (mailer) {
    try {
      await mailer.sendMail({
        to: email,
        from: process.env.EMAIL_FROM || 'no-reply@example.com',
        subject: 'Complete your MT Academy subscription',
        text: `Thanks for signing up! Upgrade to unlimited prompts for $5 by visiting: ${paymentLink}`
      });
    } catch (e) {
      console.error('Email error:', e);
    }
  }
  res.json({ id, paymentLink });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = Array.from(users.values()).find(u => u.email === email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });
  if (user.plan === 'unlimited' && stripe && user.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (sub.status !== 'active') {
        user.plan = 'free';
        saveUsers();
      }
    } catch (e) {
      console.error('Stripe verification failed:', e);
    }
  }
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
  user.promptsUsedMonth += 1;
  saveUsers();
  res.json({ reply });
});

app.post('/gemini', async (req, res) => {
  const { userId, prompt } = req.body;
  const user = users.get(userId);
  if (!user) return res.status(401).json({ error: 'Invalid user.' });
  if (!checkAllowance(user)) {
    return res.status(403).json({ error: 'Usage limit reached.' });
  }
  // Call the Gemini API using a server-side key.
  const apiKey = GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured.' });
  }
  let reply = `Processed prompt: ${prompt}`;
  if (process.env.NODE_ENV !== 'test') {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n').trim();
      if (text) {
        reply = text;
      }
    } catch (e) {
      // If the external API fails, fall back to the demo reply.
    }
  }
  user.promptsUsedMonth += 1;
  saveUsers();
  res.json({ reply });
});

app.post('/subscribe', (req, res) => {
  const { userId } = req.body;
  const user = users.get(userId);
  if (!user) return res.status(401).json({ error: 'Invalid user.' });
  const url = `https://buy.stripe.com/fZu14n3Pzaoo85Q4vR2cg01?client_reference_id=${userId}`;
  res.json({ url });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
}

module.exports = app;
