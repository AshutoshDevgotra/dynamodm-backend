import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { authenticate, AuthRequest } from '../middleware/auth';
import { CreatorAccount } from '../models/CreatorAccount';
import { AppError } from '../middleware/errorHandler';
import { webhookQueue } from '../workers/queues';
import { logger } from '../utils/logger';

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

// ─── GET /api/meta/connect ────────────────────────────────────────────────────
router.get('/connect', authenticate, (req: AuthRequest, res: Response): void => {
  const scopes = [
    'instagram_basic',
    'instagram_manage_messages',
    'pages_show_list',
    'pages_manage_metadata',
    'business_management',
  ].join(',');

  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID as string,
    redirect_uri: process.env.META_REDIRECT_URI as string,
    scope: scopes,
    response_type: 'code',
    state: token, // Pass token in state
  });

  res.json({ success: true, data: { authUrl: `https://www.facebook.com/v20.0/dialog/oauth?${params}` } });
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

  const encryptedToken = encryptToken(pageWithIG.access_token);
  const tokenExpiry = new Date(Date.now() + (expires_in || 60 * 60 * 24 * 60) * 1000);

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
      scopes: ['instagram_basic', 'instagram_manage_messages', 'pages_show_list', 'pages_manage_metadata', 'business_management'],
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

// ─── GET /api/meta/webhook (verification) ────────────────────────────────────
router.get('/webhook', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_SECRET) {
    logger.info('✅ Meta webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ success: false, message: 'Webhook verification failed.' });
  }
});

// ─── POST /api/meta/webhook (event receiver) ─────────────────────────────────
router.post('/webhook', (req: Request, res: Response): void => {
  // Verify HMAC signature
  const signature = req.headers['x-hub-signature-256'] as string;
  if (!signature) {
    res.status(401).json({ success: false, message: 'Missing signature.' });
    return;
  }

  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  const expectedSig = `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET as string)
    .update(rawBody)
    .digest('hex')}`;

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    logger.warn('⚠️ Invalid webhook signature received');
    logger.debug(`Signature: ${signature}`);
    logger.debug(`Expected: ${expectedSig}`);
    res.status(401).json({ success: false, message: 'Invalid signature.' });
    return;
  }

  logger.debug('✅ Valid webhook payload received', { body: req.body });

  // Acknowledge immediately and process asynchronously
  res.status(200).send('EVENT_RECEIVED');

  const body = req.body as { object: string; entry: Array<{ id: string; changes?: unknown[]; messaging?: unknown[] }> };
  if (body.object === 'instagram' || body.object === 'page') {
    // Only queue if there are changes (comments) or messaging (DMs)
    const hasEvents = body.entry.some(e => (e.changes && e.changes.length > 0) || (e.messaging && e.messaging.length > 0));
    if (hasEvents) {
      webhookQueue.add('process-webhook', { payload: body }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
    }
  }
});

export { decryptToken };
export default router;
