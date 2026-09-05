# Instagram API Library Reference

## Quick Start

### Import
```typescript
import {
  exchangeCodeForToken,
  exchangeToLongLivedToken,
  getProfile,
  getMedia,
  sendDM,
  privateReplyToComment,
} from '../lib/instagram';
```

### Token Flow
```typescript
// 1. Get short-lived token from OAuth code
const shortLived = await exchangeCodeForToken(
  code,
  process.env.INSTAGRAM_APP_ID,
  process.env.INSTAGRAM_APP_SECRET,
  process.env.INSTAGRAM_REDIRECT_URI
);
// Returns: { access_token, user_id, token_type }

// 2. Exchange for long-lived (60 days)
const longLived = await exchangeToLongLivedToken(
  shortLived.access_token,
  process.env.INSTAGRAM_APP_SECRET
);
// Returns: { access_token, token_type, expires_in }

// 3. Store encrypted token
const encryptedToken = encryptToken(longLived.access_token);
```

---

## API Functions

### `exchangeCodeForToken()`

Exchanges authorization code for short-lived access token.

**Parameters:**
- `code: string` — Authorization code from Instagram redirect
- `clientId: string` — Instagram App ID
- `clientSecret: string` — Instagram App Secret
- `redirectUri: string` — Exact redirect URI used in OAuth flow

**Returns:**
```typescript
{
  access_token: string;
  user_id: string;
  token_type: "bearer";
}
```

**Throws:** Error with Instagram API message if code invalid/expired

**Example:**
```typescript
try {
  const token = await exchangeCodeForToken(
    req.query.code,
    '1058417440231558',
    'secret123',
    'https://example.com/api/instagram/callback'
  );
  console.log(`Got token for IG user: ${token.user_id}`);
} catch (err) {
  console.error(`OAuth failed: ${err.message}`);
}
```

---

### `exchangeToLongLivedToken()`

Exchanges short-lived token for long-lived token (60-day expiry).

**Parameters:**
- `shortLivedToken: string` — Short-lived token from `exchangeCodeForToken()`
- `clientSecret: string` — Instagram App Secret

**Returns:**
```typescript
{
  access_token: string;
  token_type: "bearer";
  expires_in?: number; // seconds until expiry
}
```

**Throws:** Error if short-lived token expired or invalid

**Example:**
```typescript
const longLived = await exchangeToLongLivedToken(
  shortToken,
  'secret123'
);
const expiryDate = new Date(Date.now() + longLived.expires_in * 1000);
console.log(`Token expires: ${expiryDate.toISOString()}`);
```

**Note:** Long-lived tokens typically expire after 60 days. Users must re-authenticate to refresh.

---

### `getProfile()`

Fetches Instagram user profile information.

**Parameters:**
- `igUserId: string` — Instagram user ID (from OAuth or webhook)
- `accessToken: string` — Long-lived access token (decrypted)

**Returns:**
```typescript
{
  id: string;
  username: string;
  account_type: string; // "PERSONAL" | "BUSINESS" | "CREATOR"
  followers_count: number;
  media_count: number;
  biography: string;
}
```

**Throws:** Error if token invalid or user doesn't exist

**Example:**
```typescript
const profile = await getProfile(
  '17841456534142359',
  decryptedToken
);
console.log(`@${profile.username} has ${profile.followers_count} followers`);
```

**Fields Included:**
- `id` — Unique Instagram user ID
- `username` — Instagram handle (without @)
- `account_type` — Type of account
- `followers_count` — Public follower count
- `media_count` — Total posts
- `biography` — Bio text (250 chars max)

**Note:** Does NOT include gender, location, email (Meta never provides these)

---

### `getMedia()`

Fetches recent media (posts/stories/reels) for a user.

**Parameters:**
- `igUserId: string` — Instagram user ID
- `accessToken: string` — Long-lived access token (decrypted)
- `limit?: number` — Max items to return (default 30, max 100)

**Returns:**
```typescript
Array<{
  id: string;
  caption?: string;
  like_count: number;
  comments_count: number;
  timestamp?: string; // ISO string
  media_type?: string; // "IMAGE" | "VIDEO" | "CAROUSEL" | "STORY" | "REEL"
}>
```

**Throws:** Error if token invalid or user doesn't exist

**Example:**
```typescript
const posts = await getMedia('17841456534142359', decryptedToken, 10);
posts.forEach(post => {
  console.log(`${post.caption} — ${post.like_count} likes`);
});
```

---

### `sendDM()`

Sends a direct message to an Instagram user.

**Parameters:**
- `igUserId: string` — Sender's Instagram user ID
- `recipientId: string` — Recipient's Instagram user ID
- `message: string` — Message text (no special formatting)
- `accessToken: string` — Long-lived access token (decrypted)

**Returns:**
```typescript
{
  mid: string; // Message ID
}
```

**Throws:** Error if:
- Token invalid/expired
- Recipient doesn't exist
- Sender doesn't have messaging permission
- Message contains prohibited content

**Example:**
```typescript
try {
  const result = await sendDM(
    '17841456534142359', // sender
    '12345678', // recipient
    'Hey! Check out this amazing product 🚀',
    decryptedToken
  );
  console.log(`Message sent: ${result.mid}`);
} catch (err) {
  console.error(`DM failed: ${err.message}`);
  // Handle: token expired, user blocked, etc.
}
```

**Constraints:**
- Message max 1000 characters
- Can only send if recipient has messaged you first OR you're a business account
- May fail if recipient has messaging turned off
- Consider adding delay between messages (rate limiting)

---

### `privateReplyToComment()`

Sends a private reply to a comment (only visible to commenter).

**Parameters:**
- `igUserId: string` — Instagram Business Account user ID
- `commentId: string` — Comment ID from webhook
- `message: string` — Reply text
- `accessToken: string` — Long-lived access token (decrypted)

**Returns:**
```typescript
{
  mid: string; // Message ID
}
```

**Throws:** Error if:
- Comment ID invalid
- Business account doesn't have permission
- User has disabled comment replies

**Example:**
```typescript
// In webhook handler for comments
const reply = await privateReplyToComment(
  '17841456534142359',
  'comment_id_12345',
  'Thanks for your interest! DM for more info.',
  decryptedToken
);
console.log(`Private reply sent: ${reply.mid}`);
```

**Use Cases:**
- Reply to comment without public thread
- Automated comment response flow
- Lead qualification (ask questions privately)
- Reduce public clutter on posts

---

## Error Handling

All functions throw errors with these properties:

```typescript
interface InstagramError extends Error {
  message: string;     // Human-readable error from Instagram
  status?: number;     // HTTP status (401, 400, 429, 500)
  code?: string;       // Instagram error code (#17 = invalid token)
  subcode?: string;    // Additional error detail
}
```

**Common Errors:**

| Status | Message | Cause | Solution |
|--------|---------|-------|----------|
| 401 | `Invalid OAuth access token` | Token expired | User must re-authenticate |
| 400 | `(#100) Unsupported get request` | Wrong endpoint | Check API URL |
| 400 | `(#200) Permissions error` | Missing scope | Re-request with `instagram_business_manage_messages` |
| 429 | Rate limit | Too many requests | Add exponential backoff |
| 500 | Server error | Instagram API down | Retry with exponential backoff |

**Example Error Handling:**
```typescript
try {
  await sendDM(igUserId, recipientId, message, token);
} catch (err: any) {
  if (err.status === 401) {
    // Token expired — notify user to reconnect
    await User.findByIdAndUpdate(userId, { instagramConnected: false });
  } else if (err.status === 429) {
    // Rate limited — retry after delay
    setTimeout(() => retry(), 5000);
  } else {
    // Other error — log and skip
    logger.error(`DM failed: ${err.message}`);
  }
}
```

---

## Token Management

### Encryption (in `src/modules/oauth/instagram.ts`)

```typescript
import { encryptToken, decryptToken } from '../modules/oauth/instagram';

// Store
const encrypted = encryptToken(longLivedToken);
await CreatorAccount.updateOne({ userId }, { igAccessToken: encrypted });

// Retrieve
const account = await CreatorAccount.findOne({ userId }).select('+igAccessToken');
const token = decryptToken(account.igAccessToken);
await sendDM(igUserId, recipientId, message, token);
```

**Algorithm:** AES-256-GCM (authenticated encryption)
**Key:** `process.env.ENCRYPTION_KEY` (32-byte hex string)

### Token Lifecycle

```
1. User clicks "Connect Instagram"
   ↓
2. OAuth → short-lived token (1 hour)
   ↓
3. Exchange → long-lived token (60 days)
   ↓
4. Store encrypted in database
   ↓
5. Retrieve & decrypt when needed
   ↓
6. Token expires after 60 days
   ↓
7. User must reconnect to refresh
```

**Expiry Check:**
```typescript
const account = await CreatorAccount.findOne({ userId });
if (new Date() > account.igTokenExpiresAt) {
  // Token expired — prompt user to reconnect
  console.log('Token expired, please reconnect');
  await CreatorAccount.updateOne({ userId }, { isConnected: false });
}
```

---

## Usage Patterns

### OAuth Flow (in routes)
```typescript
import { exchangeCodeForToken, exchangeToLongLivedToken, getProfile } from '../lib/instagram';
import { encryptToken } from '../modules/oauth/instagram';

router.get('/callback', async (req, res) => {
  const code = req.query.code;
  
  // Step 1: Get short-lived token
  const shortLived = await exchangeCodeForToken(
    code,
    process.env.INSTAGRAM_APP_ID,
    process.env.INSTAGRAM_APP_SECRET,
    process.env.INSTAGRAM_REDIRECT_URI
  );
  
  // Step 2: Exchange to long-lived
  const longLived = await exchangeToLongLivedToken(
    shortLived.access_token,
    process.env.INSTAGRAM_APP_SECRET
  );
  
  // Step 3: Get profile
  const profile = await getProfile(shortLived.user_id, longLived.access_token);
  
  // Step 4: Store encrypted
  const encrypted = encryptToken(longLived.access_token);
  const expiry = new Date(Date.now() + (longLived.expires_in || 60*60*24*60) * 1000);
  
  await CreatorAccount.findOneAndUpdate(
    { userId },
    {
      igUserId: shortLived.user_id,
      igUsername: profile.username,
      igAccessToken: encrypted,
      igTokenExpiresAt: expiry,
      isConnected: true,
    },
    { upsert: true, new: true }
  );
  
  res.redirect(`/dashboard?connected=${profile.username}`);
});
```

### DM Sending (in automation)
```typescript
import { decryptToken } from '../modules/oauth/instagram';
import { sendDM } from '../lib/instagram';

export async function sendInstagramDM(data: DMJobData) {
  const { creatorId, igUserId, recipientId, message } = data;
  
  // Get token
  const account = await CreatorAccount.findOne(
    { userId: creatorId, isConnected: true }
  ).select('+igAccessToken');
  
  if (!account?.igAccessToken) {
    throw new Error('Not connected to Instagram');
  }
  
  // Decrypt
  const token = decryptToken(account.igAccessToken);
  
  // Send
  await sendDM(igUserId, recipientId, message, token);
  
  // Log
  await DMLog.findByIdAndUpdate(dmLogId, { status: 'sent' });
}
```

---

## Rate Limiting

Instagram applies rate limits:
- **150 requests/hour** per token
- **Messaging**: Lower limits apply (1000 per day)

**Best Practices:**
- Queue DM jobs with 1-2 second delays
- Batch API calls (get multiple fields in one request)
- Cache profile data (don't refetch every time)
- Handle 429 responses with exponential backoff

```typescript
// Retry with exponential backoff
async function sendWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.status === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}
```

---

## Debugging

### Enable Logging
```typescript
import { logger } from '../utils/logger';

logger.info(`Sending DM to ${recipientId}`);
const result = await sendDM(igUserId, recipientId, message, token);
logger.info(`DM sent: ${result.mid}`);
```

### Test with curl
```bash
# Get profile
curl -X GET "https://graph.instagram.com/v23.0/17841456534142359" \
  -d "access_token=YOUR_TOKEN" \
  -d "fields=username,followers_count"

# Send DM
curl -X POST "https://graph.instagram.com/v23.0/17841456534142359/messages" \
  -d "recipient={\"id\":\"12345\"}" \
  -d "message={\"text\":\"Hello\"}" \
  -d "access_token=YOUR_TOKEN"
```

### Check Token Status
```typescript
const account = await CreatorAccount.findOne({ userId }).select('+igAccessToken');
const token = decryptToken(account.igAccessToken);
const daysTilExpiry = Math.floor(
  (account.igTokenExpiresAt - new Date()) / (1000 * 60 * 60 * 24)
);
console.log(`Token expires in ${daysTilExpiry} days`);
```

---

## Changelog

- **v1.0** (2025-09-05) — Initial Instagram 2025 API library
  - Direct Instagram OAuth (no Facebook intermediary)
  - 60-day long-lived tokens
  - Simplified error handling
  - AES-256-GCM token encryption
