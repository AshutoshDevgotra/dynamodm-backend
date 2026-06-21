import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { authenticate, AuthRequest } from '../middleware/auth';
import { CreatorAccount } from '../models/CreatorAccount';
import { AppError } from '../middleware/errorHandler';
import { webhookQueue } from '../workers/queues';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';
import { processWebhookEvent } from '../engine/ruleEngine';

const router = Router();
const META_API = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v20.0'}`;

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

// ─── GET /api/meta/status ───────────────────────────────────────────────────────
router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id });
  res.json({ success: true, data: { account } });
});

// ─── GET /api/meta/posts ────────────────────────────────────────────────────────
router.get('/posts', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('+accessToken');
  if (!account || !account.accessToken || !account.instagramBusinessId) {
    throw new AppError('Instagram account not connected.', 400);
  }

  const token = decryptToken(account.accessToken);
  try {
    const igRes = await axios.get(`${META_API}/${account.instagramBusinessId}/media`, {
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
  'instagram_basic',
  'instagram_manage_comments',              // CRITICAL: enables comment webhook delivery
  'instagram_manage_messages',              // Required for sending DMs
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement',                  // Required for reading comment data
  'business_management',
];

// ─── GET /api/meta/connect ────────────────────────────────────────────────────
router.get('/connect', authenticate, (req: AuthRequest, res: Response): void => {
  const scopes = REQUIRED_SCOPES.join(',');

  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID as string,
    redirect_uri: process.env.META_REDIRECT_URI as string,
    scope: scopes,
    response_type: 'code',
    auth_type: 'rerequest', // Forces Meta to ask for missing permissions
    state: token, // Pass token in state
  });

  const apiVersion = process.env.META_API_VERSION || 'v20.0';
  res.json({ success: true, data: { authUrl: `https://www.facebook.com/${apiVersion}/dialog/oauth?${params}` } });
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

  // Exchange code for access token
  const tokenRes = await axios.get(`${META_API}/oauth/access_token`, {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: process.env.META_REDIRECT_URI,
      code,
    },
  });

  const { access_token } = tokenRes.data as { access_token: string };

  // Exchange for long-lived token
  const longLivedRes = await axios.get(`${META_API}/oauth/access_token`, {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: access_token,
    },
  });

  const { access_token: longLivedToken, expires_in } = longLivedRes.data as { access_token: string; expires_in: number };

  // Get Facebook pages
  const pagesRes = await axios.get(`${META_API}/me/accounts`, {
    params: { access_token: longLivedToken, fields: 'id,name,access_token,instagram_business_account' },
  });

  const pages = (pagesRes.data as { data: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }> }).data;
  const pageWithIG = pages.find((p) => p.instagram_business_account);

  if (!pageWithIG) {
    throw new AppError('No Instagram Business Account found. Please connect one in Facebook Business Settings.', 400);
  }

  const igBusinessId = pageWithIG.instagram_business_account!.id;

  // Get Instagram profile info
  const igRes = await axios.get(`${META_API}/${igBusinessId}`, {
    params: { access_token: longLivedToken, fields: 'id,username,name,profile_picture_url,followers_count' },
  });

  const igProfile = igRes.data as { id: string; username: string; name: string; profile_picture_url: string; followers_count: number };

  // Fetch exactly which permissions the user granted
  const permsRes = await axios.get(`${META_API}/me/permissions`, {
    params: { access_token: longLivedToken },
  });
  
  const grantedScopes = (permsRes.data as { data: Array<{ permission: string; status: string }> }).data
    .filter(p => p.status === 'granted')
    .map(p => p.permission);

  const encryptedToken = encryptToken(pageWithIG.access_token);
  const tokenExpiry = new Date(Date.now() + (expires_in || 60 * 60 * 24 * 60) * 1000);

  // Subscribe the App to the Facebook Page to receive live webhooks for the linked Instagram account
  try {
    await axios.post(`${META_API}/${pageWithIG.id}/subscribed_apps`, null, {
      params: { 
        subscribed_fields: 'feed,messages',
        access_token: pageWithIG.access_token 
      }
    });
    logger.info(`✅ Successfully subscribed App to Facebook Page ${pageWithIG.id} for webhooks`);
  } catch (err: any) {
    logger.error('❌ Failed to subscribe App to Facebook Page for webhooks', err?.response?.data || err);
  }

  logger.info(`✅ OAuth complete for page ${pageWithIG.id} / IG ${igBusinessId}`);

  await CreatorAccount.findOneAndUpdate(
    { userId: userId },
    {
      userId: userId,
      instagramBusinessId: igBusinessId,
      pageId: pageWithIG.id,
      accessToken: encryptedToken,
      tokenExpiry,
      username: igProfile.username,
      name: igProfile.name,
      profilePic: igProfile.profile_picture_url,
      followersCount: igProfile.followers_count,
      isConnected: true,
      scopes: grantedScopes,
    },
    { upsert: true, new: true }
  );

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const html = `
    <html>
      <body>
        <script>
          window.opener.postMessage({ type: 'META_AUTH_SUCCESS', username: '${igProfile.username}' }, '${frontendUrl}');
          window.close();
        </script>
        <p>Authentication successful. You can close this window.</p>
      </body>
    </html>
  `;
  res.send(html);
});

// ─── GET /api/meta/status ─────────────────────────────────────────────────────
router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id }).select('-accessToken');
  res.json({ success: true, data: { account } });
});

// ─── DELETE /api/meta/disconnect ─────────────────────────────────────────────
router.delete('/disconnect', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  await CreatorAccount.findOneAndUpdate({ userId: req.user!.id }, { isConnected: false, accessToken: undefined });
  res.json({ success: true, message: 'Instagram account disconnected.' });
});

// ─── GET /api/meta/check-token — Debug token scopes via Meta API ─────────────
router.get('/check-token', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('+accessToken');
  if (!account?.accessToken) {
    throw new AppError('No connected Instagram account found.', 400);
  }

  const token = decryptToken(account.accessToken);

  try {
    // Call Meta debug_token endpoint
    const debugRes = await axios.get(`${META_API}/debug_token`, {
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
        tokenExpiry: account.tokenExpiry,
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
  const verifyToken = process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_SECRET;

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
    .createHmac('sha256', process.env.META_APP_SECRET as string)
    .update(rawBody)
    .digest('hex')}`;

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
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

  // ── Step 5: Queue for async processing ─────────────────────────────────────
  if (body.object === 'instagram' || body.object === 'page') {
    const hasChanges = body.entry?.some(e => e.changes && e.changes.length > 0);
    const hasMessaging = body.entry?.some(e => e.messaging && e.messaging.length > 0);

    if (hasChanges || hasMessaging) {
      if (process.env.NODE_ENV === 'development') {
        logger.info('🚀 Processing webhook synchronously in development to bypass shared queue');
        await processWebhookEvent(body);
      } else {
        logger.info('📤 Queueing webhook for async processing', {
          object: body.object,
          hasChanges,
          hasMessaging,
        });
        webhookQueue.add('process-webhook', { payload: body }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
      }
    } else {
      logger.info('ℹ️ Webhook has no changes or messaging to process — skipping queue');
    }
  } else {
    logger.info(`ℹ️ Ignoring webhook with object type: ${body.object} (expected 'instagram' or 'page')`);
  }
});

export { decryptToken };
export default router;
