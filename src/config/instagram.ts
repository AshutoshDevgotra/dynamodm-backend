/**
 * Permissions requested by the Instagram Login flow.
 * Keep this list in sync with the features that use the Instagram API.
 */
export const INSTAGRAM_REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
] as const;

export const INSTAGRAM_AUTHORIZATION_URL = 'https://www.instagram.com/oauth/authorize';
