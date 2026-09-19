import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import mongoose from 'mongoose';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import {
  exchangeCodeForToken,
  exchangeToLongLivedToken,
  getProfile,
  getMedia,
} from '../../lib/instagram';

const router = Router();
const INSTAGRAM_API = 'https://graph.instagram.com/v23.0';

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

export function decryptToken(encrypted: string): string {
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
];

async function subscribeInstagramWebhooks(instagramUserId: string, accessToken: string): Promise<void> {
  await axios.post(`${INSTAGRAM_API}/${instagramUserId}/subscribed_apps`, null, {
    params: {
      subscribed_fields: 'comments,messages',
      access_token: accessToken,
    },
  });
  logger.info(`✅ Subscribed Instagram account ${instagramUserId} to comments and messages webhooks`);
}

router.get('/login', authenticate, (req: AuthRequest, res: Response): void => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : req.cookies?.token || (typeof req.query.token === 'string' ? req.query.token : '');
  if (!token) throw new AppError('A valid session is required to connect Instagram.', 401);
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI?.trim();
  if (!redirectUri) throw new AppError('INSTAGRAM_REDIRECT_URI is not configured.', 503);
  logger.info('Starting Instagram OAuth flow', { redirectUri });
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID as string,
    redirect_uri: redirectUri,
    scope: REQUIRED_SCOPES.join(','),
    response_type: 'code',
    state: token,
  });

  res.json({ success: true, data: { authUrl: `https://www.instagram.com/oauth/authorize?${params}` } });
});

router.get('/profile/lookup', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const raw = typeof req.query.handle === 'string' ? req.query.handle : typeof req.query.url === 'string' ? req.query.url : '';
  const requestedUserId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const username = raw.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].trim().toLowerCase();
  if (!requestedUserId && (!username || !/^[a-z0-9._]{1,30}$/.test(username))) throw new AppError('Enter a valid Instagram handle, profile URL, or numeric user ID.', 400);
  if (requestedUserId && !/^\d{5,30}$/.test(requestedUserId)) throw new AppError('Instagram user ID must be numeric.', 400);

  const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('+igAccessToken');
  if (!account?.igAccessToken || !account.igUserId) throw new AppError('Connect an Instagram professional account before searching.', 409);
  const accessToken = decryptToken(account.igAccessToken);
  try {
    let profile: any;
    if (requestedUserId === account.igUserId || username === account.igUsername?.toLowerCase()) {
      profile = await getProfile(account.igUserId, accessToken);
    } else if (requestedUserId) {
      const response = await axios.get(`https://graph.instagram.com/v23.0/${requestedUserId}`, {
        params: {
          fields: 'user_id,username,name,profile_picture_url,followers_count,media_count,biography,account_type',
          access_token: accessToken,
        },
      });
      profile = response.data;
    } else {
      const response = await axios.get(`https://graph.facebook.com/v23.0/${account.igUserId}`, {
        params: {
          fields: `business_discovery.username(${username}){username,name,profile_picture_url,followers_count,media_count,biography}`,
          access_token: accessToken,
        },
      });
      profile = response.data?.business_discovery;
    }
    if (!profile) throw new AppError('Instagram profile was not found or is not available through Meta.', 404);
    res.json({ success: true, data: { profile: { ...profile, userId: profile.user_id || profile.id || requestedUserId, webUrl: profile.username ? `https://www.instagram.com/${profile.username}/` : null, isCurrentAccount: (profile.user_id || profile.id) === account.igUserId || profile.username?.toLowerCase() === account.igUsername?.toLowerCase() } } });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    logger.error('Instagram profile lookup failed:', error?.response?.data || error?.message || error);
    throw new AppError(error?.response?.data?.error?.message || 'Unable to search Instagram through Meta.', 502);
  }
});

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

  try {
    const shortLivedRes = await exchangeCodeForToken(
      code,
      process.env.INSTAGRAM_APP_ID as string,
      process.env.INSTAGRAM_APP_SECRET as string,
      process.env.INSTAGRAM_REDIRECT_URI as string
    );

    const { access_token: shortToken, user_id: igUserId } = shortLivedRes;
    logger.info(`✅ Got short-lived token for IG user ${igUserId}`);

    const longLivedRes = await exchangeToLongLivedToken(
      shortToken,
      process.env.INSTAGRAM_APP_SECRET as string
    );

    const { access_token: longToken, expires_in } = longLivedRes;
    logger.info(`✅ Exchanged to long-lived token (expires in ${expires_in}s)`);

    const igProfile = await getProfile(igUserId, longToken);
    const instagramUserId = igProfile.user_id || igUserId;
    logger.info(`✅ Fetched IG profile: @${igProfile.username} (${instagramUserId})`);

    await CreatorAccount.updateMany(
      { igUserId: instagramUserId, userId: { $ne: new mongoose.Types.ObjectId(userId) } },
      {
        $set: { isConnected: false, scopes: [] },
        $unset: {
          igUserId: '',
          igUsername: '',
          igAccessToken: '',
          igTokenExpiresAt: '',
          name: '',
          profilePic: '',
          followersCount: '',
        },
      }
    );
    logger.info(`✅ Cleared duplicate CreatorAccounts for IG ${instagramUserId} (kept userId ${userId})`);

    const encryptedToken = encryptToken(longToken);
    const tokenExpiry = new Date(Date.now() + (expires_in || 60 * 60 * 24 * 60) * 1000);

    const updatePayload = {
      userId,
      igUserId: instagramUserId,
      igUsername: igProfile.username,
      igAccessToken: encryptedToken,
      igTokenExpiresAt: tokenExpiry,
      name: igProfile.username,
      profilePic: igProfile.profile_picture_url,
      followersCount: igProfile.followers_count,
      isConnected: true,
      scopes: REQUIRED_SCOPES,
    };

    try {
      await subscribeInstagramWebhooks(instagramUserId, longToken);
    } catch (subscriptionError: any) {
      logger.error('Failed to subscribe Instagram account to webhooks', subscriptionError?.response?.data || subscriptionError);
    }

    await CreatorAccount.findOneAndUpdate(
      { userId },
      { $set: updatePayload },
      { upsert: true, new: true }
    );

    logger.info(`✅ OAuth complete for IG user ${igUserId}`);

    const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
    const profileUrl = `https://www.instagram.com/${igProfile.username}/`;
    const safeFrontendUrl = JSON.stringify(frontendUrl);
    const successMessage = JSON.stringify({ type: 'INSTAGRAM_AUTH_SUCCESS', username: igProfile.username, profileUrl });
    const dashboardUrl = JSON.stringify(`${frontendUrl}/dashboard?connected=${encodeURIComponent(igProfile.username)}`);
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
              if (window.opener && window.opener !== window) {
                window.opener.postMessage(${successMessage}, ${safeFrontendUrl});
                window.close();
              } else {
                window.location.replace(${dashboardUrl});
              }
            } catch(e) {}
          </script>
        </body>
      </html>
    `;
    res.send(html);
  } catch (error: any) {
    logger.error('Instagram OAuth callback error:', error);
    res.status(400).send(`Authentication failed: ${error.message}`);
  }
});

router.get('/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ userId: req.user!.id }).select('+igAccessToken');
  if (account?.isConnected && account.igAccessToken && account.igUserId) {
    try {
      const accessToken = decryptToken(account.igAccessToken);
      const profile = await getProfile(account.igUserId, accessToken);
      const instagramUserId = profile.user_id || account.igUserId;
      if (instagramUserId !== account.igUserId) {
        account.igUserId = instagramUserId;
        await account.save();
      }
      await subscribeInstagramWebhooks(instagramUserId, accessToken);
    } catch (subscriptionError: any) {
      logger.warn('Instagram webhook subscription refresh failed', subscriptionError?.response?.data || subscriptionError?.message || subscriptionError);
    }
  }
  const accountData = account?.toObject() as Record<string, unknown> | undefined;
  if (accountData) {
    delete accountData.igAccessToken;
    if (accountData.igUsername) accountData.webUrl = `https://www.instagram.com/${accountData.igUsername}/`;
  }
  res.json({
    success: true,
    data: {
      isConnected: Boolean(account?.isConnected),
      account: accountData || null,
    },
  });
});

router.get('/posts', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const account = await CreatorAccount.findOne({ userId: req.user!.id, isConnected: true }).select('+igAccessToken');
    if (!account || !account.igAccessToken || !account.igUserId) {
      res.json({ success: true, data: { posts: [] } });
      return;
    }

    const token = decryptToken(account.igAccessToken);
    const profile = await getProfile(account.igUserId, token);
    const instagramUserId = profile.user_id || account.igUserId;

    if (instagramUserId !== account.igUserId) {
      await CreatorAccount.updateOne(
        { _id: account._id },
        { $set: { igUserId: instagramUserId } },
      );
      logger.info(`Migrated stored Instagram user ID for @${profile.username}`);
    }

    const posts = await getMedia(instagramUserId, token, 30);
    res.json({ success: true, data: { posts: posts || [] } });
  } catch (err: any) {
    logger.error('Failed to fetch Instagram posts:', err?.message || err);
    res.json({ success: true, data: { posts: [] } });
  }
});

router.delete('/disconnect', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  await CreatorAccount.findOneAndUpdate(
    { userId: req.user!.id },
    {
      $set: { isConnected: false, scopes: [] },
      $unset: {
        igUserId: '',
        igUsername: '',
        igAccessToken: '',
        igTokenExpiresAt: '',
        name: '',
        profilePic: '',
        followersCount: '',
      },
    }
  );
  res.json({ success: true, message: 'Instagram account disconnected.' });
});

export default router;
