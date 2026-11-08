import { getLocales } from 'expo-localization';
import { setMediaSession } from './media-auth';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const PRODUCTION_API = 'https://findit-api.dressmeai.com';

export function getDefaultApiUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured;

  if (__DEV__) {
    if (Platform.OS === 'web') return 'http://localhost:4000';
    const hostUri =
      Constants.expoConfig?.hostUri ||
      Constants.manifest2?.extra?.expoClient?.hostUri ||
      Constants.manifest?.debuggerHost;
    const host = hostUri?.split(':')[0];
    if (host) return `http://${host}:4000`;
    return 'http://127.0.0.1:4000';
  }

  return PRODUCTION_API;
}

export function requestLanguage() { return getLocales()[0]?.languageTag || 'en'; }

export async function requestJson(path, { apiUrl, token, method = 'GET', body } = {}) {
  if (token) setMediaSession(apiUrl,token);
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': requestLanguage(),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    if (data.code) error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

export function fullImageUrl(apiUrl, path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${apiUrl}${path}`;
}

export function mediaImageUrl(apiUrl, mediaAssetId, variant = 'thumb') {
  if (!mediaAssetId) return null;
  return `${apiUrl}/media/${encodeURIComponent(mediaAssetId)}/${variant}`;
}

export function mediaPreviewUrl(apiUrl, mediaAssetId, hasThumbnail) {
  if (!mediaAssetId) return null;
  return mediaImageUrl(apiUrl, mediaAssetId, hasThumbnail ? 'thumb' : 'original');
}
