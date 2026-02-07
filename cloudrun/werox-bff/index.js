/**
 * WeRox BFF — Express app setup, middleware, and route mounting.
 */

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { PORT, TCB_ENV_ID, TCB_API_KEY } = require('./lib/config');
const { jsonOk, jsonFail } = require('./lib/helpers');

// Routes
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const registrationRoutes = require('./routes/registration');
const albumRoutes = require('./routes/album');
const meRoutes = require('./routes/me');
const userRoutes = require('./routes/users');

const app = express();

// --- Middleware ---

// Request logging
app.use(morgan('combined'));

// CORS — allow CloudBase domains and future iOS client
app.use(cors({
  origin: true, // reflect request origin
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-wx-openid', 'x-wx-unionid', 'x-wx-appid', 'x-cloudbase-context'],
}));

// Body parsing
app.use(express.json({ limit: '512kb' }));

// --- Rate Limiters (write endpoints) ---
const registrationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' },
});

const albumUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: '上传过于频繁，请稍后再试' },
});

const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMIT', message: '更新过于频繁，请稍后再试' },
});

// --- Health check ---
app.get('/health', (req, res) => {
  jsonOk(res, {
    service: 'werox-bff',
    env: TCB_ENV_ID || '',
    has_api_key: !!TCB_API_KEY,
    ts: Date.now(),
  });
});

// --- Mount Routes ---

// Auth (no rate limit — identity resolution)
app.use(authRoutes);

// Events (public, read-only — no rate limit needed)
app.use(eventRoutes);

// Registration (rate-limited write)
app.post('/v1/events/:id/registrations', registrationLimiter);
app.use(registrationRoutes);

// Album (rate-limited upload)
app.post('/v1/events/:id/album/photos', albumUploadLimiter);
app.use(albumRoutes);

// Me (rate-limited profile update)
app.patch('/v1/me/profile', profileUpdateLimiter);
app.use(meRoutes);

// Users (admin operations)
app.use(userRoutes);

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error('[werox-bff] Unhandled error:', err);
  jsonFail(res, 500, 'INTERNAL_ERROR', '服务内部错误', {
    detail: err && err.message ? err.message : 'unknown_error',
  });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`[werox-bff] listening on ${PORT}`);
});
