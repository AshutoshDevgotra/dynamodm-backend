# House of Orange Members

This file documents how to manage House of Orange membership.

## Quick Start

**To add a new member:**

1. Open `src/config/houseOfOrange.ts`
2. Add their email to the `HOUSE_OF_ORANGE_MEMBERS` array:
   ```typescript
   export const HOUSE_OF_ORANGE_MEMBERS = [
     'member1@houseoforange.in',
     'member2@gmail.com',
     'newmember@example.com', // <- Add here
   ];
   ```
3. Save the file
4. Commit and push:
   ```bash
   git add src/config/houseOfOrange.ts
   git commit -m "feat: add new House of Orange member"
   git push
   ```
5. Deploy to server:
   ```bash
   cd /var/www/dynamodm-backend
   git pull
   npm run build
   pm2 restart dynamodm-backend --update-env
   ```

## Member Benefits

House of Orange members get:

- ✅ **No subscription required** - Free access to all features
- ✅ **5 Instagram accounts** - Can connect up to 5 accounts
- ✅ **Unlimited automations** - No limit on automation rules
- ✅ **Unlimited leads** - Collect infinite leads
- ✅ **Unlimited DMs** - Send infinite auto-DMs
- ✅ **Priority support** - Access to all premium features

## File Locations

- **Members list:** `src/config/houseOfOrange.ts`
- **Access logic:** `src/config/access.ts`
- **Auth middleware:** `src/middleware/auth.ts`

## Alternative: Environment Variable

You can also add members via `.env` file (useful for temporary access):

```env
HOUSE_OF_ORANGE_EMAILS=temp@example.com,guest@example.com
```

Members in **either** the file **or** `.env` will get access.

## Testing

After adding a member:

1. Have them logout (if already logged in)
2. Have them login again
3. They should see:
   - No subscription prompts
   - Ability to connect up to 5 Instagram accounts
   - All features unlocked

## Removing a Member

1. Open `src/config/houseOfOrange.ts`
2. Remove their email from the array
3. Commit, push, and deploy
4. They will lose access on their next login

## Security Notes

- This file is **committed to Git** (not secret)
- Only add trusted members
- Remove members promptly when they leave
- Regularly audit the list

## Current Members

See `src/config/houseOfOrange.ts` for the current list.
