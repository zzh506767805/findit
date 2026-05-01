import { Platform } from 'react-native';
import Constants from 'expo-constants';

const PRODUCTION_API = 'https://findit-api.livelysky-debdec5e.japaneast.azurecontainerapps.io';

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

export async function requestJson(path, { apiUrl, token, method = 'GET', body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export function fullImageUrl(apiUrl, path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${apiUrl}${path}`;
}
