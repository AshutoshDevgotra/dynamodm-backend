import { Router, Request, Response } from 'express';
import { CreatorAccount } from '../../models/CreatorAccount';
import { Product } from '../../models/Product';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

// GET /api/creators/datadeletion — Meta data deletion callback (must come before /:username)
router.get('/datadeletion', (_req: Request, res: Response): void => {
  res.json({ success: true, message: 'Data deletion instructions available at https://dynamodm-frontend.vercel.app/privacy' });
});

// GET /api/creators/:username
router.get('/:username', async (req: Request, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ igUsername: req.params.username, isConnected: true });
  if (!account) throw new AppError('Creator profile not found.', 404);

  const products = await Product.find({ creatorId: account._id });

  const links = products.map((p: any) => ({
    label: p.title,
    url: p.originalUrl || p.dynamoShortUrl,
    cta: true
  }));

  const profile = {
    name: account.name || account.igUsername,
    username: account.igUsername,
    instagramUsername: account.igUsername,
    bio: account.profile?.bio || 'Creator automating DMs and sharing resources! 🚀',
    followersCount: account.followersCount || 0,
    links
  };

  res.json({ success: true, data: { profile } });
});

export default router;
