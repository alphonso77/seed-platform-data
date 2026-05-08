import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Platform } from '../lib/types';

export interface ContactsCacheStatus {
  exists: boolean;
  generatedAt?: string;
  sourcePlatform?: Platform;
  count?: number;
}

export function useCacheStatus() {
  return useQuery({
    queryKey: ['cache-status', 'contacts'],
    queryFn: () => apiFetch<ContactsCacheStatus>('/api/cache/contacts'),
  });
}
