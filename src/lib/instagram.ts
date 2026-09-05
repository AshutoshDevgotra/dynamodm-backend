import axios, { AxiosError } from 'axios';
import { logger } from '../utils/logger';

const INSTAGRAM_API = `https://graph.instagram.com/v23.0`;

export interface IGProfile {
  id: string;
  username: string;
  account_type: string;
  followers_count: number;
  media_count: number;
  biography: string;
}

export interface IGMedia {
  id: string;
  caption?: string;
  like_count: number;
  comments_count: number;
  timestamp?: string;
  media_type?: string;
}

export interface IGShortLivedToken {
  access_token: string;
  user_id: string;
  token_type: string;
}

export interface IGLongLivedToken {
  access_token: string;
  token_type: string;
}

async function handleIGError(error: any, context: string): Promise<never> {
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
      `${INSTAGRAM_API}/oauth/access_token`,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    return response.data;
  } catch (error) {
    await handleIGError(error, 'exchangeCodeForToken');
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
    await handleIGError(error, 'exchangeToLongLivedToken');
  }
}

export async function getProfile(igUserId: string, accessToken: string): Promise<IGProfile> {
  try {
    const response = await axios.get(`${INSTAGRAM_API}/${igUserId}`, {
      params: {
        fields: 'id,username,account_type,followers_count,media_count,biography',
        access_token: accessToken,
      },
    });

    return response.data;
  } catch (error) {
    await handleIGError(error, 'getProfile');
  }
}

export async function getMedia(igUserId: string, accessToken: string, limit = 30): Promise<IGMedia[]> {
  try {
    const response = await axios.get(`${INSTAGRAM_API}/${igUserId}/media`, {
      params: {
        fields: 'id,caption,like_count,comments_count,timestamp,media_type',
        limit,
        access_token: accessToken,
      },
    });

    return response.data.data || [];
  } catch (error) {
    await handleIGError(error, 'getMedia');
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
    await handleIGError(error, 'sendDM');
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
    await handleIGError(error, 'privateReplyToComment');
  }
}
