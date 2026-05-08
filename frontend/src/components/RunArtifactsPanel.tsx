import type { ArtifactName, RunStage } from '../lib/types';

interface ArtifactDef {
  name: ArtifactName;
  label: string;
  minStage: RunStage;
}

const ARTIFACTS: ArtifactDef[] = [
  { name: 'answer-key.json', label: 'Answer key', minStage: 'generated' },
  { name: 'stripe-dirty.json', label: 'Stripe dirty', minStage: 'generated' },
  { name: 'hubspot-dirty.json', label: 'HubSpot dirty', minStage: 'generated' },
  { name: 'shopify-dirty.json', label: 'Shopify dirty', minStage: 'generated' },
  { name: 'upload-result.json', label: 'Upload result', minStage: 'uploaded' },
  { name: 'oi-result.csv', label: 'OI result CSV', minStage: 'oi-uploaded' },
  { name: 'report.json', label: 'Report (JSON)', minStage: 'reported' },
  { name: 'report.csv', label: 'Report (CSV)', minStage: 'reported' },
];

const STAGE_RANK: Record<RunStage, number> = {
  generated: 1,
  uploaded: 2,
  'oi-uploaded': 3,
  reported: 4,
};

interface Props {
  runId: string;
  stage: RunStage;
}

export function RunArtifactsPanel({ runId, stage }: Props) {
  const reached = STAGE_RANK[stage];
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Artifacts
      </div>
      <ul className="grid grid-cols-2 gap-2 text-sm">
        {ARTIFACTS.map((a) => {
          const available = STAGE_RANK[a.minStage] <= reached;
          if (!available) {
            return (
              <li
                key={a.name}
                className="flex items-center justify-between rounded px-2 py-1 text-gray-400 dark:text-gray-600"
              >
                <span>{a.label}</span>
                <span className="text-xs">—</span>
              </li>
            );
          }
          return (
            <li key={a.name}>
              <a
                href={`/api/simulation/runs/${runId}/artifacts/${a.name}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded px-2 py-1 text-teal-600 hover:bg-teal-500/10 dark:text-teal-400"
              >
                <span>{a.label}</span>
                <span className="text-xs opacity-60">↓</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
