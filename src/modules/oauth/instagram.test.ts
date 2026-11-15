jest.mock('../../middleware/auth', () => ({
  authenticate: jest.fn(),
  requireActiveSubscription: jest.fn(),
}));
jest.mock('../../models/CreatorAccount', () => ({
  CreatorAccount: { findOne: jest.fn(), countDocuments: jest.fn(), updateMany: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../lib/instagram', () => ({
  exchangeCodeForToken: jest.fn(), exchangeToLongLivedToken: jest.fn(), getProfile: jest.fn(), getMedia: jest.fn(),
}));
jest.mock('axios');

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import router from './instagram';
import { authenticate, requireActiveSubscription } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';
import { exchangeCodeForToken, exchangeToLongLivedToken, getProfile, getMedia } from '../../lib/instagram';

const userId = '64b000000000000000000001';
const accountId = '64b000000000000000000002';
const otherId = '64b000000000000000000003';
const findOne = CreatorAccount.findOne as jest.Mock;
const count = CreatorAccount.countDocuments as jest.Mock;
const updateMany = CreatorAccount.updateMany as jest.Mock;
const updateAccount = CreatorAccount.findOneAndUpdate as jest.Mock;
let user: any;
let subscription: any;

function handler(path: string, method: string): any {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function response(): any {
  const res: any = { status: jest.fn(), send: jest.fn(), json: jest.fn(), redirect: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
function state(member = false): string {
  return jwt.sign({ sub: userId, purpose: 'instagram_oauth', wasHouseOfOrange: member }, process.env.JWT_SECRET!);
}

describe('Instagram OAuth and account selection', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    user = { id: userId, role: 'CREATOR', isHouseOfOrange: true };
    subscription = undefined;
    (authenticate as jest.Mock).mockImplementation(async (req, _res, next) => { req.user = user; next(); });
    (requireActiveSubscription as jest.Mock).mockImplementation(async (req, _res, next) => { req.subscription = subscription; next(); });
    (exchangeCodeForToken as jest.Mock).mockResolvedValue({ access_token: 'short', user_id: 'ig1' });
    (exchangeToLongLivedToken as jest.Mock).mockResolvedValue({ access_token: 'long' });
    (getProfile as jest.Mock).mockResolvedValue({ user_id: 'ig1', username: 'test' });
    (axios.post as jest.Mock).mockResolvedValue({ data: {} });
    count.mockResolvedValue(5);
    findOne.mockResolvedValue(null);
    updateMany.mockResolvedValue({});
    updateAccount.mockResolvedValue({});
  });

  it('rejects a sixth member account before modifying other users records', async () => {
    const res = response();
    await handler('/callback', 'get')({ query: { code: 'code', state: state(true) } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(updateMany).not.toHaveBeenCalled();
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it('allows an already connected account to reconnect at the limit', async () => {
    findOne.mockResolvedValue({ isConnected: true });
    const res = response();
    await handler('/callback', 'get')({ query: { code: 'code', state: state(true) } }, res);
    expect(updateAccount).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalled();
  });

  it('rejects revoked membership even if a subscription remains', async () => {
    user.isHouseOfOrange = false;
    subscription = { status: 'active', features: { instagramAccountsLimit: 5 } };
    const res = response();
    await handler('/callback', 'get')({ query: { code: 'code', state: state(true) } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(exchangeCodeForToken).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a user suspended during the OAuth exchange', async () => {
    (authenticate as jest.Mock)
      .mockImplementationOnce(async (req, _res, next) => { req.user = user; next(); })
      .mockImplementationOnce(async (_req, res) => { res.status(401).json({ message: 'User suspended.' }); });
    const res = response();
    await handler('/callback', 'get')({ query: { code: 'code', state: state(true) } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('uses trialing subscription limits and allows admins unlimited accounts', async () => {
    user.isHouseOfOrange = false;
    subscription = { status: 'trialing', plan: 'starter', features: { instagramAccountsLimit: 5 } };
    let res = response();
    await handler('/callback', 'get')({ query: { code: 'code', state: state() } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    user.role = 'ADMIN';
    res = response();
    await handler('/callback', 'get')({ query: { code: 'code', state: state() } }, res);
    expect(res.redirect).toHaveBeenCalled();
  });

  it('reports media API failures instead of returning an empty success', async () => {
    const key = Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = cipher.update('token', 'utf8', 'hex') + cipher.final('hex');
    const token = `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
    findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ igUserId: 'ig1', igAccessToken: token }) });
    (getMedia as jest.Mock).mockRejectedValue(new Error('Graph unavailable'));
    const res = response();
    await expect(handler('/posts', 'get')({ user: { id: userId }, query: { instagramAccountId: accountId } }, res)).rejects.toMatchObject({ statusCode: 502 });
    expect(res.json).not.toHaveBeenCalled();
  });

  it('selects only the requested account owned by the user for posts and disconnect', async () => {
    findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    await expect(handler('/posts', 'get')({ user: { id: userId }, query: { instagramAccountId: otherId } }, response())).rejects.toMatchObject({ statusCode: 404 });
    expect(findOne).toHaveBeenCalledWith({ userId, isConnected: true, _id: otherId });
    expect(getMedia).not.toHaveBeenCalled();
    await handler('/disconnect', 'delete')({ user: { id: userId }, query: { instagramAccountId: accountId } }, response());
    expect(updateAccount.mock.calls[0][0]).toEqual({ userId, isConnected: true, _id: accountId });
  });
});
