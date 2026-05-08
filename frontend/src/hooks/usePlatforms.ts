import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { PlatformStatus } from '../lib/types';

export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: () => apiFetch<PlatformStatus[]>('/api/platforms'),
  });
}
