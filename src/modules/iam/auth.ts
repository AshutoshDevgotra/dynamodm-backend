import { Router, Request, Response } from 'express';
import crypto from 'crypto';


import { User, IUser } from '../../models/User';
import { Subscription } from '../../models/Subscription';
import { Brand } from '../../models/Brand';
import { generateToken, authenticate, AuthRequest } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';
import { AppError } from '../../middleware/errorHandler';
import {
  buildInstagramBusinessLoginUrl,
} from '../../config/instagram';
import { getFrontendUrl } from '../../config/frontend';
import { connectDB } from '../../config/database';
import { sendOtpEmail } from '../../lib/email';

const router = Router();
const publicEmailDomains = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com']);
const allowedRoles = new Set(['CREATOR', 'BRAND']);

const normalizeRegistration = (body: Record<string, unknown>) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const requestedRole = typeof body.role === 'string' ? body.role.trim().toUpperCase() : 'CREATOR';
  if (!name || !email || !password) throw new AppError('Name, email, and password are required.', 400);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError('Please provide a valid email address.', 400);
  if (password.length < 8) throw new AppError('Password must be at least 8 characters.', 400);
  if (!allowedRoles.has(requestedRole)) throw new AppError('Invalid registration role.', 400);
  return { name, email, password, role: requestedRole as 'CREATOR' | 'BRAND' };
};

const safeUser = (user: IUser) => ({ id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar });
const createOtp = () => String(crypto.randomInt(100000, 1000000));
const hashOtp = (otp: string) => crypto.createHash('sha256').update(otp).digest('hex');

const createSignupRecords = async (data: { name: string; email: string; password?: string; role: 'CREATOR' | 'BRAND'; googleId?: string; avatar?: string }) => {
  const user = await User.create({ ...data, isVerified: Boolean(data.googleId) });
  await Subscription.create({ userId: user._id, plan: 'free' });
  if (data.role === 'BRAND') {
    const domain = data.email.split('@')[1];
    await Brand.create({
      userId: user._id,
      companyName: data.name,
      verificationStatus: domain && !publicEmailDomains.has(domain) ? 'VERIFIED' : 'PENDING',
    });
  }
  return user;
};

router.post('/register', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const data = normalizeRegistration(req.body);
  try {
    const user = await createSignupRecords(data);
    const otp = createOtp();
    user.verificationCodeHash = hashOtp(otp);
    user.verificationCodeExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });
    await sendOtpEmail(user.email, otp, 'verify');
    res.status(201).json({ success: true, message: 'Verification code sent to your email.', data: { requiresVerification: true, email: user.email } });
  } catch (error: any) {
    if (error?.code === 11000) throw new AppError('Email already registered.', 409);
    throw error;
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) throw new AppError('Email and password are required.', 400);

  const user = await User.findOne({ email }).select('+password');
  if (!user || !user.password) throw new AppError('Invalid credentials.', 401);
  if (!user.isActive) throw new AppError('Account suspended. Contact support.', 403);
  if (!user.isVerified) throw new AppError('Please verify your email before logging in.', 403);

  const passwordMatch = await user.comparePassword(password);
  if (!passwordMatch) throw new AppError('Invalid credentials.', 401);

  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  res.json({ success: true, data: { token, user: safeUser(user) } });
});

router.post('/verify-email', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) throw new AppError('Email and a 6-digit code are required.', 400);
  const user = await User.findOne({ email }).select('+verificationCodeHash +verificationCodeExpiry +password');
  if (!user || !user.verificationCodeHash || !user.verificationCodeExpiry || user.verificationCodeExpiry.getTime() < Date.now() || hashOtp(code) !== user.verificationCodeHash) throw new AppError('Invalid or expired verification code.', 400);
  user.isVerified = true;
  user.verificationCodeHash = undefined;
  user.verificationCodeExpiry = undefined;
  await user.save({ validateBeforeSave: false });
  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  res.json({ success: true, message: 'Email verified successfully.', data: { token, user: safeUser(user) } });
});

router.post('/resend-verification', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const user = await User.findOne({ email });
  if (user && !user.isVerified) {
    const otp = createOtp();
    user.verificationCodeHash = hashOtp(otp);
    user.verificationCodeExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save({ validateBeforeSave: false });
    await sendOtpEmail(user.email, otp, 'verify');
  }
  res.json({ success: true, message: 'If the account needs verification, a new code has been sent.' });
});

router.post('/forgot-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError('Please provide a valid email address.', 400);
  const user = await User.findOne({ email });
  if (!user) { res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' }); return; }
  const otp = createOtp();
  user.resetPasswordToken = hashOtp(otp);
  user.resetPasswordExpiry = new Date(Date.now() + 10 * 60 * 1000);
  await user.save({ validateBeforeSave: false });
  await sendOtpEmail(user.email, otp, 'reset');
  res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' });
});

router.post('/reset-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const { token, code, email: rawEmail, password, confirmPassword } = req.body;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const resetCode = typeof code === 'string' ? code.trim() : typeof token === 'string' ? token.trim() : '';
  if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(resetCode)) throw new AppError('A valid email and 6-digit reset code are required.', 400);
  if (typeof password !== 'string' || password.length < 8) throw new AppError('Password must be at least 8 characters.', 400);
  if (typeof confirmPassword !== 'string' || password !== confirmPassword) throw new AppError('Passwords do not match.', 400);
  const hashed = hashOtp(resetCode);
  const user = await User.findOne({ email, resetPasswordToken: hashed, resetPasswordExpiry: { $gt: Date.now() } }).select('+resetPasswordToken +resetPasswordExpiry +password');
  if (!user) throw new AppError('Invalid or expired reset code.', 400);
  user.password = password; user.resetPasswordToken = undefined; user.resetPasswordExpiry = undefined; await user.save();
  res.json({ success: true, message: 'Password reset successfully.' });
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.user!.id);
  if (!user) throw new AppError('User not found.', 404);
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  res.json({ success: true, data: { user: safeUser(user), subscription } });
});

router.put('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const updates: Record<string, string> = {};
  if (typeof req.body.name === 'string') updates.name = req.body.name.trim();
  if (typeof req.body.avatar === 'string') updates.avatar = req.body.avatar;
  const user = await User.findByIdAndUpdate(req.user!.id, updates, { new: true, runValidators: true });
  if (!user) throw new AppError('User not found.', 404);
  res.json({ success: true, data: { user: safeUser(user) } });
});

router.post('/logout', (_req: Request, res: Response): void => { res.clearCookie('token'); res.json({ success: true, message: 'Logged out successfully.' }); });

router.get('/google', (req: Request, res: Response): void => {
  // Carry ?plan= through OAuth by embedding it in the state param (jwt|plan=pro)
  const plan = typeof req.query.plan === 'string' ? req.query.plan : '';
  const state = plan ? `placeholder|plan=${plan}` : 'placeholder';
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID as string, redirect_uri: process.env.GOOGLE_CALLBACK_URL as string, response_type: 'code', scope: 'profile email', access_type: 'offline', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: oauthState } = req.query as { code: string; state?: string };
  if (!code) throw new AppError('No authorization code received.', 400);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: process.env.GOOGLE_CALLBACK_URL!, grant_type: 'authorization_code' }) });
  if (!tokenRes.ok) throw new AppError('Google authentication failed.', 401);
  const tokenData = await tokenRes.json() as { access_token: string };
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
  if (!profileRes.ok) throw new AppError('Unable to load Google profile.', 401);
  const profile = await profileRes.json() as { id: string; email: string; name: string; picture: string };
  await connectDB();
  const existingUser = await User.findOne({ $or: [{ googleId: profile.id }, { email: profile.email.toLowerCase() }] });
  const user = existingUser || await createSignupRecords({ name: profile.name, email: profile.email.toLowerCase(), googleId: profile.id, avatar: profile.picture, role: 'CREATOR' });
  if (existingUser && (!existingUser.googleId || !existingUser.isVerified)) {
    existingUser.googleId = existingUser.googleId || profile.id;
    existingUser.isVerified = true;
    if (!existingUser.avatar) existingUser.avatar = profile.picture;
    await existingUser.save({ validateBeforeSave: false });
  }
  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  const clientUrl = getFrontendUrl();

  let planRedirect = '';
  try {
    const stateParts = oauthState?.split('|');
    if (stateParts && stateParts.length > 1) {
      planRedirect = `&${stateParts[1]}`;
    }
  } catch {}

  res.redirect(`${clientUrl}/creator?token=${token}${planRedirect}`);
});

router.get('/instagram', (req: Request, res: Response): void => {
  const plan = typeof req.query.plan === 'string' ? req.query.plan : '';
  const state = plan ? `placeholder|plan=${plan}` : 'placeholder';
  res.redirect(buildInstagramBusinessLoginUrl({
    clientId: process.env.INSTAGRAM_APP_ID as string,
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI as string,
    state,
  }));
});

router.get('/instagram/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: oauthState } = req.query as { code: string; state?: string };
  if (!code) throw new AppError('No authorization code received.', 400);

  try {
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.INSTAGRAM_APP_ID!,
        client_secret: process.env.INSTAGRAM_APP_SECRET!,
        grant_type: 'authorization_code',
        redirect_uri: process.env.INSTAGRAM_REDIRECT_URI!,
        code,
      }).toString(),
    });
    if (!tokenRes.ok) throw new AppError('Instagram authentication failed.', 401);
    const tokenData = await tokenRes.json() as { access_token: string; user_id: string };
    const clientUrl = getFrontendUrl();

    let planRedirect = '';
    try {
      const stateParts = oauthState?.split('|');
      if (stateParts && stateParts.length > 1) {
        planRedirect = `&${stateParts[1]}`;
      }
    } catch {}

    res.redirect(`${clientUrl}/dashboard?connected=${tokenData.user_id}${planRedirect}`);
  } catch (error: any) {
    throw new AppError(error.message || 'Instagram authentication failed.', 401);
  }
});

export default router;
