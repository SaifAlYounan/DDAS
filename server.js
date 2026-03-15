import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { analyzeContract } from './server/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// API key validation on startup
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('\n' + '='.repeat(60));
  console.warn('  WARNING: ANTHROPIC_API_KEY is not set!');
  console.warn('  AI contract analysis will not work.');
  console.warn('  Set it in your environment or .env file.');
  console.warn('  See .env.example for details.');
  console.warn('='.repeat(60) + '\n');
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Analyze endpoint — accepts conversation history + optional file
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  // Check API key at request time for clear error
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Anthropic API key not configured. Please set ANTHROPIC_API_KEY in your environment variables.'
    });
  }

  try {
    let messages, context;

    if (req.file) {
      // File upload — build a multimodal message
      const fileBuffer = req.file.buffer;
      const mimeType = req.file.mimetype;
      const base64 = fileBuffer.toString('base64');
      const userText = req.body.text || 'Analyze this document using the Governance Unit framework.';
      const existingHistory = req.body.history ? JSON.parse(req.body.history) : [];
      context = req.body.context ? JSON.parse(req.body.context) : {};

      const contentBlocks = [];
      if (mimeType === 'application/pdf') {
        contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: mimeType, data: base64 } });
      } else if (mimeType.startsWith('image/')) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
      }
      contentBlocks.push({ type: 'text', text: userText });

      messages = [...existingHistory, { role: 'user', content: contentBlocks }];
    } else {
      // JSON body with conversation history
      const body = req.body;
      messages = body.messages;
      context = body.context || {};
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided.' });
    }

    const result = await analyzeContract(messages, context);
    res.json(result);
  } catch (err) {
    console.error('Analysis error:', err);

    // Provide user-friendly error messages
    const message = err.message || 'Analysis failed';
    let userMessage = message;

    if (message.includes('authentication') || message.includes('api_key') || message.includes('401')) {
      userMessage = 'Invalid API key. Please check your ANTHROPIC_API_KEY.';
    } else if (message.includes('rate_limit') || message.includes('429')) {
      userMessage = 'Rate limit reached. Please wait a moment and try again.';
    } else if (message.includes('overloaded') || message.includes('529')) {
      userMessage = 'The AI service is temporarily overloaded. Please try again in a few seconds.';
    }

    res.status(500).json({ error: userMessage });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: !!process.env.ANTHROPIC_API_KEY });
});

async function start() {
  const distPath = path.join(__dirname, 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
    app.listen(PORT, '0.0.0.0', () => console.log(`GU Engine at http://localhost:${PORT}`));
  } else {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
    app.listen(PORT, '0.0.0.0', () => console.log(`GU Engine (dev) at http://localhost:${PORT}`));
  }
}

start();
