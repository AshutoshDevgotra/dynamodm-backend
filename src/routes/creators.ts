import { Router, Request, Response } from 'express';
import { CreatorAccount } from '../models/CreatorAccount';
import { AutomationRule } from '../models/AutomationRule';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// GET /api/creators/:username
router.get('/:username', async (req: Request, res: Response): Promise<void> => {
  const account = await CreatorAccount.findOne({ username: req.params.username, isConnected: true });
  if (!account) throw new AppError('Creator profile not found.', 404);

  const automations = await AutomationRule.find({ 
    creatorId: account.userId, 
    isActive: true, 
    ctaLink: { $ne: null } 
  });

  const links = automations
    .filter(a => a.ctaLink && a.ctaLink.trim() !== '')
    .map(a => ({
      label: a.name,
      url: a.ctaLink,
      cta: true
    }));

  const profile = {
    name: account.name || account.username,
    username: account.username,
    instagramUsername: account.username,
    bio: 'Creator automating DMs and sharing resources! 🚀',
    followersCount: account.followersCount || 0,
    links
  };

  res.json({ success: true, data: { profile } });
});

export default router;
