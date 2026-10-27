import { Router, Request, Response } from 'express';
import { authenticate, requirePaidSubscription, requireRole } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';

const router = Router();

// GET /api/discovery/creators
// Search and filter creators for brand campaigns
router.get('/creators', authenticate, requirePaidSubscription, requireRole('brand'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { niche, minFollowers, maxFollowers, query, page = '1', limit = '20', minAgePercentage, targetAge, targetGender } = req.query;

    const filter: any = { isConnected: true };

    if (niche) {
      filter['profile.niche'] = { $in: Array.isArray(niche) ? niche : [niche] };
    }

    const parsedPage = Number.parseInt(page as string, 10);
    const parsedLimit = Number.parseInt(limit as string, 10);
    const safePage = Number.isFinite(parsedPage) ? Math.min(100000, Math.max(1, parsedPage)) : 1;
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 20;
    const minFollowersValue = minFollowers ? Number.parseInt(minFollowers as string, 10) : undefined;
    const maxFollowersValue = maxFollowers ? Number.parseInt(maxFollowers as string, 10) : undefined;
    if ((minFollowers && !Number.isFinite(minFollowersValue)) || (maxFollowers && !Number.isFinite(maxFollowersValue))) {
      res.status(400).json({ success: false, message: 'Follower filters must be valid numbers.' });
      return;
    }

    if (minFollowers || maxFollowers) {
      filter.followersCount = {};
      if (minFollowersValue !== undefined) filter.followersCount.$gte = minFollowersValue;
      if (maxFollowersValue !== undefined) filter.followersCount.$lte = maxFollowersValue;
    }

    if (targetAge && minAgePercentage) {
      filter['profile.audienceDemographics.topAgeRanges'] = {
        $elemMatch: {
          age: targetAge,
          percentage: { $gte: parseFloat(minAgePercentage as string) }
        }
      };
    }

    if (targetGender) {
      filter['profile.audienceDemographics.topGenders'] = {
        $elemMatch: {
          gender: targetGender,
          percentage: { $gte: 50 } // Example: majority gender
        }
      };
    }

    if (query) {
      const q = query as string;
      const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      filter.$or = [
        { name: { $regex: escapedQuery, $options: 'i' } },
        { username: { $regex: escapedQuery, $options: 'i' } },
        { 'profile.bio': { $regex: escapedQuery, $options: 'i' } }
      ];
    }

    const skip = (safePage - 1) * safeLimit;

    const [creators, total] = await Promise.all([
      CreatorAccount.find(filter)
        .select('userId name username followersCount profile')
        .sort({ followersCount: -1 }) // Sort by most followers by default
        .skip(skip)
        .limit(safeLimit),
      CreatorAccount.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        creators,
        pagination: {
          total,
          page: safePage,
          limit: safeLimit,
          pages: Math.ceil(total / safeLimit)
        }
      }
    });
  } catch (error) {
    console.error('Discovery Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch creators' });
  }
});

export default router;
