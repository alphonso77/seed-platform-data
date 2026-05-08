import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Platform, CleanResult } from '../lib/types';

export function useClean() {
  return useMutation({
    mutationFn: ({
      platform,
      dryRun,
      orphans,
    }: {
      platform: Platform;
      dryRun?: boolean;
      orphans?: boolean;
    }) =>
      apiFetch<CleanResult>(`/api/platforms/${platform}/clean`, {
        method: 'POST',
        body: JSON.stringify({ dryRun, orphans }),
      }),
  });
}
