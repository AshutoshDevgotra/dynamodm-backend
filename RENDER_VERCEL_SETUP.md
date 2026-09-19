# Render & Vercel Deployment Setup

## Backend Setup (Render)

### 1. Deploy to Render

```bash
# From your backend directory
git add .
git commit -m "fix: TypeScript errors and field name migration to Instagram OAuth"
git push origin master
```

Render auto-deploys on push to master.

### 2. Set Environment Variables in Render

Go to: https://dashboard.render.com → Your Backend Service → Settings → Environment

Add these variables:

```
NODE_ENV=production
INSTAGRAM_APP_ID=<your_instagram_app_id>
INSTAGRAM_APP_SECRET=<your_instagram_app_secret>
INSTAGRAM_REDIRECT_URI=https://dynamodm-backend.onrender.com/api/instagram/callback
WEBHOOK_VERIFY_TOKEN=<your_random_webhook_token>
FRONTEND_URL=https://dynamodm-frontend.vercel.app
CLIENT_URL=https://dynamodm-frontend.vercel.app
ENCRYPTION_KEY=<your_64_character_hex_key>
MONGODB_URI=<your_mongodb_connection_string>
REDIS_URL=<your_redis_url>
JWT_SECRET=<your_long_random_jwt_secret>
```

**Remove these if present:**
- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI`
- `META_API_VERSION`

### 3. Verify Backend is Live

```bash
curl https://your-backend.onrender.com/health
# Should return: {"status":"ok","timestamp":"..."}
```

---

## Frontend Setup (Vercel)

### 1. Deploy to Vercel

```bash
# From your frontend directory
git add .
git commit -m "feat: Instagram OAuth 2025 integration"
git push origin main
```

Vercel auto-deploys on push to main.

### 2. Set Environment Variables in Vercel

Go to: https://vercel.com/dashboard → Your Frontend Project → Settings → Environment Variables

Add these variables:

```
NEXT_PUBLIC_API_URL=https://dynamodm-backend.onrender.com
NEXT_PUBLIC_INSTAGRAM_APP_ID=<your_instagram_app_id>
NEXT_PUBLIC_FRONTEND_URL=https://dynamodm-frontend.vercel.app
```

### 3. Verify Frontend is Live

```bash
curl https://dynamodm-frontend.vercel.app
# Should return HTML response
```

---

## Instagram App Configuration (Meta Dashboard)

### Go to: https://developers.facebook.com/apps/1065638836355573

### 1. Settings → Basic
- App ID: `1065638836355573`
- App Name: `houseoforange-IG`
- App Type: (leave as is)

Save.

### 2. App Roles → Test Users (or actual users)
- Add test user or use: `algoadjusted` (17841456534142359)

### 3. Instagram Messaging
- **Webhook Callback URL:** `https://your-backend.onrender.com/api/webhooks/instagram`
- **Verify Token:** `<your_random_webhook_token>`
- Click **"Verify and Save"** → Should show ✅ Green

### 4. OAuth Redirect URIs
Under Settings → Basic:
- **Valid OAuth Redirect URIs:**
  ```
  https://dynamodm-backend.onrender.com/api/instagram/callback
  ```
- Save

### 5. Permissions
Enable these permissions:
- [ ] `instagram_business_basic`
- [ ] `instagram_business_manage_messages`
- [ ] `instagram_business_manage_comments`

### 6. Verify Setup
Go to: https://developers.facebook.com/apps/1065638836355573/use_cases/

Should show all steps in green ✅:
- [ ] Step 1: Get App ID — ✅
- [ ] Step 2: Generate token — ✅
- [ ] Step 3: Configure webhooks — ✅

---

## Testing the Full Flow

### 1. Test OAuth Connect Flow

```bash
# Frontend calls this endpoint
curl -X GET "https://your-backend.onrender.com/api/instagram/login" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should return: {"success": true, "data": {"authUrl": "https://www.instagram.com/oauth/..."}}
```

### 2. Manually Trigger OAuth Callback

After user approves:
```bash
curl -X GET "https://your-backend.onrender.com/api/instagram/callback?code=test_code&state=jwt_token"
```

Check database:
```javascript
db.creatoraccounts.findOne({})
// Should have: igUserId, igAccessToken (encrypted), igTokenExpiresAt
```

### 3. Test Webhook Verification

```bash
curl -X GET "https://your-backend.onrender.com/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=<your_random_webhook_token>&hub.challenge=test_challenge_123"

# Should return: test_challenge_123 (HTTP 200)
```

### 4. Test Profile Fetch

```bash
# After connecting, fetch profile
curl -X GET "https://your-backend.onrender.com/api/instagram/status" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should return connected account info
```

---

## Troubleshooting

### "Invalid OAuth Redirect URI"
- Check Render backend URL is correct in Meta Dashboard
- Ensure URL ends with `/api/instagram/callback`
- Webhook URL should end with `/api/webhooks/instagram`

### "Webhook verification failed"
- Check `WEBHOOK_VERIFY_TOKEN` env var matches Meta Dashboard
- Verify backend URL is accessible (not firewalled)
- Check backend logs: `curl https://backend.onrender.com/logs`

### "Token decryption failed"
- Ensure same `ENCRYPTION_KEY` in Render and locally
- Key must be 32-byte hex string
- Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### "Instagram API error: Unsupported get request"
- Check API endpoint URL format
- Ensure long-lived token (not short-lived)
- Token may have expired after 60 days

### Frontend Can't Connect to Backend
- Check `NEXT_PUBLIC_API_URL` env var in Vercel
- Verify backend is live: `curl backend-url/health`
- Check CORS is enabled (should be by default)

---

## Environment Variables Reference

### Backend (Render)

| Variable | Value | Notes |
|----------|-------|-------|
| `INSTAGRAM_APP_ID` | `<your_instagram_app_id>` | Instagram App ID |
| `INSTAGRAM_APP_SECRET` | `<your_instagram_app_secret>` | Keep secret |
| `INSTAGRAM_REDIRECT_URI` | `https://dynamodm-backend.onrender.com/api/instagram/callback` | Must match Meta Dashboard |
| `WEBHOOK_VERIFY_TOKEN` | `<your_random_webhook_token>` | Custom token for webhook verification |
| `FRONTEND_URL` | `https://dynamodm-frontend.vercel.app` | For OAuth redirects |
| `ENCRYPTION_KEY` | `<hex_string_64_chars>` | AES-256-GCM key for token encryption |
| `MONGODB_URI` | `mongodb+srv://...` | MongoDB connection string |
| `REDIS_URL` | `redis://...` | Redis connection (for queues & caching) |
| `JWT_SECRET` | `<long_random_string>` | JWT signing secret |
| `PORT` | `3000` | (Optional, Render sets this) |

### Frontend (Vercel)

| Variable | Value | Public? |
|----------|-------|---------|
| `NEXT_PUBLIC_API_URL` | `https://dynamodm-backend.onrender.com` | Yes (prefixed with `NEXT_PUBLIC_`) |
| `NEXT_PUBLIC_INSTAGRAM_APP_ID` | `<your_instagram_app_id>` | Yes |
| `NEXT_PUBLIC_FRONTEND_URL` | `https://dynamodm-frontend.vercel.app` | Yes |

---

## Monitoring & Debugging

### View Render Logs
```
https://dashboard.render.com → Backend Service → Logs
```

Look for:
- `✅ Instagram webhook verified`
- `🚀 Processing webhook inline`
- `📤 sendInstagramDM called`

### View Vercel Logs
```
https://vercel.com/dashboard → Frontend Project → Deployments → Recent
```

Look for build errors or runtime errors.

### Test Backend Endpoints Directly

```bash
# Health check
curl https://backend.onrender.com/health

# Instagram status (requires auth)
curl -H "Authorization: Bearer TOKEN" \
  https://backend.onrender.com/api/instagram/status

# Webhook verification
curl "https://backend.onrender.com/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=<your_random_webhook_token>&hub.challenge=CHALLENGE"
```

---

## Rollback Plan

If deployment breaks:

### Backend (Render)
1. Go to Render dashboard
2. Click "Manual Deployment" → Select previous working deployment
3. Or: `git revert HEAD && git push origin master`

### Frontend (Vercel)
1. Go to Vercel dashboard
2. Deployments → Select previous working deployment
3. Click "Promote to Production"

---

## Final Checklist

- [ ] Backend deployed to Render
- [ ] Frontend deployed to Vercel
- [ ] All env vars set in both Render and Vercel
- [ ] Backend health check passes: `/health`
- [ ] Webhook verification returns green in Meta Dashboard
- [ ] OAuth flow tested end-to-end
- [ ] DM automation tested
- [ ] Comment automation tested
- [ ] Logs show no errors
- [ ] Tokens are encrypted in database
- [ ] Token expiry set to ~60 days
