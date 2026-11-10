import { Router, Request, Response } from 'express';
import { CreatorAccount } from '../../models/CreatorAccount';
import { Product } from '../../models/Product';
import { AppError } from '../../middleware/errorHandler';
import crypto from 'crypto';
import { Lead } from '../../models/Lead';
import { authenticate, requireActiveSubscription, AuthRequest } from '../../middleware/auth';

const router = Router();
const reservedUsernames = new Set(['admin', 'login', 'signup', 'creator', 'pricing', 'settings', 'support', 'learn', 'courses', 'api']);
const usernamePattern = /^[a-z0-9._-]{3,30}$/;
const escapedUsername = (username: string) => new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

router.get('/me/storefront-username/check', authenticate, requireActiveSubscription, async (req: AuthRequest, res: Response): Promise<void> => {
  const username = String(req.query.username || '').trim().toLowerCase();
  if (!usernamePattern.test(username) || reservedUsernames.has(username)) { res.json({ success: true, data: { available: false, reason: 'Use 3–30 letters, numbers, dots, underscores, or hyphens.' } }); return; }
  const account = await CreatorAccount.findOne({ userId: req.user!.id }).select('_id');
  const taken = await CreatorAccount.findOne({ _id: { $ne: account?._id }, $or: [{ storefrontUsername: escapedUsername(username) }, { igUsername: escapedUsername(username) }] }).select('_id');
  res.json({ success: true, data: { available: !taken, username } });
});

router.put('/me/storefront-username', authenticate, requireActiveSubscription, async (req: AuthRequest, res: Response): Promise<void> => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  if (!usernamePattern.test(username) || reservedUsernames.has(username)) throw new AppError('Use 3–30 letters, numbers, dots, underscores, or hyphens.', 400);
  const account = await CreatorAccount.findOne({ userId: req.user!.id });
  if (!account) throw new AppError('Creator account not found.', 404);
  const taken = await CreatorAccount.findOne({ _id: { $ne: account._id }, $or: [{ storefrontUsername: escapedUsername(username) }, { igUsername: escapedUsername(username) }] }).select('_id');
  if (taken) throw new AppError('That storefront username is already taken.', 409);
  account.storefrontUsername = username;
  await account.save();
  res.json({ success: true, data: { username } });
});

// GET /api/creators/datadeletion — Meta data deletion callback (must come before /:username)
router.get('/datadeletion', (_req: Request, res: Response): void => {
  res.json({ success: true, message: 'Data deletion instructions available at https://automation.houseoforange.in/privacy' });
});

// GET /api/creators/:username
router.get('/:username', async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username.trim().replace(/^@/, '');
  const account = await CreatorAccount.findOne({ $or: [{ storefrontUsername: escapedUsername(username) }, { igUsername: escapedUsername(username) }], isConnected: true });
  if (!account) throw new AppError('Creator profile not found.', 404);

  const products = await Product.find({ creatorId: account._id }).sort({ createdAt: -1 }).select('-imageData');
  const storefrontProducts = products.map((product) => ({
    id: product._id,
    title: product.title,
    description: product.description || '',
    type: product.type,
    mediaType: product.mediaType,
    mediaUrl: product.mediaUrl,
    imageUrl: product.imageUrl || (product.imageMimeType ? `/api/products/${product._id}/image` : undefined),
    url: product.originalUrl || product.dynamoShortUrl,
  }));

  const profile = {
    name: account.name || account.igUsername,
    username: account.storefrontUsername || account.igUsername,
    instagramUsername: account.igUsername,
    bio: account.profile?.bio || '',
    avatar: account.profile?.avatar || account.profilePic || '',
    followersCount: account.followersCount || 0,
    products: storefrontProducts,
    links: storefrontProducts.map((product) => ({ label: product.title, url: product.url, cta: true })),
    follow: {
      enabled: account.profile?.followEnabled ?? true,
      emailOnly: account.profile?.followEmailOnly ?? true,
      thankYouTitle: account.profile?.followThankYouTitle || 'Thanks for following me!',
      thankYouDescription: account.profile?.followThankYouDescription || 'I am super excited to send you exciting updates.',
    },
  };

  res.json({ success: true, data: { profile } });
});

// Public SuperProfile-style email follow capture. The email is stored only as
// a lead for the owning creator; no Instagram identity is invented for the
// visitor.
router.post('/:username/follow', async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username.trim().replace(/^@/, '');
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Enter a valid email address.', 400);
  const account = await CreatorAccount.findOne({ $or: [{ storefrontUsername: escapedUsername(username) }, { igUsername: escapedUsername(username) }], isConnected: true });
  if (!account) throw new AppError('Creator profile not found.', 404);
  if (account.profile?.followEnabled === false) throw new AppError('Email follow is not enabled for this profile.', 409);
  const visitorId = `web:${crypto.createHash('sha256').update(`${account._id}:${email}`).digest('hex').slice(0, 32)}`;
  await Lead.findOneAndUpdate(
    { creatorId: account.userId, instagramUserId: visitorId },
    { $set: { email, name: typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : undefined, source: 'manual' }, $setOnInsert: { creatorId: account.userId, instagramUserId: visitorId, username: 'profile-visitor' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.status(201).json({ success: true, data: { title: account.profile?.followThankYouTitle || 'Thanks for following me!', description: account.profile?.followThankYouDescription || 'I am super excited to send you exciting updates.' } });
});

export default router;
