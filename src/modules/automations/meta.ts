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
import {
  PAGE_PUBLIC_ABOUT_FIELDS,
  aggregatePageAbout,
  fetchPagesAbout,
  graphErrorMessage,
  normalizePageAbout,
  searchPublicPages,
  type PublicPageAbout,
} from './pagePublicMetadata';

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
  'instagram_manage_insights',              // Required for demographic data
  'pages_show_list',
  'pages_manage_metadata',
  'pages_read_engagement',                  // Required for reading comment data
  'business_management',
];
// Page Public Metadata Access is an App Review *feature* (not an OAuth scope).
// After approval it allows /pages/search + public About fields on Pages the user does not manage.

// ─── GET /api/meta/connect ────────────────────────────────────────────────────
router.get('/connect', authenticate, (req: AuthRequest, res: Response): void => {
  const scopes = REQUIRED_SCOPES.join(',');

  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID as string,
    redirect_uri: process.env.META_REDIRECT_URI as string,
    scope: scopes,
    response_type: 'code',
    auth_type: 'rerequest',   // Always re-show the permission dialog
    display: 'popup',         // Optimised popup layout from Meta
    state: token,
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

  // Fetch Audience Insights if permission was granted
  let audienceDemographics = undefined;
  if (grantedScopes.includes('instagram_manage_insights')) {
    try {
      const insightsRes = await axios.get(`${META_API}/${igBusinessId}/insights`, {
        params: {
          access_token: longLivedToken,
          metric: 'audience_gender_age,audience_city,audience_country',
          period: 'lifetime'
        }
      });
      
      const insightsData = insightsRes.data.data;
      const getMetric = (name: string) => insightsData.find((m: any) => m.name === name)?.values[0]?.value || {};
      
      const genderAgeMap = getMetric('audience_gender_age');
      const genderMap: Record<string, number> = { Female: 0, Male: 0, Unknown: 0 };
      const ageMap: Record<string, number> = {};
      let totalAudience = 0;

      Object.entries(genderAgeMap).forEach(([key, val]: [string, any]) => {
        const count = parseInt(val, 10);
        totalAudience += count;
        const [genderCode, ageRange] = key.split('.');
        if (genderCode === 'F') genderMap.Female += count;
        else if (genderCode === 'M') genderMap.Male += count;
        else genderMap.Unknown += count;
        ageMap[ageRange] = (ageMap[ageRange] || 0) + count;
      });

      const toPercentageList = (map: Record<string, number>, keyName: string) => 
        Object.entries(map)
          .map(([k, v]) => ({ [keyName]: k, percentage: totalAudience > 0 ? Math.round((v / totalAudience) * 100) : 0 }))
          .sort((a, b) => b.percentage - a.percentage);

      const topAgeRanges = toPercentageList(ageMap, 'age') as any[];
      const topGenders = toPercentageList(genderMap, 'gender') as any[];
      
      const cityMap = getMetric('audience_city');
      const topCities = toPercentageList(cityMap, 'city').slice(0, 5) as any[];

      const countryMap = getMetric('audience_country');
      const topCountries = toPercentageList(countryMap, 'country').slice(0, 5) as any[];

      audienceDemographics = { topAgeRanges, topGenders, topCities, topCountries };
      logger.info(`✅ Fetched audience demographics for IG ${igBusinessId}`);
    } catch (err: any) {
      logger.error('❌ Failed to fetch Instagram insights', err?.response?.data || err.message);
    }
  }

  const encryptedToken = encryptToken(pageWithIG.access_token);
  const tokenExpiry = new Date(Date.now() + (expires_in || 60 * 60 * 24 * 60) * 1000);
  const facebookPages = pages.map((p) => ({ id: p.id, name: p.name }));

  // Enforce one Instagram per account:
  // If this instagramBusinessId is already connected to a DIFFERENT user, disconnect it there.
  await CreatorAccount.updateMany(
    { instagramBusinessId: igBusinessId, userId: { $ne: new mongoose.Types.ObjectId(userId) } },
    {
      $set: { isConnected: false, scopes: [] },
      $unset: {
        instagramBusinessId: '', pageId: '', facebookPages: '',
        accessToken: '', userAccessToken: '', tokenExpiry: '',
        username: '', name: '', profilePic: '', followersCount: '',
      },
    }
  );
  logger.info(`✅ Cleared duplicate CreatorAccounts for IG ${igBusinessId} (kept userId ${userId})`);

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
    logger.error('❌ Failed to subscribe App to Facebook Page for webhooks', err?.response?.data || err.message);
  }

  logger.info(`✅ OAuth complete for page ${pageWithIG.id} / IG ${igBusinessId}`);

  const updatePayload: any = {
    userId: userId,
    instagramBusinessId: igBusinessId,
    pageId: pageWithIG.id,
    facebookPages,
    accessToken: encryptedToken,
    userAccessToken: encryptToken(longLivedToken),
    tokenExpiry,
    username: igProfile.username,
    name: igProfile.name,
    profilePic: igProfile.profile_picture_url,
    followersCount: igProfile.followers_count,
    isConnected: true,
    scopes: grantedScopes,
  };

  if (audienceDemographics) {
    updatePayload['profile.audienceDemographics'] = audienceDemographics;
  }

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
  const account = await CreatorAccount.findOne({ userId: req.user!.id }).select('-accessToken -userAccessToken');
  res.json({ success: true, data: { account } });
});

async function getUserGraphToken(userId: string): Promise<string | null> {
  const account = await CreatorAccount.findOne({ userId }).select('+userAccessToken +accessToken');
  if (account?.userAccessToken) return decryptToken(account.userAccessToken);
  if (account?.accessToken) return decryptToken(account.accessToken);
  return null;
}

function appGraphToken(): string {
  return `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;
}

function pageMetadataPayload(pages: PublicPageAbout[], extra: Record<string, unknown> = {}) {
  return {
    useCase: 'Page Public Metadata Access',
    description:
      'Aggregated public About information (name, location, hours, verification status, cover/profile) from multiple Facebook Pages. Every field is labeled with its source Page.',
    pages,
    aggregates: aggregatePageAbout(pages),
    ...extra,
  };
}

// ─── GET /api/meta/pages — managed Pages with labeled About fields ───────────
router.get('/pages', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id }).select('+userAccessToken');
  if (!account || !account.userAccessToken) {
    res.json({ success: true, data: pageMetadataPayload([], { connected: false }) });
    return;
  }

  const token = decryptToken(account.userAccessToken);
  try {
    const pagesRes = await axios.get(`${META_API}/me/accounts`, {
      params: {
        fields: PAGE_PUBLIC_ABOUT_FIELDS,
        access_token: token,
      },
    });
    const pages = ((pagesRes.data?.data as any[]) || [])
      .map(normalizePageAbout)
      .filter((p): p is PublicPageAbout => Boolean(p));
    res.json({ success: true, data: pageMetadataPayload(pages, { connected: true, origin: 'managed_pages' }) });
  } catch (err: any) {
    logger.error('Failed to fetch Facebook pages', err?.response?.data || err);
    throw new AppError(graphErrorMessage(err) || 'Failed to fetch Facebook pages.', 500);
  }
});

// ─── GET /api/meta/public-page-metadata ───────────────────────────────────────
// Page Public Metadata Access: search public Pages and aggregate About fields.
// Query: q (search term, required), limit (optional, default 8)
router.get('/public-page-metadata', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const query = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '8'), 10) || 8, 2), 15);

  if (query.length < 2) {
    throw new AppError('Provide a search term (?q=) of at least 2 characters to aggregate public Page About data.', 400);
  }

  const userToken = await getUserGraphToken(req.user!.id);
  if (!userToken) {
    throw new AppError('Connect Facebook via Meta login before viewing public Page metadata.', 400);
  }

  const tokens = [userToken, appGraphToken()].filter((t, i, arr) => arr.indexOf(t) === i);
  let lastError = '';

  for (const accessToken of tokens) {
    try {
      const matches = await searchPublicPages(query, accessToken, limit);
      if (matches.length === 0) {
        res.json({
          success: true,
          data: pageMetadataPayload([], { query, origin: 'pages_search', connected: true }),
        });
        return;
      }

      const pages = await fetchPagesAbout(matches.map((p) => p.id), accessToken);
      res.json({
        success: true,
        data: pageMetadataPayload(pages, {
          query,
          origin: 'pages_search',
          connected: true,
          resultCount: pages.length,
        }),
      });
      return;
    } catch (err: any) {
      lastError = graphErrorMessage(err);
      logger.warn('Public Page metadata fetch failed for a token', err?.response?.data || err);
    }
  }

  throw new AppError(lastError || 'Failed to fetch public Page metadata from Meta.', 500);
});

// ─── DELETE /api/meta/disconnect ─────────────────────────────────────────────
router.delete('/disconnect', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  // Wipe all Instagram-related fields so reconnecting starts completely fresh
  await CreatorAccount.findOneAndUpdate(
    { userId: req.user!.id },
    {
      $set: { isConnected: false, scopes: [] },
      $unset: {
        instagramBusinessId: '',
        pageId: '',
        facebookPages: '',
        accessToken: '',
        userAccessToken: '',
        tokenExpiry: '',
        username: '',
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

  // ── Step 5: Process inline (no queue dependency) ────────────────────────────
  // We process synchronously after acknowledging Meta. This is safe because:
  // - We already sent 200 above, so Meta won't time out
  // - Render handles the async tail without a queue
  // - Removes Redis-as-queue as a failure point entirely
  if (body.object === 'instagram' || body.object === 'page') {
    const hasChanges = body.entry?.some(e => e.changes && e.changes.length > 0);
    const hasMessaging = body.entry?.some(e => e.messaging && e.messaging.length > 0);

    if (hasChanges || hasMessaging) {
      logger.info('🚀 Processing webhook inline', { object: body.object, hasChanges, hasMessaging });
      processWebhookEvent(body).catch((err: Error) => {
        logger.error('❌ Webhook processing error', { message: err.message, stack: err.stack });
      });
    } else {
      logger.info('ℹ️ Webhook has no changes or messaging to process — skipping');
    }
  } else {
    logger.info(`ℹ️ Ignoring webhook object type: ${body.object}`);
  }
});

export { decryptToken };
export default router;
