import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';

const INSTAGRAM_API = `https://graph.instagram.com/v23.0`;
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';

function isImageAttachmentUrl(url?: string): boolean {
  if (!url) return false;
  try {
    return /\.(jpe?g|png|webp|gif)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function isPdfAttachmentUrl(url?: string): boolean {
  if (!url) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function addPdfButton(
  buttons: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[] | undefined,
  attachmentUrl?: string,
) {
  if (!isPdfAttachmentUrl(attachmentUrl)) return buttons;
  const current = buttons ? [...buttons] : [];
  if (current.some((button) => button.type === 'web_url' && button.url === attachmentUrl)) return current;
  if (current.length >= 3) return current;
  return [...current, { type: 'web_url' as const, title: 'Get PDF', url: attachmentUrl }];
}

export function isInstagramSessionInvalidated(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('session has been invalidated')
    || (message.includes('error validating access token') && message.includes('password'))
    || message.includes('invalid oauth access token');
}

export interface IGProfile {
  id: string;
  user_id?: string;
  username: string;
  account_type: string;
  followers_count: number;
  media_count: number;
  biography: string;
  profile_picture_url?: string;
}

export interface IGMedia {
  id: string;
  caption?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
  media_type?: string;
  media_product_type?: string;
}

export interface IGShortLivedToken {
  access_token: string;
  user_id: string;
  token_type: string;
  permissions?: string;
}

export interface IGLongLivedToken {
  access_token: string;
  token_type: string;
}

function handleIGError(error: any, context: string): never {
  const axiosError = error as AxiosError;
  const status = axiosError?.response?.status || 500;
  const data = axiosError?.response?.data as any;
  const message = data?.error?.message || error.message || 'Unknown Instagram API error';

  logger.error(`Instagram API error in ${context}:`, { status, message });

  const errorMsg = `Instagram API (${context}): ${message}`;
  const err = new Error(errorMsg);
  (err as any).status = status;
  throw err;
}

export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<IGShortLivedToken> {
  try {
    const response = await axios.post(
      INSTAGRAM_TOKEN_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const token = Array.isArray(response.data?.data) ? response.data.data[0] : response.data;
    if (!token?.access_token || !token?.user_id) {
      throw new Error('Instagram returned an invalid short-lived token response');
    }

    return token;
  } catch (error) {
    handleIGError(error, 'exchangeCodeForToken');
  }
}

export async function exchangeToLongLivedToken(
  shortLivedToken: string,
  clientSecret: string
): Promise<IGLongLivedToken & { expires_in?: number }> {
  try {
    const response = await axios.get(`${INSTAGRAM_API}/access_token`, {
      params: {
        grant_type: 'ig_exchange_token',
        client_secret: clientSecret,
        access_token: shortLivedToken,
      },
    });

    return response.data;
  } catch (error) {
    handleIGError(error, 'exchangeToLongLivedToken');
  }
}

export async function getProfile(igUserId: string, accessToken: string): Promise<IGProfile> {
  try {
    const response = await axios.get(`${INSTAGRAM_API}/me`, {
      params: {
        fields: 'user_id,username,name,profile_picture_url,followers_count,biography',
        access_token: accessToken,
      },
    });

    return {
      ...response.data,
      id: response.data.user_id || igUserId,
      user_id: response.data.user_id,
    };
  } catch (error) {
    handleIGError(error, 'getProfile');
  }
}

export async function getMedia(
  igUserId: string,
  accessToken: string,
  limit = 30,
  fields = 'id,caption,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp,media_type,media_product_type'
): Promise<IGMedia[]> {
  try {
    const response = await axios.get(`${INSTAGRAM_API}/${igUserId}/media`, {
      params: {
        fields,
        limit,
        access_token: accessToken,
      },
    });

    return response.data.data || [];
  } catch (error) {
    handleIGError(error, 'getMedia');
  }
}

/**
 * Returns whether an Instagram-scoped user follows the connected creator.
 * The old /relationship endpoint is not part of the Instagram Login API.
 * Instagram exposes this relationship on the participant profile instead.
 */
export async function checkFollowerRelationship(
  igUserId: string,
  recipientId: string,
  accessToken: string
): Promise<boolean> {
  try {
    const response = await axios.get(`${INSTAGRAM_API}/${recipientId}`, {
      params: { fields: 'is_user_follow_business', access_token: accessToken },
    });
    return response.data?.is_user_follow_business === true;
  } catch (error) {
    logger.warn('Instagram follower relationship could not be confirmed.', {
      recipientId,
      message: (error as AxiosError)?.message,
    });
    return false;
  }
}

export type IGButton = { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string };

/**
 * Formats message text into a valid title (max 80 chars) and subtitle (max 80 chars)
 * for Instagram Generic Templates.
 * Meta strictly requires:
 * 1. Title must NOT contain line breaks (\n, \r)
 * 2. Subtitle must NOT contain line breaks (\n, \r)
 * 3. Title must not be empty (max 80 characters)
 * 4. Subtitle is optional (max 80 characters)
 */
export function formatTemplateText(message: string): { title: string; subtitle?: string } {
  const clean = String(message || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) {
    return { title: 'Tap below to open link' };
  }

  if (clean.length <= 80) {
    return { title: clean };
  }

  // Find a clean word or sentence break before 80 characters
  let breakPoint = 80;
  const sentenceEnd = clean.slice(0, 80).search(/[.!?]\s+[A-Z0-9]/i);
  if (sentenceEnd > 15) {
    breakPoint = sentenceEnd + 1;
  } else {
    const lastSpace = clean.slice(0, 80).lastIndexOf(' ');
    if (lastSpace > 25) {
      breakPoint = lastSpace;
    }
  }

  const title = clean.slice(0, breakPoint).trim();
  const rest = clean.slice(breakPoint).trim();
  const subtitle = rest ? rest.slice(0, 80).trim() : undefined;

  return {
    title: title || clean.slice(0, 80),
    ...(subtitle ? { subtitle } : {}),
  };
}

export function sanitizeIGButtons(buttons?: unknown): IGButton[] | undefined {
  if (!Array.isArray(buttons) || buttons.length === 0) return undefined;
  const result: IGButton[] = [];
  for (const item of buttons) {
    if (!item) continue;
    const raw = typeof (item as any).toObject === 'function' ? (item as any).toObject() : item;
    const title = String(raw.title || '')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .substring(0, 20);
    if (!title) continue;

    if (raw.type === 'postback' || (!raw.url && raw.payload)) {
      result.push({
        type: 'postback',
        title,
        payload: String(raw.payload || raw.title || '').trim().substring(0, 1000),
      });
    } else {
      let url = String(raw.url || '').trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      result.push({
        type: 'web_url',
        title,
        url,
      });
    }
    if (result.length >= 3) break;
  }
  return result.length > 0 ? result : undefined;
}

export async function sendDM(
  igUserId: string,
  recipientId: string,
  message: string,
  accessToken: string,
  buttons?: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[],
  attachmentUrl?: string
): Promise<{ mid: string }> {
  const cleanButtons = sanitizeIGButtons(addPdfButton(buttons, attachmentUrl));

  if (cleanButtons?.length) {
    const { title, subtitle } = formatTemplateText(message);
    const element: any = {
      title,
      buttons: cleanButtons,
    };
    if (subtitle) element.subtitle = subtitle;
    if (isImageAttachmentUrl(attachmentUrl)) {
      element.image_url = attachmentUrl;
    }

    try {
      const genericPayload = {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [element],
            },
          },
        },
      };
      const response = await axios.post(`${INSTAGRAM_API}/${igUserId}/messages`, genericPayload, {
        params: { access_token: accessToken },
      });
      return response.data;
    } catch (genericErr) {
      logger.warn('sendDM generic template failed, attempting button template fallback', {
        error: (genericErr as any)?.response?.data?.error?.message || (genericErr as Error)?.message,
      });
      try {
        const cleanText = message.replace(/[\r\n]+/g, ' ').trim().substring(0, 640);
        const buttonPayload = {
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: cleanText || title,
                buttons: cleanButtons,
              },
            },
          },
        };
        const response = await axios.post(`${INSTAGRAM_API}/${igUserId}/messages`, buttonPayload, {
          params: { access_token: accessToken },
        });
        return response.data;
      } catch (buttonErr) {
        handleIGError(buttonErr, 'sendDM');
      }
    }
  }

  try {
    if (isImageAttachmentUrl(attachmentUrl)) {
      await axios.post(
        `${INSTAGRAM_API}/${igUserId}/messages`,
        {
          recipient: { id: recipientId },
          message: { attachment: { type: 'image', payload: { url: attachmentUrl } } },
        },
        { params: { access_token: accessToken } },
      );
    }
    const response = await axios.post(
      `${INSTAGRAM_API}/${igUserId}/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      { params: { access_token: accessToken } }
    );
    return response.data;
  } catch (error) {
    handleIGError(error, 'sendDM');
  }
}

export async function privateReplyToComment(
  igUserId: string,
  commentId: string,
  message: string,
  accessToken: string,
  buttons?: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[],
  attachmentUrl?: string
): Promise<{ mid: string }> {
  const cleanButtons = sanitizeIGButtons(addPdfButton(buttons, attachmentUrl));

  if (cleanButtons?.length) {
    const { title, subtitle } = formatTemplateText(message);
    const element: any = {
      title,
      buttons: cleanButtons,
    };
    if (subtitle) element.subtitle = subtitle;
    if (isImageAttachmentUrl(attachmentUrl)) {
      element.image_url = attachmentUrl;
    }

    try {
      const genericPayload = {
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [element],
            },
          },
        },
      };
      const response = await axios.post(`${INSTAGRAM_API}/${igUserId}/messages`, genericPayload, {
        params: { access_token: accessToken },
      });
      return response.data;
    } catch (genericErr) {
      logger.warn('privateReplyToComment generic template failed, attempting button template fallback', {
        error: (genericErr as any)?.response?.data?.error?.message || (genericErr as Error)?.message,
      });
      try {
        const cleanText = message.replace(/[\r\n]+/g, ' ').trim().substring(0, 640);
        const buttonPayload = {
          recipient: { comment_id: commentId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text: cleanText || title,
                buttons: cleanButtons,
              },
            },
          },
        };
        const response = await axios.post(`${INSTAGRAM_API}/${igUserId}/messages`, buttonPayload, {
          params: { access_token: accessToken },
        });
        return response.data;
      } catch (buttonErr) {
        handleIGError(buttonErr, 'privateReplyToComment');
      }
    }
  }

  try {
    if (isImageAttachmentUrl(attachmentUrl)) {
      await axios.post(
        `${INSTAGRAM_API}/${igUserId}/messages`,
        {
          recipient: { comment_id: commentId },
          message: { attachment: { type: 'image', payload: { url: attachmentUrl } } },
        },
        { params: { access_token: accessToken } },
      );
    }
    const response = await axios.post(
      `${INSTAGRAM_API}/${igUserId}/messages`,
      {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      { params: { access_token: accessToken } }
    );
    return response.data;
  } catch (error) {
    handleIGError(error, 'privateReplyToComment');
  }
}

export async function publicReplyToComment(
  commentId: string,
  message: string,
  accessToken: string
): Promise<{ id: string }> {
  try {
    const response = await axios.post(
      `${INSTAGRAM_API}/${commentId}/replies`,
      null,
      { params: { message, access_token: accessToken } },
    );
    return response.data;
  } catch (error) {
    handleIGError(error, 'publicReplyToComment');
  }
}
