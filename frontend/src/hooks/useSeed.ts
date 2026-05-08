import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Platform, SeedOptions, SeedResult } from '../lib/types';

export function useSeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      platform,
      options,
      reuse,
    }: {
      platform: Platform;
      options: SeedOptions;
      reuse?: boolean;
    }) =>
      apiFetch<SeedResult>(`/api/platforms/${platform}/seed`, {
        method: 'POST',
        body: JSON.stringify({ ...options, reuse }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cache-status', 'contacts'] });
    },
  });
}
