import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';

const INSTAGRAM_API = `https://graph.instagram.com/v23.0`;
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';

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
  fields = 'id,caption,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp,media_type'
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

export async function sendDM(
  igUserId: string,
  recipientId: string,
  message: string,
  accessToken: string,
  buttons?: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[]
): Promise<{ mid: string }> {
  try {
    const messagePayload = buttons?.length
      ? { attachment: { type: 'template', payload: { template_type: 'button', text: message, buttons } } }
      : { text: message };
    const response = await axios.post(
      `${INSTAGRAM_API}/${igUserId}/messages`,
      {
        recipient: { id: recipientId },
        message: messagePayload,
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
  buttons?: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[]
): Promise<{ mid: string }> {
  try {
    const messagePayload = buttons?.length
      ? { attachment: { type: 'template', payload: { template_type: 'button', text: message, buttons } } }
      : { text: message };
    const response = await axios.post(
      `${INSTAGRAM_API}/${igUserId}/messages`,
      {
        recipient: { comment_id: commentId },
        message: messagePayload,
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
