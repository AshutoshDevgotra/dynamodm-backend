const CANONICAL_PRODUCTION_FRONTEND_URL = 'https://orangeflow.in';

/** Return the public frontend origin used by OAuth and browser redirects. */
export function getFrontendUrl(): string {
  if (process.env.NODE_ENV === 'production') {
    return CANONICAL_PRODUCTION_FRONTEND_URL;
  }

  const configuredUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').trim();
  const fallbackUrl = process.env.NODE_ENV === 'production'
    ? CANONICAL_PRODUCTION_FRONTEND_URL
    : 'http://localhost:3000';
  const frontendUrl = (configuredUrl || fallbackUrl).replace(/\/$/, '');

  return frontendUrl;
}

export const CANONICAL_FRONTEND_URL = CANONICAL_PRODUCTION_FRONTEND_URL;
