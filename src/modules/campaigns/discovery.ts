import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';

const router = Router();

// GET /api/discovery/creators
// Search and filter creators for brand campaigns
router.get('/creators', authenticate, requireRole('brand'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { niche, minFollowers, maxFollowers, query, page = '1', limit = '20', minAgePercentage, targetAge, targetGender } = req.query;

    const filter: any = { isConnected: true };

    if (niche) {
      filter['profile.niche'] = { $in: Array.isArray(niche) ? niche : [niche] };
    }

    if (minFollowers || maxFollowers) {
      filter.followersCount = {};
      if (minFollowers) filter.followersCount.$gte = parseInt(minFollowers as string, 10);
      if (maxFollowers) filter.followersCount.$lte = parseInt(maxFollowers as string, 10);
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
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { username: { $regex: q, $options: 'i' } },
        { 'profile.bio': { $regex: q, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page as string, 10) - 1) * parseInt(limit as string, 10);

    const [creators, total] = await Promise.all([
      CreatorAccount.find(filter)
        .select('userId name username followersCount profile')
        .sort({ followersCount: -1 }) // Sort by most followers by default
        .skip(skip)
        .limit(parseInt(limit as string, 10)),
      CreatorAccount.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: {
        creators,
        pagination: {
          total,
          page: parseInt(page as string, 10),
          limit: parseInt(limit as string, 10),
          pages: Math.ceil(total / parseInt(limit as string, 10))
        }
      }
    });
  } catch (error) {
    console.error('Discovery Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch creators' });
  }
});

export default router;
