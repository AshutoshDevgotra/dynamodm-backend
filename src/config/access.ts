/** Server-side allowlist for internal/admin testing accounts. */
const configuredUnlimitedEmails = (process.env.ADMIN_UNLIMITED_EMAILS || 'ashutoshdevgotra@gmail.com')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const unlimitedEmails = new Set(configuredUnlimitedEmails);

export function hasUnlimitedAccess(user?: { email?: string; role?: string }): boolean {
  return user?.role?.toUpperCase() === 'ADMIN'
    || (typeof user?.email === 'string' && unlimitedEmails.has(user.email.trim().toLowerCase()));
}
