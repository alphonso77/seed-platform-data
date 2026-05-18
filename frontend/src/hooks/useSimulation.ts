import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch, apiFetchMultipart } from '../lib/api';
import type {
  CanonicalPerson,
  DirtyContact,
  SimulationReport,
  SimulationRunOptions,
  SimulationRunState,
  SimulationRunSummary,
  UploadResult,
} from '../lib/types';

const RUNS_KEY = ['simulation', 'runs'] as const;
const runKey = (runId: string) => ['simulation', 'run', runId] as const;

export function useRuns() {
  return useQuery({
    queryKey: RUNS_KEY,
    queryFn: () => apiFetch<SimulationRunSummary[]>('/api/simulation/runs'),
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: runId ? runKey(runId) : ['simulation', 'run', 'idle'],
    queryFn: () => apiFetch<SimulationRunState>(`/api/simulation/runs/${runId}`),
    enabled: !!runId,
  });
}

export function useGenerateRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: SimulationRunOptions) =>
      apiFetch<SimulationRunSummary>('/api/simulation/runs', {
        method: 'POST',
        body: JSON.stringify(options),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RUNS_KEY }),
  });
}

export function useUploadRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetch<UploadResult>(`/api/simulation/runs/${runId}/upload`, { method: 'POST' }),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
      qc.invalidateQueries({ queryKey: runKey(runId) });
    },
  });
}

export function useUploadOiCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, file }: { runId: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return apiFetchMultipart<{ runId: string; fileName: string; size: number }>(
        `/api/simulation/runs/${runId}/oi-result`,
        fd,
      );
    },
    onSuccess: (_data, { runId }) => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
      qc.invalidateQueries({ queryKey: runKey(runId) });
    },
  });
}

async function fetchArtifactJson<T>(runId: string, artifact: string): Promise<T> {
  const res = await fetch(`/api/simulation/runs/${runId}/artifacts/${artifact}`);
  if (!res.ok) {
    let message = `Failed to load ${artifact}`;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      // sendFile errors don't return JSON — fall back to status text
      message = `${message} (${res.status})`;
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export interface InspectorDataset {
  answerKey: CanonicalPerson[];
  stripe: DirtyContact[];
  hubspot: DirtyContact[];
  shopify: DirtyContact[];
}

export function useInspectorDataset(runId: string | null) {
  return useQuery({
    queryKey: runId ? (['simulation', 'inspector', runId] as const) : ['simulation', 'inspector', 'idle'],
    queryFn: async (): Promise<InspectorDataset> => {
      if (!runId) throw new Error('runId required');
      const [answerKey, stripe, hubspot, shopify] = await Promise.all([
        fetchArtifactJson<CanonicalPerson[]>(runId, 'answer-key.json'),
        fetchArtifactJson<DirtyContact[]>(runId, 'stripe-dirty.json'),
        fetchArtifactJson<DirtyContact[]>(runId, 'hubspot-dirty.json'),
        fetchArtifactJson<DirtyContact[]>(runId, 'shopify-dirty.json'),
      ]);
      return { answerKey, stripe, hubspot, shopify };
    },
    enabled: !!runId,
    staleTime: Infinity,
  });
}

export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) =>
      apiFetch<SimulationReport>(`/api/simulation/runs/${runId}/report`, { method: 'POST' }),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: RUNS_KEY });
      qc.invalidateQueries({ queryKey: runKey(runId) });
    },
  });
}
