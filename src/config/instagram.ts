/**
 * Permissions requested by the Instagram Login flow.
 * Keep this list in sync with the features that use the Instagram API.
 */
export const INSTAGRAM_REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
] as const;

export const INSTAGRAM_BUSINESS_LOGIN_CONSENT_URL = 'https://www.instagram.com/consent/';

/**
 * Build Instagram's Business Login consent URL. This is the permission-review
 * screen shown by the Instagram Business Login embed flow.
 */
export function buildInstagramBusinessLoginUrl(params: {
  clientId: string;
  redirectUri: string;
  state?: string;
}): string {
  const oauthParams = {
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: INSTAGRAM_REQUIRED_SCOPES.join(','),
    ...(params.state ? { state: params.state } : {}),
  };

  const query = new URLSearchParams({
    flow: 'ig_biz_login_oauth',
    params_json: JSON.stringify(oauthParams),
    source: 'oauth_permissions_page_www',
  });

  return `${INSTAGRAM_BUSINESS_LOGIN_CONSENT_URL}?${query}`;
}
