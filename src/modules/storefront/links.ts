import { Router, Request, Response } from 'express';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { Link } from '../../models/Link';
import { Product } from '../../models/Product';
import { AnalyticsEvent } from '../../models/AnalyticsEvent';
import { AppError } from '../../middleware/errorHandler';
import crypto from 'crypto';

const router = Router();

// Helper to generate random short string
const generateShortCode = () => crypto.randomBytes(4).toString('hex');

// POST /api/links/generate - Create a short link
router.post('/generate', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { originalUrl, productId, customCode } = req.body;
  
  if (!originalUrl) {
    throw new AppError('Original URL is required.', 400);
  }

  const shortCode = customCode || generateShortCode();

  // Check if custom code exists
  if (customCode) {
    const existing = await Link.findOne({ shortCode });
    if (existing) {
      throw new AppError('Custom code already in use.', 400);
    }
  }

  const link = await Link.create({
    creatorId: req.user!.id,
    productId: productId || null,
    shortCode,
    originalUrl,
    clicks: 0,
    isActive: true
  });

  res.status(201).json({
    success: true,
    data: { link, dynamoUrl: `https://dynm.co/l/${shortCode}` } // Assuming dynm.co is the redirect domain
  });
});

// GET /api/links/:shortCode - Redirect and track click
router.get('/:shortCode', async (req: Request, res: Response): Promise<void> => {
  const { shortCode } = req.params;
  
  const link = await Link.findOne({ shortCode, isActive: true });
  if (!link) {
    res.status(404).send('Link not found or deactivated.');
    return;
  }

  // Increment click count
  link.clicks += 1;
  await link.save();

  // Track the event asynchronously
  AnalyticsEvent.create({
    creatorId: link.creatorId,
    eventType: 'link_click',
    metadata: {
      shortCode,
      productId: link.productId,
      userAgent: req.get('User-Agent'),
      referrer: req.get('Referrer'),
      ipHash: crypto.createHash('sha256').update(req.ip || '').digest('hex') // Anonymize IP
    },
    timestamp: new Date()
  }).catch(err => console.error('Failed to log click event', err));

  res.redirect(302, link.originalUrl);
});

export default router;
