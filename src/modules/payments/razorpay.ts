import { Router, Request, Response } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { authenticate, AuthRequest, requireRole } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';
import { BrandCampaign } from '../../models/BrandCampaign';
import { Transaction } from '../../models/Transaction';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

// Initialize Razorpay
const getRazorpayInstance = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay credentials not configured');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// ─── POST /api/payments/onboard (Creator Linked Account) ──────────────────────
router.post('/onboard', authenticate, requireRole('creator'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, email, phone } = req.body;
  
  const creator = await CreatorAccount.findOne({ userId: req.user!.id });
  if (!creator) throw new AppError('Creator not found', 404);

  // If we already have a Razorpay account ID, don't recreate
  if ((creator as any).razorpayAccountId) {
    res.json({ success: true, message: 'Already onboarded', accountId: (creator as any).razorpayAccountId });
    return;
  }

  const rzp = getRazorpayInstance();

  try {
    // Create Route Linked Account
    const account = await rzp.accounts.create({
      type: 'route',
      email: email || `${creator.username}@dynamodm.temp`,
      phone: phone || '9999999999', // Dummy for MVP
      legal_business_name: name || creator.name || creator.username,
      business_type: 'individual',
      contact_name: name || creator.name || creator.username,
    } as any);

    // Save accountId to creator profile (dynamic typing for now since schema isn't fully updated with this field)
    await CreatorAccount.findByIdAndUpdate(creator._id, {
      $set: { 'wallet.razorpayAccountId': account.id }
    });

    res.json({ success: true, data: { accountId: account.id, status: account.status } });
  } catch (error: any) {
    console.error('Razorpay Onboarding Error:', error);
    throw new AppError(error.description || 'Failed to create Razorpay account', 500);
  }
});

// ─── POST /api/payments/create-order (Brand Campaign Funding) ────────────────
router.post('/create-order', authenticate, requireRole('brand'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { campaignId, amount } = req.body;

  const campaign = await BrandCampaign.findById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);

  const rzp = getRazorpayInstance();

  try {
    const order = await rzp.orders.create({
      amount: amount * 100, // Razorpay uses paise
      currency: 'INR',
      receipt: `camp_${campaignId}`,
      notes: { campaignId }
    });

    // Log the pending deposit
    await Transaction.create({
      campaignId: campaign._id,
      brandId: campaign.brandId,
      razorpayOrderId: order.id,
      type: 'DEPOSIT',
      amount: amount * 100,
      currency: 'INR',
      platformFee: 0,
      netAmount: amount * 100,
      status: 'PENDING'
    });

    res.json({ success: true, data: { orderId: order.id, amount: order.amount, currency: order.currency } });
  } catch (error: any) {
    throw new AppError(error.description || 'Failed to create order', 500);
  }
});

// ─── POST /api/payments/transfer (Creator Payout) ─────────────────────────────
router.post('/transfer', authenticate, requireRole('admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { creatorId, amount, campaignId } = req.body;

  const creator = await CreatorAccount.findById(creatorId);
  if (!creator) throw new AppError('Creator not found', 404);

  const accountId = (creator.wallet as any).razorpayAccountId;
  if (!accountId) throw new AppError('Creator has not onboarded with Razorpay', 400);

  const rzp = getRazorpayInstance();
  const totalAmountPaise = amount * 100;
  
  // 5% Platform Fee deducted from payout
  const platformFeePaise = Math.round(totalAmountPaise * 0.05);
  const payoutPaise = totalAmountPaise - platformFeePaise;

  try {
    const transfer = await rzp.transfers.create({
      account: accountId,
      amount: payoutPaise,
      currency: 'INR',
      notes: { campaignId, type: 'creator_payout' }
    });

    await Transaction.create({
      campaignId,
      creatorId,
      razorpayTransferId: transfer.id,
      type: 'PAYOUT',
      amount: totalAmountPaise,
      currency: 'INR',
      platformFee: platformFeePaise,
      netAmount: payoutPaise,
      status: 'COMPLETED'
    });

    res.json({ success: true, data: { transferId: transfer.id, netAmount: payoutPaise / 100 } });
  } catch (error: any) {
    throw new AppError(error.description || 'Failed to process transfer', 500);
  }
});

// ─── POST /api/payments/webhook ───────────────────────────────────────────────
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  const signature = req.headers['x-razorpay-signature'] as string;

  const shasum = crypto.createHmac('sha256', secret);
  // Need raw body for correct signature calculation, assuming express.json uses a verification callback to store rawBody
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  shasum.update(rawBody);
  const digest = shasum.digest('hex');

  if (digest !== signature) {
    res.status(400).send('Invalid signature');
    return;
  }

  const event = req.body.event;
  const payload = req.body.payload;

  try {
    if (event === 'payment.captured') {
      const payment = payload.payment.entity;
      await Transaction.findOneAndUpdate(
        { razorpayOrderId: payment.order_id },
        { 
          razorpayPaymentId: payment.id,
          status: 'COMPLETED'
        }
      );
      // Optional: Update Campaign status or Brand wallet
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
  }

  res.json({ status: 'ok' });
});

export default router;
