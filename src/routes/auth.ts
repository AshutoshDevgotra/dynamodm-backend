import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { User } from '../models/User';
import { Subscription } from '../models/Subscription';
import { generateToken, authenticate, AuthRequest } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { AppError } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';

const router = Router();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// POST /api/auth/register
router.post('/register', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    throw new AppError('Name, email, and password are required.', 400);
  }

  const existing = await User.findOne({ email });
  if (existing) throw new AppError('Email already registered.', 409);

  const user = await User.create({ name, email, password, isVerified: true });
  await Subscription.create({ userId: user._id, plan: 'free' });

  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role } },
  });
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required.', 400);

  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.password) throw new AppError('Invalid credentials.', 401);
  if (!user.isActive) throw new AppError('Account suspended. Contact support.', 403);

  const isValid = await user.comparePassword(password);
  if (!isValid) throw new AppError('Invalid credentials.', 401);

  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  res.json({
    success: true,
    data: { token, user: { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } },
  });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
    return;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  user.resetPasswordToken = hashed;
  user.resetPasswordExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: 'DynamoDM — Password Reset',
    html: `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>Expires in 30 minutes.</p>`,
  });

  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body;
  if (!token || !password) throw new AppError('Token and new password are required.', 400);

  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpiry: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpiry');

  if (!user) throw new AppError('Invalid or expired reset token.', 400);

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpiry = undefined;
  await user.save();

  res.json({ success: true, message: 'Password reset successfully.' });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.user!.id);
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  res.json({ success: true, data: { user, subscription } });
});

// PUT /api/auth/me
router.put('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, avatar } = req.body;
  const user = await User.findByIdAndUpdate(req.user!.id, { name, avatar }, { new: true, runValidators: true });
  res.json({ success: true, data: { user } });
});

// POST /api/auth/logout
router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/auth/google
router.get('/google', (_req: Request, res: Response): void => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL as string,
    response_type: 'code',
    scope: 'profile email',
    access_type: 'offline',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.query as { code: string };
  if (!code) throw new AppError('No authorization code received.', 400);

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL!,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenRes.json() as { access_token: string };
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json() as { id: string; email: string; name: string; picture: string };

  let user = await User.findOne({ $or: [{ googleId: profile.id }, { email: profile.email }] });
  if (!user) {
    user = await User.create({ name: profile.name, email: profile.email, googleId: profile.id, avatar: profile.picture, isVerified: true });
    await Subscription.create({ userId: user._id, plan: 'free' });
  } else if (!user.googleId) {
    user.googleId = profile.id;
    if (!user.avatar) user.avatar = profile.picture;
    await user.save({ validateBeforeSave: false });
  }

  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  res.redirect(`${process.env.CLIENT_URL}/creator?token=${token}`);
});

export default router;
