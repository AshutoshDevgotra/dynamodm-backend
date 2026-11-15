/** Server-side allowlist for internal/admin testing accounts. */
const configuredUnlimitedEmails = (process.env.ADMIN_UNLIMITED_EMAILS || 'ashutoshdevgotra@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const unlimitedEmails = new Set(configuredUnlimitedEmails);

/** House of Orange member emails - get unlimited features without subscription */
const configuredHouseOfOrangeEmails = (process.env.HOUSE_OF_ORANGE_EMAILS || '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const houseOfOrangeEmails = new Set(configuredHouseOfOrangeEmails);

/** Instagram user IDs that bypass cooling period (for testing/VIP accounts). */
const configuredNoCooldownInstagramIds = (process.env.NO_COOLDOWN_INSTAGRAM_IDS || '17841434768105686')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const noCooldownInstagramIds = new Set(configuredNoCooldownInstagramIds);

export function hasUnlimitedAccess(user?: { email?: string; role?: string }): boolean {
  return user?.role?.toUpperCase() === 'ADMIN'
    || (typeof user?.email === 'string' && unlimitedEmails.has(user.email.trim().toLowerCase()));
}

export function isHouseOfOrangeMember(email?: string): boolean {
  return typeof email === 'string' && houseOfOrangeEmails.has(email.trim().toLowerCase());
}

export function bypassesCoolingPeriod(instagramUserId: string): boolean {
  return noCooldownInstagramIds.has(instagramUserId.trim());
}
