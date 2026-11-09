import { Router, Request, Response } from 'express';
import { CreatorAccount } from '../../models/CreatorAccount';
import { Product } from '../../models/Product';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character]!));

const safeHttpUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const formatFollowers = (count: number): string => {
  if (!count) return '';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(count);
};

const renderStorefront = (
  creator: { name?: string; igUsername?: string; profilePic?: string; profile?: { bio?: string; avatar?: string }; followersCount?: number },
  products: Array<{ _id: unknown; title: string; description?: string; type: string; imageUrl?: string; imageMimeType?: string; originalUrl?: string; dynamoShortUrl?: string }>,
): string => {
  const name = escapeHtml(creator.name || creator.igUsername || 'Creator');
  const username = escapeHtml(creator.igUsername || 'creator');
  const bio = escapeHtml(creator.profile?.bio || '');
  const profileImage = safeHttpUrl(creator.profile?.avatar) || safeHttpUrl(creator.profilePic);
  const followerCount = formatFollowers(creator.followersCount || 0);
  const instagramUrl = `https://www.instagram.com/${encodeURIComponent(creator.igUsername || '')}/`;
  const cards = products.map((product) => {
    const productId = String(product._id);
    const imageUrl = safeHttpUrl(product.imageUrl) || (product.imageMimeType ? `/api/products/${encodeURIComponent(productId)}/image` : undefined);
    const productUrl = safeHttpUrl(product.originalUrl) || safeHttpUrl(product.dynamoShortUrl);
    const image = imageUrl
      ? `<img class="product-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.title)}" loading="lazy">`
      : '<div class="image-placeholder" aria-hidden="true"><span>OF</span></div>';
    const description = product.description?.trim()
      ? `<p class="product-description">${escapeHtml(product.description)}</p>`
      : '';
    const category = escapeHtml(product.type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase()));
    const action = productUrl
      ? `<a class="product-link" href="${escapeHtml(productUrl)}" target="_blank" rel="noopener noreferrer">View product <span aria-hidden="true">↗</span></a>`
      : '<span class="product-link unavailable">Link unavailable</span>';
    return `<article class="product-card"><div class="product-media">${image}<span class="product-category">${category}</span></div><div class="product-content"><h2>${escapeHtml(product.title)}</h2>${description}${action}</div></article>`;
  }).join('');
  const avatar = profileImage
    ? `<img src="${escapeHtml(profileImage)}" alt="${name}" class="avatar">`
    : `<div class="avatar avatar-fallback" aria-hidden="true">${escapeHtml((creator.name || creator.igUsername || 'C').trim().charAt(0).toUpperCase())}</div>`;
  const socialLink = creator.igUsername
    ? `<a class="social-link" href="${escapeHtml(instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram <span aria-hidden="true">↗</span></a>`
    : '';
  const follower = followerCount ? `<span class="meta-divider" aria-hidden="true"></span><span>${escapeHtml(followerCount)} followers</span>` : '';
  const content = products.length
    ? `<section class="product-grid" aria-label="Products">${cards}</section>`
    : '<section class="empty-state"><span class="empty-mark" aria-hidden="true">OF</span><h2>A little more to come</h2><p>This creator is still curating their storefront.</p></section>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f7f7f4"><meta name="description" content="Shop the picks and recommendations from ${name}."><title>${name} — Storefront</title><style>
:root{color-scheme:light;--ink:#1e2924;--muted:#737d75;--line:#e7eae5;--paper:#f7f7f4;--card:#fff;--green:#176b4a;--green-dark:#10573c;--soft-green:#e8f1eb;--radius:20px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased}a{color:inherit}.page-shell{width:min(100% - 48px,1060px);margin:0 auto}.topbar{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-size:15px;font-weight:760;letter-spacing:-.04em}.brand span{color:var(--green)}.top-note{font-size:12px;color:var(--muted);letter-spacing:.02em}.profile{padding:64px 0 40px;display:grid;grid-template-columns:84px 1fr;gap:22px;align-items:center}.avatar{width:84px;height:84px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:0 5px 20px #1e29241a}.avatar-fallback{background:var(--soft-green);display:grid;place-items:center;font-size:28px;font-weight:700;color:var(--green)}.eyebrow{margin:0 0 8px;color:var(--green);font-size:11px;line-height:1.4;letter-spacing:.14em;font-weight:750;text-transform:uppercase}.profile h1{margin:0;font-size:clamp(28px,5vw,42px);line-height:1.1;letter-spacing:-.055em;font-weight:690}.handle{margin:8px 0 0;color:var(--muted);font-size:14px}.bio{max-width:590px;margin:16px 0 0;color:#4f5c53;font-size:15px;line-height:1.7;white-space:pre-line}.profile-meta{display:flex;align-items:center;gap:12px;margin-top:16px;color:var(--muted);font-size:12px}.social-link{color:var(--green);font-weight:650;text-decoration:none}.social-link:hover{color:var(--green-dark)}.meta-divider{width:3px;height:3px;border-radius:50%;background:#adb6ad}.section-heading{padding:25px 0 18px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}.section-heading h2{margin:0;font-size:13px;letter-spacing:.01em;font-weight:680}.section-heading span{font-size:12px;color:var(--muted)}.product-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding-bottom:72px}.product-card{min-width:0;overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}.product-card:hover{transform:translateY(-3px);border-color:#d5dfd6;box-shadow:0 14px 36px #2031260d}.product-media{position:relative;aspect-ratio:4/3;background:#eef1ed;overflow:hidden}.product-image{display:block;width:100%;height:100%;object-fit:cover}.image-placeholder{height:100%;display:grid;place-items:center;background:linear-gradient(145deg,#e9f0eb,#f2efe8);color:#9aafa0;font-size:26px;font-weight:750;letter-spacing:-.08em}.product-category{position:absolute;top:12px;left:12px;max-width:calc(100% - 24px);padding:6px 9px;border:1px solid #ffffffb3;border-radius:999px;background:#ffffffeb;color:#536258;font-size:10px;line-height:1;text-transform:uppercase;letter-spacing:.07em;font-weight:700;backdrop-filter:blur(8px)}.product-content{padding:17px 17px 16px}.product-content h2{margin:0;font-size:16px;line-height:1.4;letter-spacing:-.025em;font-weight:680}.product-description{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:3;min-height:0;margin:8px 0 16px;color:var(--muted);font-size:13px;line-height:1.65}.product-link{display:inline-flex;align-items:center;gap:7px;margin-top:17px;color:var(--green);font-size:12px;font-weight:700;text-decoration:none}.product-link:hover{text-decoration:underline;text-underline-offset:3px}.product-description+.product-link{margin-top:0}.product-link span{font-size:14px}.product-link.unavailable{color:#969f98}.empty-state{margin:6px 0 76px;padding:58px 20px;text-align:center;border:1px dashed #d6ddd6;border-radius:var(--radius);background:#ffffff80}.empty-mark{display:grid;place-items:center;width:46px;height:46px;margin:0 auto 16px;border-radius:15px;background:var(--soft-green);color:var(--green);font-size:14px;font-weight:800;letter-spacing:-.06em}.empty-state h2{margin:0;font-size:17px;letter-spacing:-.02em}.empty-state p{margin:8px 0 0;color:var(--muted);font-size:13px}.footer{min-height:72px;border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:11px}.footer-brand{color:var(--ink);font-weight:700;letter-spacing:-.03em}.footer-brand span{color:var(--green)}@media(max-width:760px){.product-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.page-shell{width:min(100% - 36px,600px)}.profile{padding-top:48px}}@media(max-width:520px){.page-shell{width:calc(100% - 32px)}.topbar{height:64px}.top-note{font-size:11px}.profile{grid-template-columns:62px 1fr;gap:15px;padding:38px 0 30px;align-items:start}.avatar{width:62px;height:62px}.profile h1{font-size:29px}.handle{margin-top:6px;font-size:13px}.bio{grid-column:1/-1;margin-top:1px;font-size:14px}.profile-meta{grid-column:1/-1;margin-top:-3px}.product-grid{grid-template-columns:1fr;gap:14px;padding-bottom:48px}.product-card{display:grid;grid-template-columns:39% 1fr;min-height:146px}.product-media{height:100%;min-height:146px;aspect-ratio:auto}.product-content{padding:14px}.product-content h2{font-size:15px}.product-description{font-size:12px;-webkit-line-clamp:3;margin:7px 0 12px}.product-link{margin-top:13px}.section-heading{padding-top:21px}.footer{min-height:64px}}
</style></head><body><main class="page-shell"><header class="topbar"><a class="brand" href="/" aria-label="Orangeflow home">orange<span>flow</span></a><span class="top-note">A little corner of the internet</span></header><section class="profile" aria-label="Creator profile">${avatar}<div><p class="eyebrow">Creator storefront</p><h1>${name}</h1><p class="handle">@${username}</p></div>${bio ? `<p class="bio">${bio}</p>` : ''}<div class="profile-meta">${socialLink}${follower}</div></section><section class="section-heading"><h2>Curated for you</h2><span>${products.length} ${products.length === 1 ? 'pick' : 'picks'}</span></section>${content}<footer class="footer"><span class="footer-brand">orange<span>flow</span></span><span>Thoughtfully shared by @${username}</span></footer></main></body></html>`;
};

router.get('/:username/store', async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username.trim().replace(/^@/, '');
  const creator = await CreatorAccount.findOne({ igUsername: new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), isConnected: true });
  if (!creator) throw new AppError('Creator storefront not found.', 404);

  const products = await Product.find({ creatorId: creator._id }).sort({ createdAt: -1 }).select('-imageData');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.type('html').send(renderStorefront(creator, products));
});

export default router;
