import { api } from '@/lib/axios';

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  includeInactive?: boolean;
  [key: string]: unknown;
}

export interface Paged<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Generic CRUD client matching the backend's response envelopes. */
export function createCrud<T = Record<string, unknown>>(base: string) {
  return {
    list: async (params?: ListParams): Promise<Paged<T>> => (await api.get(base, { params })).data,
    get: async (id: string): Promise<T> => (await api.get(`${base}/${id}`)).data.data,
    create: async (body: unknown): Promise<T> => (await api.post(base, body)).data.data,
    update: async (id: string, body: unknown): Promise<T> => (await api.patch(`${base}/${id}`, body)).data.data,
    remove: async (id: string, reasonForChange?: string) => (await api.delete(`${base}/${id}`, { data: { reasonForChange } })).data,
  };
}
