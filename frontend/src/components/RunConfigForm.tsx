import { useState } from 'react';
import type { DatasetSize, Platform, SimulationRunOptions } from '../lib/types';
import { DATASET_SIZES } from '../lib/types';

interface Props {
  onSubmit: (options: SimulationRunOptions) => void;
  isLoading: boolean;
}

const sizeLabels: Record<DatasetSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

const ALL_PLATFORMS: Platform[] = ['stripe', 'hubspot', 'shopify'];
const platformLabels: Record<Platform, string> = {
  stripe: 'Stripe',
  hubspot: 'HubSpot',
  shopify: 'Shopify',
};

export function RunConfigForm({ onSubmit, isLoading }: Props) {
  const [size, setSize] = useState<DatasetSize>('small');
  const [fragment, setFragment] = useState(true);
  const [duplicate, setDuplicate] = useState(true);
  const [fuzzy, setFuzzy] = useState(false);
  const [platforms, setPlatforms] = useState<Platform[]>(ALL_PLATFORMS);

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (platforms.length === 0) return;
    onSubmit({ size, fragment, duplicate, fuzzy, platforms });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
          Answer-key size
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(['small', 'medium', 'large'] as DatasetSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={`rounded-lg border p-4 text-left transition ${
                size === s
                  ? 'border-teal-500 bg-teal-500/10'
                  : 'border-gray-200 bg-gray-100/50 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-gray-600'
              }`}
            >
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {sizeLabels[s]}
              </div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {DATASET_SIZES[s].contacts} canonical persons
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
          Platforms to upload
        </label>
        <div className="grid grid-cols-3 gap-3">
          {ALL_PLATFORMS.map((p) => {
            const checked = platforms.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`rounded-lg border p-3 text-left transition ${
                  checked
                    ? 'border-teal-500 bg-teal-500/10'
                    : 'border-gray-200 bg-gray-100/50 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:border-gray-600'
                }`}
              >
                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                  {platformLabels[p]}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {checked ? 'Will upload' : 'Skipped'}
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Disable any platform whose ingestion isn&apos;t wired up yet — including Shopify if its
          app is still under review. Records for skipped platforms aren&apos;t uploaded and don&apos;t
          appear in the answer-key expectations, so the grade reflects only the platforms you
          actually tested. At least one platform must be selected.
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={fragment}
            onChange={(e) => setFragment(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <div>
            <div className="font-medium text-gray-800 dark:text-gray-200">Fragmentation</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Drop random subsets of fields per platform — at least one identifier (email or phone)
              always remains.
            </div>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={duplicate}
            onChange={(e) => setDuplicate(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <div>
            <div className="font-medium text-gray-800 dark:text-gray-200">Duplication</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Stripe: same email, different attributes. HubSpot: same phone, different emails.
              Shopify: split phone-only / email-only.
            </div>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={fuzzy}
            onChange={(e) => setFuzzy(e.target.checked)}
            className="mt-0.5 rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <div>
            <div className="font-medium text-gray-800 dark:text-gray-200">Fuzzy duplicates (Tier 2)</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              Emit duplicates that miss Tier 1 — nickname / typo names and abbreviated street
              suffixes — to exercise the upstream fuzzy resolver and its review queue.
            </div>
          </div>
        </label>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400">
        <div className="font-medium text-gray-800 dark:text-gray-200">Customer-only scope</div>
        <div className="mt-1">
          Simulation runs upload <strong>customer records only</strong> to the selected platforms —
          no products or orders. The integration system currently ingests customer objects, so
          identity resolution is the only thing being graded. When order ingestion is added later,
          the run will extend to include orders.
        </div>
      </div>

      <button
        type="submit"
        disabled={isLoading || platforms.length === 0}
        className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? 'Generating…' : 'Generate run'}
      </button>
    </form>
  );
}
