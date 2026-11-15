/**
 * House of Orange Members Configuration
 * 
 * Members listed here get unlimited access to all features without subscription:
 * - Up to 5 Instagram accounts
 * - Unlimited automations
 * - Unlimited leads
 * - Unlimited DM sending
 * 
 * To add a member:
 * 1. Add their email to the array below
 * 2. Commit and push to Git
 * 3. Deploy to server (git pull && npm run build && pm2 restart)
 * 4. Member logs in and immediately gets unlimited access
 * 
 * Note: Emails are case-insensitive. john@example.com = JOHN@EXAMPLE.COM
 */

export const HOUSE_OF_ORANGE_MEMBERS = [
  // Add member emails below (one per line for easy management)
  // Example: 'member@houseoforange.in',
  
  // Active members:
  
];

/**
 * Check if an email belongs to a House of Orange member
 */
export function isHouseOfOrangeMember(email?: string): boolean {
  if (!email || typeof email !== 'string') return false;
  
  const normalizedEmail = email.trim().toLowerCase();
  
  // Check against hardcoded list
  const isInList = HOUSE_OF_ORANGE_MEMBERS.some(
    memberEmail => memberEmail.trim().toLowerCase() === normalizedEmail
  );
  
  // Also check environment variable for backward compatibility
  const envMembers = (process.env.HOUSE_OF_ORANGE_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  
  const isInEnv = envMembers.includes(normalizedEmail);
  
  return isInList || isInEnv;
}
