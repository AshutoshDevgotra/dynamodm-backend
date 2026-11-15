# Instagram Reels Not Showing - Troubleshooting Guide

## Issue
Reels are not appearing in the automation post selection, only regular posts are visible.

## Root Cause Analysis

### 1. Instagram Account Type Requirements
**Reels are ONLY accessible via Instagram Graph API if:**
- ✅ The account is a **Professional account** (Business or Creator)
- ✅ The account was Professional **when the reel was posted**
- ❌ Reels posted before converting to Professional account **are NOT accessible** via API

### 2. Instagram API Permissions
The account must have these permissions:
- `instagram_basic`
- `instagram_manage_comments`
- `instagram_manage_messages`  
- `pages_show_list`
- `pages_read_engagement`

### 3. Media Product Type Field
Instagram returns `media_product_type` field with these values:
- `FEED` = Regular post
- `REELS` = Reel
- `STORY` = Story (24hr, usually not accessible after expiry)
- `IGTV` = IGTV video (deprecated)

## Verification Steps

### Step 1: Check Your Backend Logs
After you try to load posts in the automation setup, check the server logs:

```bash
cd /var/www/dynamodm-backend
pm2 logs dynamodm-backend --lines 50
```

Look for a line like:
```
Fetched 10 posts for @username: [
  { id: '123', media_type: 'IMAGE', media_product_type: 'FEED' },
  { id: '456', media_type: 'VIDEO', media_product_type: 'REELS' },
  ...
]
```

**If you see REELS in the logs but not in the UI:**
- Frontend filtering issue (unlikely, we checked the code)
- Browser cache issue

**If you DON'T see REELS in the logs:**
- Instagram API is not returning reels (see solutions below)

### Step 2: Verify Instagram Account Type
1. Open Instagram app
2. Go to Settings → Account → Switch account type
3. Confirm it says "Business" or "Creator"
4. If it says "Personal", switch to Professional

### Step 3: When Was the Reel Posted?
**Critical Question:** Was your Instagram account a Professional account when you posted the reel?

- If NO → **The reel won't be accessible via API** (Instagram limitation)
- If YES → Continue troubleshooting

### Step 4: Reconnect Instagram Account
Sometimes Instagram doesn't update permissions properly:

1. Go to OrangeFlow → Instagram profile
2. Disconnect your Instagram account
3. Reconnect your Instagram account
4. Check all permissions are granted during OAuth
5. Try loading posts again

### Step 5: Test with a NEW Reel
To confirm API access is working:

1. Make sure your account is Professional (Business/Creator)
2. Post a NEW reel on Instagram
3. Wait 2-3 minutes for Instagram to process it
4. Try loading posts in OrangeFlow automation setup
5. The NEW reel should appear

## Common Scenarios

### Scenario A: Account Was Personal, Now Professional
**Problem:** You posted reels when your account was Personal, then converted to Professional.

**Solution:** Those old reels won't appear via API. Only new reels (posted after conversion) will show.

**Workaround:** None. This is an Instagram limitation. Post new reels.

### Scenario B: Account Is Still Personal
**Problem:** Account is not Professional.

**Solution:** 
1. Open Instagram app
2. Settings → Account → Switch to Professional Account
3. Choose Business or Creator
4. Complete the setup
5. Reconnect in OrangeFlow
6. Post new reels

### Scenario C: Account Is Professional But No Reels Showing
**Problem:** Account is Professional, but API returns only FEED posts.

**Solutions:**
1. **Reconnect Instagram** - Disconnect and reconnect in OrangeFlow
2. **Check permissions** - Ensure all permissions were granted during OAuth
3. **Post a new reel** - Test with content created while Professional
4. **Wait for Instagram** - Sometimes takes 5-10 minutes for new content to appear in API

### Scenario D: Some Reels Show, Others Don't
**Problem:** Only certain reels appear.

**Likely Cause:** Some reels were posted before Professional account conversion.

**Solution:** Only reels posted while Professional will show. This is normal.

## Instagram API Quirks

### Media Type vs Media Product Type
- `media_type`: Format (IMAGE, VIDEO, CAROUSEL_ALBUM)
- `media_product_type`: Where it appears (FEED, REELS, STORY)

A reel is: `{ media_type: 'VIDEO', media_product_type: 'REELS' }`

### Professional Account Requirement
This is an Instagram/Meta policy:
- Personal accounts have limited API access
- Only Professional accounts get full media access
- Historical content from Personal account days is NOT retroactively available

### API Delay
New content might take 2-5 minutes to appear in the API after posting.

## Code Verification

Our code is correct. We verified:
- ✅ Backend requests `media_product_type` field from Instagram
- ✅ No filtering by media_type or media_product_type
- ✅ Frontend displays reels with "Reel" badge
- ✅ Both posts and reels are selectable

## Quick Test Command

To manually test what Instagram API returns for your account:

```bash
# Replace YOUR_INSTAGRAM_USER_ID and YOUR_ACCESS_TOKEN
curl "https://graph.instagram.com/v23.0/YOUR_INSTAGRAM_USER_ID/media?fields=id,caption,media_type,media_product_type&access_token=YOUR_ACCESS_TOKEN"
```

Look for items with `"media_product_type": "REELS"` in the response.

## Next Steps

1. **Check backend logs** after trying to load posts - see what Instagram actually returns
2. **Verify account is Professional** - Not just now, but was it Professional when reel was posted?
3. **Test with new reel** - Post a new reel while Professional, wait 5min, check if it appears
4. **Reconnect if needed** - Disconnect and reconnect Instagram in OrangeFlow

## Still Not Working?

If after all above steps reels still don't show:

1. Check PM2 logs: `pm2 logs dynamodm-backend --lines 100`
2. Share the log output (the part showing fetched posts)
3. Confirm: Is account Professional? When was reel posted? 
4. Try posting a brand new reel and test again

## Summary

**Most Common Cause:** Reels were posted when account was Personal, not Professional.

**Solution:** Ensure account is Professional and post new reels. Old reels from Personal account days won't be accessible via Instagram API.
