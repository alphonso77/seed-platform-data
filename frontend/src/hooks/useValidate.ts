import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { Platform, EnvironmentCheck } from '../lib/types';

export function useValidate() {
  return useMutation({
    mutationFn: (platform: Platform) =>
      apiFetch<EnvironmentCheck>(`/api/platforms/${platform}/validate`, {
        method: 'POST',
      }),
  });
}
