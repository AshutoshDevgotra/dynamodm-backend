const CANONICAL_PRODUCTION_FRONTEND_URL = 'https://automation.houseoforange.in';
const LEGACY_VERCEL_FRONTEND_URL = 'https://dynamodm-frontend.vercel.app';

/** Return the public frontend origin used by OAuth and browser redirects. */
export function getFrontendUrl(): string {
  const configuredUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URL || '').trim();
  const fallbackUrl = process.env.NODE_ENV === 'production'
    ? CANONICAL_PRODUCTION_FRONTEND_URL
    : 'http://localhost:3000';
  const frontendUrl = (configuredUrl || fallbackUrl).replace(/\/$/, '');

  // Prevent an old Render/Vercel environment variable from sending users away
  // from the canonical production domain.
  if (process.env.NODE_ENV === 'production' && frontendUrl === LEGACY_VERCEL_FRONTEND_URL) {
    return CANONICAL_PRODUCTION_FRONTEND_URL;
  }

  return frontendUrl;
}

export const CANONICAL_FRONTEND_URL = CANONICAL_PRODUCTION_FRONTEND_URL;
