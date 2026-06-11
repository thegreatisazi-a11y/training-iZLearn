import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Normalise the configured API origin so it ALWAYS targets exactly one `/api`
// segment — VITE_API_URL works whether it's set to the bare origin
// ("https://api.example.com"), already ends in "/api", or has a trailing slash.
// Falls back to the relative "/api" (Vite dev proxy / same-origin) when unset.
const RAW_API = (import.meta.env.VITE_API_URL as string)?.trim() || '/api';
const API_BASE = RAW_API.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';

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

/** Extract a human-readable message from an Axios error. */
export function apiError(e: unknown): string {
  const err = e as AxiosError<{ error?: { message?: string } }>;
  return err?.response?.data?.error?.message || err?.message || 'Request failed';
}
