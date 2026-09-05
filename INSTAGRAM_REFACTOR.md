# Instagram OAuth 2025 Refactor Guide

## Overview

This document describes the complete refactor from **Facebook Login + Graph API** to **Instagram OAuth 2025 flow** with Instagram API.

### Key Changes

1. **Removed** all Facebook login logic and Graph API code
2. **Replaced** with Instagram native OAuth at `instagram.com/oauth/authorize`
3. **Updated** database model to store Instagram-specific fields
4. **Created** new Instagram service library with clean API
5. **Implemented** Instagram webhook verification and handling
6. **Migrated** all token management and encryption

---

## Environment Setup

### Add These Environment Variables

```bash
# Instagram OAuth (2025 Flow)
INSTAGRAM_APP_ID=1058417440231558
INSTAGRAM_APP_SECRET=02fd5228f3ecce473491b99baf9eac4b  # Reset after testing!
INSTAGRAM_REDIRECT_URI=https://dynamodm-frontend.vercel.app/api/instagram/callback

# Webhooks
WEBHOOK_VERIFY_TOKEN=houseoforange_verify_123

# Frontend URL (used in OAuth callbacks)
FRONTEND_URL=https://dynamodm-frontend.vercel.app

# For local testing with ngrok:
# INSTAGRAM_REDIRECT_URI=http://your-ngrok-url.ngrok.io/api/instagram/callback
# WEBHOOK_VERIFY_TOKEN=houseoforange_verify_123
```

### Update Vercel Deployment

1. Go to Vercel dashboard → Project settings → Environment Variables
2. Update the variables above
3. Redeploy to apply changes

---

## API Endpoints

### Instagram OAuth Flow

```
GET /api/instagram/login
  - Authenticates user via Instagram
  - Redirects to: https://www.instagram.com/oauth/authorize?client_id=...&scope=...

GET /api/instagram/callback
  - Handles OAuth redirect from Instagram
  - Exchanges code → short-lived token → long-lived token
  - Stores in CreatorAccount with encryption
  - Redirects to: /dashboard?connected={username}

GET /api/instagram/status
  - Returns current connection status and profile info
  - Requires authentication

DELETE /api/instagram/disconnect
  - Removes Instagram connection
  - Clears all stored tokens
  - Requires authentication
```

### Webhooks

```
GET /api/webhooks/instagram
  - Webhook verification (required by Meta for setup)
  - Returns hub.challenge if hub.verify_token matches

POST /api/webhooks/instagram
  - Receives real-time events (DMs, comments)
  - Processes automation rules inline
  - Returns 200 immediately
```

---

## Database Schema Changes

### CreatorAccount Model

**Old fields (removed):**
- `instagramBusinessId` → replaced with `igUserId`
- `pageId` → removed (no longer needed)
- `facebookPages` → removed
- `accessToken` → renamed to `igAccessToken`
- `userAccessToken` → removed (no longer needed)
- `tokenExpiry` → renamed to `igTokenExpiresAt`
- `username` → renamed to `igUsername`

**New fields:**
```typescript
igUserId?: string;              // Instagram user ID from OAuth
igUsername?: string;            // Instagram username
igAccessToken?: string;         // Encrypted 60-day token
igTokenExpiresAt?: Date;        // Token expiry
```

---

## Instagram API Endpoints Used

All endpoints use `v23.0` API:

### 1. Get Profile
```
GET https://graph.instagram.com/v23.0/{ig_user_id}
  ?fields=id,username,account_type,followers_count,media_count,biography
  &access_token={long_token}
```

### 2. Get Media
```
GET https://graph.instagram.com/v23.0/{ig_user_id}/media
  ?fields=id,caption,like_count,comments_count
  &access_token={long_token}
```

### 3. Send DM
```
POST https://graph.instagram.com/v23.0/{ig_user_id}/messages
Body: {
  "recipient": { "id": "{recipient_id}" },
  "message": { "text": "{message_text}" }
}
```

### 4. Reply to Comment (Private Message)
```
POST https://graph.instagram.com/v23.0/{ig_user_id}/messages
Body: {
  "recipient": { "comment_id": "{comment_id}" },
  "message": { "text": "{message_text}" }
}
```

---

## Local Testing with ngrok

### 1. Start Local Server
```bash
npm run dev
# Server runs on http://localhost:3001
```

### 2. Expose via ngrok
```bash
ngrok http 3001
# Provides: http://abc123.ngrok.io
```

### 3. Update Meta App Dashboard
1. Go to developers.facebook.com/apps/1065638836355573
2. Settings → Basic
   - Valid OAuth Redirect URIs: `http://abc123.ngrok.io/api/instagram/callback`
3. Instagram Messaging
   - Webhook Callback URL: `http://abc123.ngrok.io/api/webhooks/instagram`
   - Verify Token: `houseoforange_verify_123`
4. Click "Verify and Save"

### 4. Test OAuth Flow
1. Call `GET /api/auth/instagram` (requires Bearer token)
2. Redirects to Instagram login
3. After approval, receives callback at `/api/instagram/callback`
4. Stores token and redirects to dashboard

### 5. Test Webhook Verification
```bash
curl -X GET "http://localhost:3001/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=houseoforange_verify_123&hub.challenge=test_challenge"
```

Expected response: `test_challenge` (HTTP 200)

---

## Deployment to Vercel

### 1. Deploy Backend
```bash
git add .
git commit -m "refactor: switch to Instagram OAuth 2025 flow"
git push origin master
# Vercel auto-deploys
```

### 2. Update Meta App Dashboard for Production
1. Go to developers.facebook.com/apps/1065638836355573
2. Settings → Basic
   - Valid OAuth Redirect URIs: `https://dynamodm-frontend.vercel.app/api/instagram/callback`
3. Instagram Messaging
   - Webhook Callback URL: `https://dynamodm-frontend.vercel.app/api/webhooks/instagram`
   - Verify Token: `houseoforange_verify_123`
4. Click "Verify and Save"

### 3. Verify in Dashboard
1. Go to developers.facebook.com/apps/1065638836355573/use_cases/customize/?use_case_enum=INSTAGRAM_BUSINESS&product_route=instagram-business
2. Check Step 2 "Generate token" ✅ (green)
3. Check Step 3 "Configure webhooks" ✅ (green)

---

## Testing the Integration

### Test Script
```bash
export TEST_IG_USER_ID=17841456534142359
export TEST_IG_USERNAME=algoadjusted
export TEST_IG_ACCESS_TOKEN="your_long_lived_token_here"
export WEBHOOK_VERIFY_TOKEN=houseoforange_verify_123

npx ts-node test-instagram-api.ts
```

### Manual API Tests

#### 1. Get Profile
```bash
curl -X GET "https://graph.instagram.com/v23.0/17841456534142359?fields=username,followers_count&access_token=YOUR_TOKEN"
```

#### 2. Send Test DM (to yourself)
```bash
curl -X POST "https://graph.instagram.com/v23.0/17841456534142359/messages" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": {"id": "17841456534142359"},
    "message": {"text": "Test message from DynamoDM"}
  }' \
  -G -d "access_token=YOUR_TOKEN"
```

#### 3. Verify Webhook
```bash
curl -X GET "http://localhost:3001/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=houseoforange_verify_123&hub.challenge=my_test_challenge"
# Response: my_test_challenge (HTTP 200)
```

---

## Automation Rules

### Comment-to-DM Flow
1. Instagram sends comment webhook
2. `processWebhookEvent()` matches it against active rules
3. If keyword matches, creates a DM job
4. Job calls `sendInstagramDM()` with decrypted token
5. DM sent via Instagram API

### DM-to-Rule Flow
1. Instagram sends message webhook
2. `processWebhookEvent()` matches it against active DM rules
3. If keyword matches, creates a DM response job
4. Job sends automated reply

---

## Migration Checklist

- [ ] Update `.env` with new Instagram credentials
- [ ] Deploy to Vercel
- [ ] Verify webhook "Verify and Save" turns green
- [ ] Test OAuth flow with test account (algoadjusted)
- [ ] Test sending DM to yourself
- [ ] Test comment automation trigger
- [ ] Test DM automation trigger
- [ ] Verify tokens are encrypted in database
- [ ] Check logs for any errors

---

## Troubleshooting

### "No Instagram Business Account found"
- User hasn't created an Instagram Business account
- Instagram account must be linked in Facebook Business Settings

### Webhook not verifying
- Verify token mismatch — check `WEBHOOK_VERIFY_TOKEN` env var
- ngrok URL must be accessible — check ngrok is running
- For Vercel: ensure env vars are set and deployment is complete

### DM fails to send
- Token expired — re-connect to refresh
- Permission missing — re-authenticate with all required scopes
- Invalid recipient — check recipient ID is correct

### Token decryption fails
- `ENCRYPTION_KEY` mismatch between systems
- Ensure same key is used locally and in Vercel

---

## Removed Code

The following files/functions are no longer used and can be deleted:

- `src/modules/automations/meta.ts` (old Facebook OAuth + API)
- `src/modules/automations/pagePublicMetadata.ts` (Facebook Pages metadata)
- Old environment variables: `META_*`, `META_API_VERSION`

---

## API Response Examples

### Success: GET /api/instagram/status
```json
{
  "success": true,
  "data": {
    "account": {
      "igUserId": "17841456534142359",
      "igUsername": "algoadjusted",
      "name": "algoadjusted",
      "followersCount": 1234,
      "isConnected": true,
      "scopes": [
        "instagram_business_basic",
        "instagram_business_manage_messages",
        "instagram_business_manage_comments"
      ],
      "igTokenExpiresAt": "2025-11-05T00:00:00.000Z"
    }
  }
}
```

### Success: POST /api/webhooks/instagram
```
200 OK
EVENT_RECEIVED
```

---

## Notes

- Instagram long-lived tokens expire after **60 days**
- Tokens can be refreshed by re-authenticating
- All tokens are encrypted using `aes-256-gcm` before storage
- Webhook events are processed synchronously after returning 200 to Instagram
- Duplicate comment/DM detection is handled via Redis with 1-hour TTL
- Cooldown per user/rule is 60 minutes to prevent spam
