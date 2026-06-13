import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Build the API base as "<origin>/api". We extract only the first origin
// (protocol + host) from VITE_API_URL, so the value is robust to common
// misconfigurations: a missing or duplicated "/api", a trailing slash, or the
// whole URL accidentally pasted twice. When VITE_API_URL is unset, fall back to
// the relative "/api" (Vite dev proxy in dev / same-origin behind a proxy).
const RAW_API = (import.meta.env.VITE_API_URL as string)?.trim() || '';
const ORIGIN = RAW_API.match(/^https?:\/\/[^/\s]+/)?.[0];
const API_BASE = ORIGIN ? `${ORIGIN}/api` : '/api';

const ACCESS_KEY = 'izlearn_access';
const REFRESH_KEY = 'izlearn_refresh';

export const tokenStore = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
    const access = res.data?.data?.accessToken as string;
    if (access) {
      tokenStore.set(access);
      return access;
    }
    return null;
  } catch {
    tokenStore.clear();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const status = error.response?.status;

    // Inactivity lock — surfaced to the lock overlay.
    if (status === 423) {
      window.dispatchEvent(new CustomEvent('izlearn:locked'));
      return Promise.reject(error);
    }

    if (status === 401 && original && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true;
      refreshing = refreshing ?? doRefresh();
      const access = await refreshing;
      refreshing = null;
      if (access) {
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      }
      window.dispatchEvent(new CustomEvent('izlearn:unauthorized'));
    }
    return Promise.reject(error);
  },
);

/**
 * Extract a human-readable message from an Axios error. When the backend returns
 * field-level `details` (Zod validation errors, or any AppError with a details
 * array), surface the specific message(s) — e.g. "New signature and confirm
 * password must match" — instead of the generic top-level message. Falls back to
 * the generic message, then the Axios message, then a constant.
 */
export function apiError(e: unknown): string {
  const err = e as AxiosError<{
    error?: { message?: string; details?: Array<{ message?: string } | string> | unknown };
  }>;
  const data = err?.response?.data?.error;
  const details = data?.details;
  if (Array.isArray(details) && details.length) {
    const messages = details
      .map((d) => (typeof d === 'string' ? d : d?.message))
      .filter((m): m is string => typeof m === 'string' && m.length > 0);
    if (messages.length) return messages.join('; ');
  }
  return data?.message || err?.message || 'Request failed';
}
