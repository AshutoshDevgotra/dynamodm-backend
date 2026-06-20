import 'express-async-errors';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { globalLimiter } from './middleware/rateLimiter';
import { errorHandler, notFound } from './middleware/errorHandler';

import authRoutes from './routes/auth';
import metaRoutes from './routes/meta';
import automationRoutes from './routes/automations';
import leadsRoutes from './routes/leads';
import analyticsRoutes from './routes/analytics';
import paymentsRoutes from './routes/payments';
import adminRoutes from './routes/admin';
import creatorsRoutes from './routes/creators';

const app = express();

// ─── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: true, // Allow all origins dynamically in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));

// ─── Parsing ───────────────────────────────────────────────────────────────────
app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ─── Logging ───────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/creators', creatorsRoutes);

// ─── Error Handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
