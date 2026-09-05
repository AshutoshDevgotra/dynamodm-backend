import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';
import { AppError } from '../../middleware/errorHandler';
import { getRedis } from '../../config/redis';
import { logger } from '../../utils/logger';
import { processWebhookEvent } from '../../engine/ruleEngine';

const router = Router();
const INSTAGRAM_API = `https://graph.instagram.com/${process.env.META_API_VERSION || 'v23.0'}`;
const INSTAGRAM_OAUTH_URL = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID;
const INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI as string;

// ─── Encryption helpers ───────────────────────────────────────────────────────
const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex');

function encryptToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptToken(encrypted: string): string {
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}


// ─── GET /api/meta/posts ────────────────────────────────────────────────────────
router.get('/posts', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('+igAccessToken');
  if (!account || !account.igAccessToken || !account.igUserId) {
    throw new AppError('Instagram account not connected.', 400);
  }

  const token = decryptToken(account.igAccessToken);
  try {
    const igRes = await axios.get(`${INSTAGRAM_API}/${account.igUserId}/media`, {
      params: {
        fields: 'id,caption,media_url,media_type,thumbnail_url,permalink,timestamp',
        limit: 30,
        access_token: token,
      },
    });
    res.json({ success: true, data: { posts: igRes.data.data } });
  } catch (err: any) {
    logger.error('Failed to fetch Instagram posts', err?.response?.data || err);
    throw new AppError('Failed to fetch Instagram posts.', 500);
  }
});

// ─── Required scopes for full comment-to-DM automation ───────────────────────
const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
];

// ─── GET /api/meta/connect ────────────────────────────────────────────────────
router.get('/connect', authenticate, (req: AuthRequest, res: Response): void => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const params = new URLSearchParams({
    client_id: INSTAGRAM_APP_ID as string,
    redirect_uri: META_REDIRECT_URI,
    scope: REQUIRED_SCOPES.join(','),
    response_type: 'code',
    state: token,
  });

  res.json({ success: true, data: { authUrl: `${INSTAGRAM_OAUTH_URL}?${params}` } });
});

// ─── GET /api/meta/callback ───────────────────────────────────────────────────
router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code) {
    res.status(400).send('No authorization code received.');
    return;
  }

  let userId = '';
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(state, process.env.JWT_SECRET as string) as { id: string };
    userId = decoded.id;
  } catch (err) {
    res.status(401).send('Access denied. Invalid or missing session token in state.');
    return;
  }

  const tokenRes = await axios.post(
    INSTAGRAM_TOKEN_URL,
    new URLSearchParams({
      client_id: INSTAGRAM_APP_ID as string,
      client_secret: INSTAGRAM_APP_SECRET as string,
      grant_type: 'authorization_code',
      redirect_uri: META_REDIRECT_URI,
      code,
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  const { access_token: shortToken, user_id: igUserId } = tokenRes.data as { access_token: string; user_id: string };

  const longLivedRes = await axios.get(`${INSTAGRAM_API}/access_token`, {
    params: {
      grant_type: 'ig_exchange_token',
      client_secret: INSTAGRAM_APP_SECRET,
      access_token: shortToken,
    },
  });
  const { access_token: longToken, expires_in } = longLivedRes.data as { access_token: string; expires_in: number };

  const igRes = await axios.get(`${INSTAGRAM_API}/me`, {
    params: {
      fields: 'user_id,username,name,profile_picture_url,followers_count,biography',
      access_token: longToken,
    },
  });
  const igProfile = igRes.data as {
    user_id: string;
    username: string;
    name: string;
    profile_picture_url: string;
    followers_count: number;
    biography?: string;
  };

  const igTokenExpiresAt = new Date(Date.now() + (expires_in || 60 * 60 * 24 * 60) * 1000);

  // Enforce one Instagram per account:
  // If this igUserId is already connected to a DIFFERENT user, disconnect it there.
  await CreatorAccount.updateMany(
    { igUserId, userId: { $ne: new mongoose.Types.ObjectId(userId) } },
    {
      $set: { isConnected: false, scopes: [] },
      $unset: {
        igUserId: '', igAccessToken: '', igTokenExpiresAt: '',
        igUsername: '', name: '', profilePic: '', followersCount: '',
      },
    }
  );
  logger.info(`✅ Cleared duplicate CreatorAccounts for IG ${igUserId} (kept userId ${userId})`);

  logger.info(`✅ OAuth complete for Instagram user ${igUserId}`);

  const updatePayload: any = {
    userId: userId,
    igUserId,
    igAccessToken: encryptToken(longToken),
    igTokenExpiresAt,
    igUsername: igProfile.username,
    name: igProfile.name,
    profilePic: igProfile.profile_picture_url,
    followersCount: igProfile.followers_count,
    isConnected: true,
    scopes: REQUIRED_SCOPES,
  };

  await CreatorAccount.findOneAndUpdate(
    { userId: userId },
    { $set: updatePayload },
    { upsert: true, new: true }
  );

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const html = `
    <html>
      <head><title>Connecting...</title></head>
      <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;">
        <div style="text-align:center">
          <div style="font-size:32px;margin-bottom:12px">&#x2705;</div>
          <p style="font-size:15px;color:#a78bfa">Instagram connected! Closing...</p>
        </div>
        <script>
          try {
            if (window.opener) {
              window.opener.postMessage({ type: 'META_AUTH_SUCCESS', username: '${igProfile.username}' }, '${frontendUrl}');
            }
          } catch(e) {}
          setTimeout(function() { window.close(); }, 800);
        </script>
      </body>
    </html>
  `;
  res.send(html);
});

// ─── GET /api/meta/status ─────────────────────────────────────────────────────
router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id }).select('-igAccessToken -igAccessToken');
  res.json({ success: true, data: { account } });
});

// ─── DELETE /api/meta/disconnect ─────────────────────────────────────────────
router.delete('/disconnect', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  // Wipe all Instagram-related fields so reconnecting starts completely fresh
  await CreatorAccount.findOneAndUpdate(
    { userId: req.user!.id },
    {
      $set: { isConnected: false, scopes: [] },
      $unset: {
        igUserId: '',
        igAccessToken: '',
        igTokenExpiresAt: '',
        igUsername: '',
        name: '',
        profilePic: '',
        followersCount: '',
        'profile.audienceDemographics': '',
      },
    }
  );
  res.json({ success: true, message: 'Instagram account disconnected.' });
});

// ─── GET /api/meta/check-token — Debug token scopes via Meta API ─────────────
router.get('/check-token', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('+igAccessToken');
  if (!account?.igAccessToken) {
    throw new AppError('No connected Instagram account found.', 400);
  }

  const token = decryptToken(account.igAccessToken);

  try {
    // Call Meta debug_token endpoint
    const debugRes = await axios.get('https://graph.facebook.com/debug_token', {
      params: {
        input_token: token,
        access_token: `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
      },
    });

    const debugData = debugRes.data?.data;
    const grantedScopes: string[] = debugData?.scopes || [];
    const missingScopes = REQUIRED_SCOPES.filter(s => !grantedScopes.includes(s));

    res.json({
      success: true,
      data: {
        isValid: debugData?.is_valid,
        appId: debugData?.app_id,
        type: debugData?.type,
        expiresAt: debugData?.expires_at ? new Date(debugData.expires_at * 1000).toISOString() : 'never',
        grantedScopes,
        missingScopes,
        needsReconnect: missingScopes.length > 0,
        storedScopes: account.scopes,
        igTokenExpiresAt: account.igTokenExpiresAt,
      },
    });
  } catch (err: any) {
    logger.error('Failed to debug token', err?.response?.data || err);
    throw new AppError('Failed to verify token with Meta.', 500);
  }
});

// ─── GET /api/meta/debug-webhook — Last 20 webhook payloads ──────────────────
router.get('/debug-webhook', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const redis = getRedis();
  const payloads = await redis.lrange('debug:webhook:payloads', 0, 19);
  res.json({
    success: true,
    data: {
      count: payloads.length,
      payloads: payloads.map(p => { try { return JSON.parse(p); } catch { return p; } }),
    },
  });
});

// ─── GET /api/meta/webhook (verification) ────────────────────────────────────
router.get('/webhook', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // META_VERIFY_TOKEN is the custom verify token set in Meta App Dashboard
  // Falls back to META_WEBHOOK_SECRET for backward compatibility
  const verifyToken = process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_SECRET || process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('✅ Meta webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn(`⚠️ Webhook verification failed — mode=${mode}, tokenMatch=${token === verifyToken}`);
    res.status(403).json({ success: false, message: 'Webhook verification failed.' });
  }
});

// ─── POST /api/meta/webhook (event receiver) ─────────────────────────────────
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const receivedAt = new Date().toISOString();
  logger.info(`📩 Webhook POST received at ${receivedAt}`, {
    headers: {
      'x-hub-signature-256': req.headers['x-hub-signature-256']?.toString().slice(0, 30),
      'content-type': req.headers['content-type'],
    },
    bodyObject: (req.body as any)?.object,
    entryCount: (req.body as any)?.entry?.length,
  });

  // ── Step 1: Verify HMAC signature ──────────────────────────────────────────
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    logger.warn('❌ Webhook rejected: missing x-hub-signature-256 header');
    res.status(401).json({ success: false, message: 'Missing signature.' });
    return;
  }

  // CRITICAL: Use raw body bytes, NOT reconstructed JSON
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    logger.error('❌ rawBody is undefined — express.json verify callback may have failed. Cannot validate signature.');
    res.status(500).json({ success: false, message: 'Internal webhook error: raw body missing.' });
    return;
  }

  const expectedSig = `sha256=${crypto
    .createHmac('sha256', (process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET) as string)
    .update(rawBody)
    .digest('hex')}`;

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSig);
  if (signatureBuffer.length !== expectedSignatureBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    logger.warn('⚠️ Invalid webhook signature', {
      receivedSig: signature.slice(0, 30),
      expectedSig: expectedSig.slice(0, 30),
      rawBodyLength: rawBody.length,
    });
    res.status(401).json({ success: false, message: 'Invalid signature.' });
    return;
  }

  // ── Step 2: Parse and log payload ──────────────────────────────────────────
  const body = req.body as { object: string; entry: Array<{ id: string; changes?: any[]; messaging?: any[] }> };
  logger.info('✅ Webhook signature verified', {
    object: body.object,
    entryCount: body.entry?.length,
    entryIds: body.entry?.map(e => e.id),
    changeFields: body.entry?.flatMap(e => e.changes?.map(c => c.field) || []),
    hasMessaging: body.entry?.some(e => e.messaging && e.messaging.length > 0),
  });

  // ── Step 3: Store payload in Redis for debugging ───────────────────────────
  try {
    const redis = getRedis();
    const debugPayload = JSON.stringify({ receivedAt, object: body.object, body });
    await redis.lpush('debug:webhook:payloads', debugPayload);
    await redis.ltrim('debug:webhook:payloads', 0, 49); // Keep last 50
  } catch (debugErr) {
    logger.warn('Failed to store debug webhook payload in Redis', debugErr);
  }

  // ── Step 4: Acknowledge immediately (Meta requires < 20s response) ────────
  res.status(200).send('EVENT_RECEIVED');

  // ── Step 5: Process Instagram events inline after acknowledgement ───────────
  if (body.object === 'instagram') {
    logger.info('🚀 Processing Instagram webhook inline');
    processWebhookEvent(body).catch((err: Error) => {
      logger.error('❌ Webhook processing error', { message: err.message, stack: err.stack });
    });
  } else {
    logger.info(`ℹ️ Ignoring webhook object type: ${body.object}`);
  }
});

export { decryptToken };
export default router;
