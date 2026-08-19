import { Router, Request, Response } from 'express';
import { authenticate, requireRole, AuthRequest } from '../../middleware/auth';
import { BrandCampaign } from '../../models/BrandCampaign';
import { Brand } from '../../models/Brand';
import { AppError } from '../../middleware/errorHandler';

const router = Router();
router.use(authenticate, requireRole('brand'));

// POST /api/brand-campaigns
// Create a new campaign
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const brand = await Brand.findOne({ userId: req.user!.id });
  if (!brand) throw new AppError('Brand profile not found', 404);

  const { title, description, budget, requirements, deliverables } = req.body;

  const campaign = await BrandCampaign.create({
    brandId: brand._id,
    title,
    description,
    budget,
    requirements,
    deliverables,
    status: 'ACTIVE'
  });

  res.status(201).json({ success: true, data: { campaign } });
});

// GET /api/brand-campaigns
// List campaigns for the authenticated brand
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const brand = await Brand.findOne({ userId: req.user!.id });
  if (!brand) throw new AppError('Brand profile not found', 404);

  const campaigns = await BrandCampaign.find({ brandId: brand._id })
    .populate('proposals.creatorId', 'name username profilePic')
    .sort({ createdAt: -1 });

  res.json({ success: true, data: { campaigns } });
});

// POST /api/brand-campaigns/:id/invite
// Invite a creator to a campaign
router.post('/:id/invite', async (req: AuthRequest, res: Response): Promise<void> => {
  const { creatorId, message, proposedRate } = req.body;
  
  const brand = await Brand.findOne({ userId: req.user!.id });
  if (!brand) throw new AppError('Brand profile not found', 404);

  const campaign = await BrandCampaign.findOne({ _id: req.params.id, brandId: brand._id });
  if (!campaign) throw new AppError('Campaign not found', 404);

  // Check if already invited
  const exists = campaign.proposals.find(p => p.creatorId.toString() === creatorId);
  if (exists) throw new AppError('Creator is already invited to this campaign', 400);

  campaign.proposals.push({
    creatorId,
    status: 'PENDING',
    message,
    proposedRate: proposedRate || campaign.budget
  });

  await campaign.save();

  // TODO: Trigger Email/Push notification to the creator here

  res.json({ success: true, data: { campaign } });
});

export default router;
