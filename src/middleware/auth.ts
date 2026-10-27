import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Subscription } from '../models/Subscription';
import { hasUnlimitedAccess } from '../config/access';

export type AuthRequest = any;

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    // Never accept bearer tokens in URLs or cookies. URLs are routinely copied
    // into browser history, proxy logs, analytics, and referrer headers; a
    // cookie fallback would also make state-changing routes CSRF-prone.
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    if (!token) {
      res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string; role: string; email: string };
    const user = await User.findById(decoded.id).select('_id role email isActive');

    if (!user || !user.isActive) {
      res.status(401).json({ success: false, message: 'User not found or account suspended.' });
      return;
    }

    req.user = { id: user._id.toString(), role: user.role, email: user.email };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

/**
 * Middleware: Ensures the user has an ACTIVE paid subscription.
 * Free-tier (no subscription or status !== 'active') users are blocked with HTTP 402.
 * Attach this after `authenticate` on paid-only routes.
 */
export const requireSubscription = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (hasUnlimitedAccess(req.user)) { next(); return; }
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  if (!subscription || subscription.status !== 'active') {
    res.status(402).json({
      success: false,
      message: 'Active subscription required. Please upgrade your plan to access this feature.',
      code: 'SUBSCRIPTION_REQUIRED',
    });
    return;
  }
  req.subscription = subscription;
  next();
};

export const requirePaidSubscription = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (hasUnlimitedAccess(req.user)) { next(); return; }
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  const validUntil = subscription?.currentPeriodEnd && subscription.currentPeriodEnd.getTime() > Date.now();
  const paid = subscription && ['starter', 'pro', 'premium', 'enterprise'].includes(subscription.plan) && subscription.status === 'active' && (!subscription.currentPeriodEnd || validUntil);
  if (!paid) {
    res.status(402).json({
      success: false,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'An active paid subscription is required to use this feature.',
      data: { redirect: '/creator/payments/subscriptions' },
    });
    return;
  }
  req.subscription = subscription;
  next();
};

/** Allows the active Free workspace as well as paid plans. */
export const requireActiveSubscription = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (hasUnlimitedAccess(req.user)) { next(); return; }
  const subscription = await Subscription.findOne({ userId: req.user!.id });
  const validUntil = subscription?.currentPeriodEnd && subscription.currentPeriodEnd.getTime() > Date.now();
  const active = subscription && subscription.status === 'active' && (!subscription.currentPeriodEnd || validUntil);
  if (!active) {
    res.status(402).json({
      success: false,
      code: 'SUBSCRIPTION_REQUIRED',
      message: 'Your free trial or subscription has ended. Please upgrade your plan to continue.',
      data: { redirect: '/creator/payments/subscriptions?reason=trial_expired' },
    });
    return;
  }
  req.subscription = subscription;
  next();
};

export const requireRole = (...roles: string[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.role?.toUpperCase();
    const normalizedRoles = roles.map((r) => r.toUpperCase());
    if (!userRole || !normalizedRoles.includes(userRole)) {
      res.status(403).json({ success: false, message: 'Insufficient permissions.' });
      return;
    }
    next();
  };

export const generateToken = (payload: { id: string; role: string; email: string }): string => {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  } as jwt.SignOptions);
};
