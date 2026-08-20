import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';

import { User, IUser } from '../../models/User';
import { Subscription } from '../../models/Subscription';
import { Brand } from '../../models/Brand';
import { generateToken, authenticate, AuthRequest } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimiter';
import { AppError } from '../../middleware/errorHandler';
import { connectDB } from '../../config/database';
import nodemailer from 'nodemailer';

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

const createSignupRecords = async (data: { name: string; email: string; password?: string; role: 'CREATOR' | 'BRAND'; googleId?: string; avatar?: string }) => {
  const user = await User.create({ ...data, isVerified: true });
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
    const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
    res.status(201).json({ success: true, message: 'Account created successfully.', data: { token, user: safeUser(user) } });
  } catch (error: any) {
    if (error?.code === 11000) throw new AppError('Email already registered.', 409);
    throw error;
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response): Promise<void> => {
  let step = 'entry';
  try {
    // #region agent log
    fetch('http://127.0.0.1:7811/ingest/f30bae55-2bf1-4e72-b7d4-c3f427538ba8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5bf7a1'},body:JSON.stringify({sessionId:'5bf7a1',runId:'pre-fix',hypothesisId:'E',location:'auth.ts:login:entry',message:'login hit',data:{mongoState:mongoose.connection.readyState,bodyType:typeof req.body,hasBody:!!req.body,keys:req.body?Object.keys(req.body):[],emailType:typeof req.body?.email,passwordLen:typeof req.body?.password==='string'?req.body.password.length:null,jwtExpiresIn:process.env.JWT_EXPIRES_IN||null,jwtSecretLen:(process.env.JWT_SECRET||'').length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!email || !password) throw new AppError('Email and password are required.', 400);
    step = 'findUser';
    const user = await User.findOne({ email }).select('+password');
    // #region agent log
    fetch('http://127.0.0.1:7811/ingest/f30bae55-2bf1-4e72-b7d4-c3f427538ba8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5bf7a1'},body:JSON.stringify({sessionId:'5bf7a1',runId:'pre-fix',hypothesisId:'B',location:'auth.ts:login:findUser',message:'user lookup result',data:{found:!!user,hasPassword:!!user?.password,hashPrefix:typeof user?.password==='string'?user.password.slice(0,4):null,hasCompare:typeof user?.comparePassword,isActive:user?.isActive,role:user?.role||null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!user || !user.password) throw new AppError('Invalid credentials.', 401);
    if (!user.isActive) throw new AppError('Account suspended. Contact support.', 403);
    step = 'comparePassword';
    const passwordMatch = await user.comparePassword(password);
    // #region agent log
    fetch('http://127.0.0.1:7811/ingest/f30bae55-2bf1-4e72-b7d4-c3f427538ba8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5bf7a1'},body:JSON.stringify({sessionId:'5bf7a1',runId:'pre-fix',hypothesisId:'C',location:'auth.ts:login:compare',message:'password compare finished',data:{passwordMatch},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!passwordMatch) throw new AppError('Invalid credentials.', 401);
    step = 'generateToken';
    const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
    // #region agent log
    fetch('http://127.0.0.1:7811/ingest/f30bae55-2bf1-4e72-b7d4-c3f427538ba8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5bf7a1'},body:JSON.stringify({sessionId:'5bf7a1',runId:'pre-fix',hypothesisId:'A',location:'auth.ts:login:token',message:'token generated',data:{tokenLen:token.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    res.json({ success: true, data: { token, user: safeUser(user) } });
  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7811/ingest/f30bae55-2bf1-4e72-b7d4-c3f427538ba8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5bf7a1'},body:JSON.stringify({sessionId:'5bf7a1',runId:'pre-fix',hypothesisId:'A',location:'auth.ts:login:catch',message:'login threw',data:{step,name:error?.name,errMessage:error?.message,status:error?.status,statusCode:error?.statusCode,isOperational:error?.isOperational},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw error;
  }
});

router.post('/forgot-password', authLimiter, async (req: Request, res: Response): Promise<void> => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const user = await User.findOne({ email });
  if (!user) { res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' }); return; }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.EMAIL_FROM) {
    throw new AppError('Password reset email is not configured.', 503);
  }
  const token = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  user.resetPasswordExpiry = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateBeforeSave: false });
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}`;
  await transporter.sendMail({ from: process.env.EMAIL_FROM, to: user.email, subject: 'DynamoDM — Password Reset', html: `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>Expires in 30 minutes.</p>` });
  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
});

router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body;
  if (!token || typeof password !== 'string' || password.length < 8) throw new AppError('Token and a password of at least 8 characters are required.', 400);
  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({ resetPasswordToken: hashed, resetPasswordExpiry: { $gt: Date.now() } }).select('+resetPasswordToken +resetPasswordExpiry +password');
  if (!user) throw new AppError('Invalid or expired reset token.', 400);
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

router.get('/google', (_req: Request, res: Response): void => {
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID as string, redirect_uri: process.env.GOOGLE_CALLBACK_URL as string, response_type: 'code', scope: 'profile email', access_type: 'offline' });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.query as { code: string };
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
  if (existingUser && !existingUser.googleId) { existingUser.googleId = profile.id; if (!existingUser.avatar) existingUser.avatar = profile.picture; await existingUser.save({ validateBeforeSave: false }); }
  const token = generateToken({ id: user._id.toString(), role: user.role, email: user.email });
  const clientUrl = process.env.NODE_ENV === 'production' && (!process.env.CLIENT_URL || process.env.CLIENT_URL.includes('localhost'))
    ? 'https://dynamodm-frontend.vercel.app'
    : process.env.CLIENT_URL;
  res.redirect(`${clientUrl}/creator?token=${token}`);
});

export default router;
