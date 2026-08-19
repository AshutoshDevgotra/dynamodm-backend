import axios from 'axios';

const META_API = `https://graph.facebook.com/${process.env.META_API_VERSION || 'v20.0'}`;

/** Public About fields allowed under Page Public Metadata Access. */
export const PAGE_PUBLIC_ABOUT_FIELDS = [
  'id',
  'name',
  'about',
  'description',
  'category',
  'location',
  'hours',
  'verification_status',
  'cover',
  'picture',
  'fan_count',
  'followers_count',
  'link',
  'website',
].join(',');

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export type PageLocation = {
  city?: string;
  country?: string;
  state?: string;
  street?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
};

export type PublicPageAbout = {
  id: string;
  name: string;
  about: string | null;
  category: string | null;
  location: PageLocation | null;
  locationDisplay: string | null;
  hours: Record<string, string> | null;
  hoursDisplay: string[];
  verificationStatus: string;
  coverUrl: string | null;
  profilePictureUrl: string | null;
  fanCount: number | null;
  followersCount: number | null;
  website: string | null;
  pageUrl: string | null;
  source: {
    label: string;
    pageId: string;
    pageName: string;
    pageUrl: string;
  };
};

export type PageAboutAggregates = {
  pageCount: number;
  verification: Array<{ status: string; count: number; sources: string[] }>;
  locations: Array<{ city: string; country: string; count: number; sources: string[] }>;
  hoursCoverage: { withHours: number; withoutHours: number; sourcesWithHours: string[] };
  mediaCoverage: { withCover: number; withProfilePicture: number };
  engagement: {
    totalFans: number;
    totalFollowers: number;
    averageFans: number;
    sources: string[];
  };
  categories: Array<{ category: string; count: number; sources: string[] }>;
};

export function formatLocation(location?: PageLocation | null): string | null {
  if (!location) return null;
  const parts = [location.street, location.city, location.state, location.country, location.zip].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function formatPageHours(hours?: Record<string, string> | null): string[] {
  if (!hours) return [];
  const lines: string[] = [];
  for (const day of Object.keys(DAY_LABELS)) {
    const open1 = hours[`${day}_1_open`];
    const close1 = hours[`${day}_1_close`];
    if (!open1 || !close1) continue;
    let line = `${DAY_LABELS[day]}: ${open1}–${close1}`;
    const open2 = hours[`${day}_2_open`];
    const close2 = hours[`${day}_2_close`];
    if (open2 && close2) line += `, ${open2}–${close2}`;
    lines.push(line);
  }
  return lines;
}

function sourceLabel(name: string, id: string): string {
  return `Facebook Page · ${name} (${id})`;
}

function pageUrl(id: string, link?: string): string {
  return link || `https://www.facebook.com/${id}`;
}

export function normalizePageAbout(raw: any): PublicPageAbout | null {
  if (!raw?.id || !raw?.name) return null;
  const location: PageLocation | null = raw.location
    ? {
        city: raw.location.city,
        country: raw.location.country,
        state: raw.location.state,
        street: raw.location.street,
        zip: raw.location.zip,
        latitude: raw.location.latitude,
        longitude: raw.location.longitude,
      }
    : null;
  const url = pageUrl(raw.id, raw.link);
  const name = String(raw.name);
  return {
    id: String(raw.id),
    name,
    about: raw.about || raw.description || null,
    category: raw.category || null,
    location,
    locationDisplay: formatLocation(location),
    hours: raw.hours || null,
    hoursDisplay: formatPageHours(raw.hours),
    verificationStatus: raw.verification_status || 'not_verified',
    coverUrl: raw.cover?.source || null,
    profilePictureUrl: raw.picture?.data?.url || raw.picture?.url || null,
    fanCount: typeof raw.fan_count === 'number' ? raw.fan_count : null,
    followersCount: typeof raw.followers_count === 'number' ? raw.followers_count : null,
    website: raw.website || null,
    pageUrl: url,
    source: {
      label: sourceLabel(name, String(raw.id)),
      pageId: String(raw.id),
      pageName: name,
      pageUrl: url,
    },
  };
}

function countBy<T>(
  pages: PublicPageAbout[],
  keyFn: (page: PublicPageAbout) => string | null,
): Array<{ key: string; count: number; sources: string[] }> {
  const map = new Map<string, { count: number; sources: string[] }>();
  for (const page of pages) {
    const key = keyFn(page);
    if (!key) continue;
    const existing = map.get(key) || { count: 0, sources: [] };
    existing.count += 1;
    existing.sources.push(page.source.label);
    map.set(key, existing);
  }
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count);
}

export function aggregatePageAbout(pages: PublicPageAbout[]): PageAboutAggregates {
  const verification = countBy(pages, (p) => p.verificationStatus).map(({ key, count, sources }) => ({
    status: key,
    count,
    sources,
  }));
  const locations = countBy(pages, (p) => {
    if (!p.location?.city && !p.location?.country) return null;
    return `${p.location?.city || 'Unknown'}, ${p.location?.country || 'Unknown'}`;
  }).map(({ key, count, sources }) => {
    const [city, country] = key.split(', ');
    return { city, country, count, sources };
  });
  const categories = countBy(pages, (p) => p.category).map(({ key, count, sources }) => ({
    category: key,
    count,
    sources,
  }));

  const withHours = pages.filter((p) => p.hoursDisplay.length > 0);
  const withFans = pages.filter((p) => typeof p.fanCount === 'number');
  const totalFans = withFans.reduce((sum, p) => sum + (p.fanCount || 0), 0);
  const totalFollowers = pages.reduce((sum, p) => sum + (p.followersCount || 0), 0);

  return {
    pageCount: pages.length,
    verification,
    locations,
    hoursCoverage: {
      withHours: withHours.length,
      withoutHours: pages.length - withHours.length,
      sourcesWithHours: withHours.map((p) => p.source.label),
    },
    mediaCoverage: {
      withCover: pages.filter((p) => p.coverUrl).length,
      withProfilePicture: pages.filter((p) => p.profilePictureUrl).length,
    },
    engagement: {
      totalFans,
      totalFollowers,
      averageFans: withFans.length ? Math.round(totalFans / withFans.length) : 0,
      sources: pages.map((p) => p.source.label),
    },
    categories,
  };
}

export async function searchPublicPages(query: string, accessToken: string, limit = 8): Promise<Array<{ id: string; name: string }>> {
  const res = await axios.get(`${META_API}/pages/search`, {
    params: {
      q: query,
      fields: 'id,name,location,link,verification_status',
      limit,
      access_token: accessToken,
    },
  });
  return (res.data?.data || []).filter((p: any) => p.id && p.name);
}

export async function fetchPagesAbout(pageIds: string[], accessToken: string): Promise<PublicPageAbout[]> {
  const uniqueIds = [...new Set(pageIds.filter(Boolean))].slice(0, 15);
  if (uniqueIds.length === 0) return [];

  const res = await axios.get(`${META_API}/`, {
    params: {
      ids: uniqueIds.join(','),
      fields: PAGE_PUBLIC_ABOUT_FIELDS,
      access_token: accessToken,
    },
  });

  const byId = res.data || {};
  return uniqueIds
    .map((id) => normalizePageAbout(byId[id]))
    .filter((p): p is PublicPageAbout => Boolean(p));
}

export function graphErrorMessage(err: any): string {
  return err?.response?.data?.error?.message || err?.message || 'Meta Graph API request failed.';
}
