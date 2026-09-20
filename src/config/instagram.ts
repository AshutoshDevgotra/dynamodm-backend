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

/**
 * Build Instagram's Business Login entry URL. Instagram may internally
 * redirect this URL to /consent/?flow=ig_biz_login_oauth for the permission
 * review screen; that internal URL must not be generated directly by us.
 */
export function buildInstagramBusinessLoginUrl(params: {
  clientId: string;
  redirectUri: string;
  state?: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_REQUIRED_SCOPES.join(','),
    ...(params.state ? { state: params.state } : {}),
    // Force Instagram to show the authorization review for an existing grant.
    force_reauth: 'true',
    // Keep this on Instagram Business Login instead of falling back to Facebook Login.
    enable_fb_login: '0',
  });

  return `${INSTAGRAM_AUTHORIZATION_URL}?${query}`;
}
