import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';

const INSTAGRAM_API = `https://graph.instagram.com/v23.0`;
const INSTAGRAM_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';

export interface IGProfile {
  id: string;
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
    const response = await axios.get(`${INSTAGRAM_API}/${igUserId}`, {
      params: {
        fields: 'id,username,account_type,followers_count,media_count,biography,profile_picture_url',
        access_token: accessToken,
      },
    });

    return response.data;
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

export async function sendDM(
  igUserId: string,
  recipientId: string,
  message: string,
  accessToken: string
): Promise<{ mid: string }> {
  try {
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
  accessToken: string
): Promise<{ mid: string }> {
  try {
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
