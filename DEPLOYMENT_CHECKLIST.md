# Instagram OAuth 2025 Deployment Checklist

## Pre-Deployment ✅

### Code Changes
- [x] Instagram service library created (`src/lib/instagram.ts`)
- [x] CreatorAccount model updated with new fields
- [x] Instagram OAuth routes created (`src/modules/oauth/instagram.ts`)
- [x] Instagram webhook routes created (`src/modules/webhooks/instagram.ts`)
- [x] Auth routes updated with Instagram login
- [x] App.ts updated to mount new routes
- [x] RuleEngine updated to use igUserId
- [x] DMEngine updated to use igAccessToken
- [x] All old Facebook/Meta code removed
- [x] Environment variables updated in `.env.example`

### Local Testing
```bash
# 1. Install dependencies
npm install

# 2. Start local server
npm run dev

# 3. In another terminal, expose with ngrok
ngrok http 3001

# 4. Update Meta App Dashboard with ngrok URL

# 5. Test OAuth callback
curl -X GET "http://localhost:3001/api/instagram/callback?code=test&state=test"

# 6. Test webhook verification
curl -X GET "http://localhost:3001/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=houseoforange_verify_123&hub.challenge=test"
```

## Pre-Deployment Env Vars Check ✅

### Required in Vercel Settings

```
INSTAGRAM_APP_ID=1058417440231558
INSTAGRAM_APP_SECRET=02fd5228f3ecce473491b99baf9eac4b
INSTAGRAM_REDIRECT_URI=https://dynamodm-frontend.vercel.app/api/instagram/callback
WEBHOOK_VERIFY_TOKEN=houseoforange_verify_123
FRONTEND_URL=https://dynamodm-frontend.vercel.app
ENCRYPTION_KEY=<your_32_char_hex_key>
```

### Verify these are NOT present
```
META_APP_ID     ❌ Remove
META_APP_SECRET ❌ Remove
META_REDIRECT_URI ❌ Remove
META_API_VERSION ❌ Remove
```

## Deployment Steps

### Step 1: Deploy Backend to Vercel
```bash
git add .
git commit -m "refactor: Instagram OAuth 2025 - complete backend migration"
git push origin master
# Vercel auto-deploys — monitor deployment
```

### Step 2: Verify Backend is Live
```bash
curl https://dynamodm-backend.vercel.app/health
# Should return: {"status":"ok","timestamp":"..."}
```

### Step 3: Update Meta App Dashboard

Go to: https://developers.facebook.com/apps/1065638836355573/settings/basic

**Basic Settings:**
- App ID: `1065638836355573`
- App Secret: `<hidden>`

**Valid OAuth Redirect URIs:**
```
https://dynamodm-frontend.vercel.app/api/instagram/callback
```

Save changes.

### Step 4: Configure Instagram Webhooks

Go to: https://developers.facebook.com/apps/1065638836355573/instagram-basic-display

**Webhooks:**
- Webhook Callback URL: `https://dynamodm-backend.vercel.app/api/webhooks/instagram`
- Verify Token: `houseoforange_verify_123`

Click "Verify and Save"

### Step 5: Enable Messaging Permissions

Go to: https://developers.facebook.com/apps/1065638836355573

Check that these permissions are enabled:
- [ ] `instagram_business_basic`
- [ ] `instagram_business_manage_messages`
- [ ] `instagram_business_manage_comments`

### Step 6: Verify Dashboard Shows Green Checks

Go to: https://developers.facebook.com/apps/1065638836355573/use_cases/customize/?use_case_enum=INSTAGRAM_BUSINESS&product_route=instagram-business

- [ ] Step 1: "Get App ID" — ✅ Green
- [ ] Step 2: "Generate token" — ✅ Green
- [ ] Step 3: "Configure webhooks" — ✅ Green

If any are red, check logs and error messages.

### Step 7: Test Real OAuth Flow

1. Go to frontend: https://dynamodm-frontend.vercel.app
2. Click "Connect Instagram"
3. Should redirect to Instagram login
4. After approval, should redirect to dashboard with `?connected=algoadjusted`
5. Check database: CreatorAccount should have new records with:
   - `igUserId`: "17841456534142359"
   - `igUsername`: "algoadjusted"
   - `isConnected`: true
   - `igAccessToken`: (encrypted token)
   - `igTokenExpiresAt`: (future date)

### Step 8: Test Webhook Delivery

1. Go to https://developers.facebook.com/apps/1065638836355573/webhooks
2. Click "Test Webhook" or send a test event
3. Check logs for webhook reception

### Step 9: Test DM Sending

1. Create an automation rule: Comment → Send DM
2. Comment on a test post
3. Automation should trigger and send DM
4. Check DM received in Instagram

## Post-Deployment Verification

### Database Checks
```
# MongoDB queries
db.creatoraccounts.findOne({igUserId: "17841456534142359"})
# Should show:
# - igAccessToken: encrypted
# - igTokenExpiresAt: future date
# - isConnected: true
```

### Logs to Monitor
```
# Vercel logs should show:
✅ Instagram webhook verified
✅ Webhook signature verified
✅ DM sent successfully
📡 Sending DM via Instagram API
```

### Error Indicators
```
❌ Invalid webhook signature
❌ Token decryption failed
❌ Instagram API error
❌ Creator has no connected account
```

## Rollback Plan

If deployment fails:

```bash
# Revert to previous commit
git revert HEAD
git push origin master
# Vercel auto-redeploys

# Or restore from git
git reset --hard <previous-commit-hash>
git push -f origin master
```

## Performance Checklist

- [ ] DM jobs queued correctly (check Bull queue)
- [ ] Webhook processing < 1s
- [ ] Token encryption/decryption working
- [ ] No memory leaks (check process memory)
- [ ] Rate limiting active (10 req/min per IP)

## Security Checklist

- [x] All tokens encrypted before storage
- [x] No plaintext tokens in logs
- [x] Webhook signature verification enabled
- [x] Environment secrets in Vercel (not in code)
- [x] HTTPS only for production URLs
- [x] Token refresh before 60-day expiry

## Communication

After successful deployment, inform:
- [ ] Frontend team: Instagram login ready
- [ ] Users: Can now connect via Instagram
- [ ] Support: Document new flow for help requests

## Monitoring Dashboard

Set up alerts for:
- [ ] Webhook verification failures
- [ ] DM send failures (> 5% failure rate)
- [ ] Token expiry approaching (notify users to reconnect)
- [ ] API rate limit approaching
