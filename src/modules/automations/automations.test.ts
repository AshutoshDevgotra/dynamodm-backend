jest.mock('../../middleware/auth', () => ({ authenticate: jest.fn(), requireActiveSubscription: jest.fn() }));
jest.mock('../../models/AutomationRule', () => ({ Automation: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/CreatorAccount', () => ({ CreatorAccount: { findOne: jest.fn() } }));
jest.mock('../../models/Subscription', () => ({ Subscription: { findOne: jest.fn() } }));

import router from './automations';
import { Automation } from '../../models/AutomationRule';
import { CreatorAccount } from '../../models/CreatorAccount';
import { Subscription } from '../../models/Subscription';

const findAutomation = Automation.findOne as jest.Mock;
const updateAutomation = Automation.findOneAndUpdate as jest.Mock;
const findAccount = CreatorAccount.findOne as jest.Mock;
const findSubscription = Subscription.findOne as jest.Mock;
const countAutomations = Automation.countDocuments as jest.Mock;
const createAutomation = Automation.create as jest.Mock;

function handler(method: string, path: string): (req: any, res: any) => Promise<void> {
  const layer = (router as any).stack.find((item: any) => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack[0].handle;
}

const response = () => {
  const res: any = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const payload = { triggerType: 'dm', keyword: 'hello', responseMessage: 'Hi' };
const request = () => ({ user: { id: 'user-1', role: 'CREATOR' }, params: { id: 'rule-2' }, body: payload });

describe('automation account binding', () => {
  const rule = () => ({ _id: 'rule-2', instagramAccountId: 'account-2', instagramUserId: 'ig-2', isActive: true, save: jest.fn().mockResolvedValue(undefined) });

  beforeEach(() => jest.resetAllMocks());

  it.each([['get', '/:id'], ['put', '/:id'], ['patch', '/:id/toggle']])(
    '%s resolves the owned rule using its bound account', async (method, path) => {
      const automation = rule();
      findAutomation.mockResolvedValue(automation);
      findAccount.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'account-2' }) });
      updateAutomation.mockResolvedValue(automation);
      const res = response();
      await handler(method, path)(request(), res);
      expect(findAutomation).toHaveBeenCalledWith({ _id: 'rule-2', creatorId: 'user-1' });
      expect(findAccount).toHaveBeenCalledWith({ _id: 'account-2', userId: 'user-1', isConnected: true, igUserId: 'ig-2' });
      expect(res.json).toHaveBeenCalled();
      if (method === 'put') {
        expect(updateAutomation.mock.calls[0][0]).toEqual({ _id: 'rule-2', creatorId: 'user-1', instagramAccountId: 'account-2', instagramUserId: 'ig-2' });
        expect(updateAutomation.mock.calls[0][1].$set).not.toHaveProperty('instagramAccountId');
      }
      if (method === 'patch') expect(automation.save).toHaveBeenCalled();
    },
  );

  it.each([['get', '/:id'], ['put', '/:id'], ['patch', '/:id/toggle']])(
    '%s rejects a disconnected, mismatched, or unowned bound account', async (method, path) => {
      const automation = rule();
      findAutomation.mockResolvedValue(automation);
      findAccount.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
      await expect(handler(method, path)(request(), response())).rejects.toMatchObject({ statusCode: 404 });
      expect(updateAutomation).not.toHaveBeenCalled();
      expect(automation.save).not.toHaveBeenCalled();
    },
  );

  it('rejects another user’s rule without looking up its account', async () => {
    findAutomation.mockResolvedValue(null);
    await expect(handler('get', '/:id')(request(), response())).rejects.toMatchObject({ statusCode: 404 });
    expect(findAccount).not.toHaveBeenCalled();
  });

  it.each([{ instagramAccountId: undefined, instagramUserId: 'ig-2' }, { instagramAccountId: 'account-2', instagramUserId: undefined }])(
    'rejects an incomplete rule binding', async (binding) => {
      findAutomation.mockResolvedValue({ ...rule(), ...binding });
      await expect(handler('get', '/:id')(request(), response())).rejects.toMatchObject({ statusCode: 404 });
      expect(findAccount).not.toHaveBeenCalled();
    },
  );
});

describe('automation creation limits', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findAccount.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'account-2', igUserId: 'ig-2', igUsername: 'example' }) });
    findSubscription.mockResolvedValue({ plan: 'starter', status: 'trialing' });
    countAutomations.mockResolvedValue(2);
    createAutomation.mockImplementation(async (data: any) => data);
  });

  it('uses a trialing subscription plan instead of the free limit', async () => {
    const res = response();
    await handler('post', '/')(request(), res);
    expect(findSubscription).toHaveBeenCalledWith({ userId: 'user-1', status: { $in: ['active', 'trialing'] } });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('enforces the trial plan limit for ordinary members', async () => {
    countAutomations.mockResolvedValue(3);
    await expect(handler('post', '/')(request(), response())).rejects.toMatchObject({ statusCode: 403 });
    expect(createAutomation).not.toHaveBeenCalled();
  });

  it('allows a verified House of Orange member past the limit on their owned account', async () => {
    countAutomations.mockResolvedValue(100);
    const req: any = request();
    req.user.isHouseOfOrange = true;
    req.body = { ...payload, instagramAccountId: 'account-2' };
    await handler('post', '/')(req, response());
    expect(findAccount).toHaveBeenCalledWith({ _id: 'account-2', userId: 'user-1', isConnected: true });
    expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({ creatorId: 'user-1', instagramAccountId: 'account-2' }));
  });

  it('does not allow members to create on an unowned account', async () => {
    findAccount.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const req: any = request();
    req.user.isHouseOfOrange = true;
    req.body = { ...payload, instagramAccountId: 'other-account' };
    await expect(handler('post', '/')(req, response())).rejects.toMatchObject({ statusCode: 409 });
    expect(findAccount).toHaveBeenCalledWith({ _id: 'other-account', userId: 'user-1', isConnected: true });
    expect(createAutomation).not.toHaveBeenCalled();
  });
});
