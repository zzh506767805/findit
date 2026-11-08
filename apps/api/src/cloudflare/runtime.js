import { AsyncLocalStorage } from 'node:async_hooks';
export const requestRuntime = new AsyncLocalStorage();
export const cloudflareEnv = () => requestRuntime.getStore()?.env || null;
export const isCloudflare = () => process.env.FINDIT_RUNTIME === 'cloudflare';
