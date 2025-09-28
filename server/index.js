const express = require('express');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

let fileKeys = {};
try {
  const loaded = require('./private-keys');
  if (loaded && typeof loaded === 'object') {
    fileKeys = loaded;
  }
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') {
    console.warn('Could not load server/private-keys.js:', err.message);
  }
}

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || fileKeys.openai || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || fileKeys.gemini || '').trim();

app.use(express.json({ limit: '25mb' }));

const staticDir = path.join(__dirname, '..');
app.use(express.static(staticDir));

function handleAxiosError(err, res) {
  if (err.response) {
    const { status, data } = err.response;
    return res.status(status).json(data || { error: { message: 'Upstream request failed' } });
  }
  console.error(err);
  return res.status(500).json({ error: { message: err.message || 'Proxy request failed' } });
}

app.get('/api/status', (req, res) => {
  res.json({ openai: Boolean(OPENAI_API_KEY), gemini: Boolean(GEMINI_API_KEY) });
});

app.post('/api/openai/chat', async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: 'OpenAI key not configured on server.' } });
  }
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', req.body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    });
    res.json(response.data);
  } catch (err) {
    handleAxiosError(err, res);
  }
});

app.post('/api/openai/transcriptions', upload.single('file'), async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: { message: 'OpenAI key not configured on server.' } });
  }
  if (!req.file) {
    return res.status(400).json({ error: { message: 'Missing audio file.' } });
  }
  try {
    const form = new FormData();
    const filename = req.file.originalname || 'audio.webm';
    form.append('file', req.file.buffer, { filename });
    Object.entries(req.body || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => form.append(key, v));
      } else {
        form.append(key, value);
      }
    });
    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    });
    res.json(response.data);
  } catch (err) {
    handleAxiosError(err, res);
  }
});

app.post('/api/gemini/movement', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: 'Gemini key not configured on server.' } });
  }
  const { model, prompt, transcript, video } = req.body || {};
  if (!video?.data || !video?.mimeType || !prompt || !transcript) {
    return res.status(400).json({ error: { message: 'Missing movement analysis payload.' } });
  }
  const targetModel = model || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: video.mimeType, data: video.data } },
          { text: `Transcript:\n${transcript}` },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: 512 },
  };
  try {
    const response = await axios.post(url, payload);
    res.json(response.data);
  } catch (err) {
    handleAxiosError(err, res);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MT academy server running on port ${PORT}`);
});
