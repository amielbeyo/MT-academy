require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const stripeSecret = process.env.STRIPE_SECRET;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;
const nodemailer = require('nodemailer');

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

// In-memory store for demonstration purposes.
const users = new Map();

const FREE_MONTHLY_LIMIT = 5;

// Reset monthly usage counts at the start of each new month.
let currentMonth = new Date().getMonth();
setInterval(() => {
  const now = new Date();
  if (now.getMonth() !== currentMonth) {
    users.forEach(u => { u.promptsUsedMonth = 0; });
    currentMonth = now.getMonth();
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
  user.promptsUsedMonth += 1;
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
  res.json({ reply });
});

app.post('/subscribe', async (req, res) => {
  const { userId } = req.body;
  const user = users.get(userId);
  if (!user) return res.status(401).json({ error: 'Invalid user.' });
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  try {
    // Create a Stripe Checkout session for the $5 unlimited plan.
    const priceId = process.env.STRIPE_UNLIMITED_PRICE;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      client_reference_id: userId
    });
    if (mailer) {
      try {
        await mailer.sendMail({
          to: user.email,
          from: process.env.EMAIL_FROM || 'no-reply@example.com',
          subject: 'Subscription Confirmed',
          text: 'Thank you for subscribing to MT Academy!'
        });
      } catch (e) {
        console.error('Email error:', e);
      }
    }
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
