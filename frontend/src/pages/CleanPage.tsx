import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, apiFetch } from '../lib/api';
import type { CleanResult, Platform } from '../lib/types';
import { ResultDisplay } from '../components/ResultDisplay';
import { useClean } from '../hooks/useClean';

const platforms: { value: Platform; label: string }[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'hubspot', label: 'HubSpot' },
  { value: 'shopify', label: 'Shopify' },
];

const ALL_PLATFORMS: Platform[] = ['stripe', 'hubspot', 'shopify'];

interface CleanAllState {
  running: boolean;
  current: Platform | null;
  results: CleanResult[];
  errors: { platform: Platform; message: string }[];
}

const INITIAL_ALL_STATE: CleanAllState = {
  running: false,
  current: null,
  results: [],
  errors: [],
};

export function CleanPage() {
  const [searchParams] = useSearchParams();
  const initialPlatform = (searchParams.get('platform') as Platform) || 'stripe';
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [dryRun, setDryRun] = useState(false);
  const [orphans, setOrphans] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAllConfirm, setShowAllConfirm] = useState(false);
  const [allState, setAllState] = useState<CleanAllState>(INITIAL_ALL_STATE);

  const clean = useClean();

  function handlePlatformChange(p: Platform) {
    setPlatform(p);
    clean.reset();
    setShowConfirm(false);
    if (p !== 'hubspot') setOrphans(false);
  }

  function handleClean() {
    if (!dryRun && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    clean.mutate({ platform, dryRun, orphans });
  }

  async function handleCleanAll() {
    if (!dryRun && !showAllConfirm) {
      setShowAllConfirm(true);
      return;
    }
    setShowAllConfirm(false);
    setAllState({ running: true, current: ALL_PLATFORMS[0], results: [], errors: [] });
    const results: CleanResult[] = [];
    const errors: { platform: Platform; message: string }[] = [];
    for (const p of ALL_PLATFORMS) {
      setAllState((s) => ({ ...s, current: p }));
      try {
        const result = await apiFetch<CleanResult>(`/api/platforms/${p}/clean`, {
          method: 'POST',
          body: JSON.stringify({ dryRun, orphans: p === 'hubspot' ? orphans : false }),
        });
        results.push(result);
      } catch (err) {
        const message = err instanceof ApiError || err instanceof Error ? err.message : String(err);
        errors.push({ platform: p, message });
      }
    }
    setAllState({ running: false, current: null, results, errors });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">Clean Seeded Data</h2>

      {/* Platform selector */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">Platform</label>
        <div className="flex gap-2">
          {platforms.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handlePlatformChange(value)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                platform === value
                  ? 'border-teal-500 bg-teal-500/10 text-teal-600 dark:text-teal-400'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Dry run toggle */}
      <label className="mb-6 flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => {
            setDryRun(e.target.checked);
            setShowConfirm(false);
          }}
          className="rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
        />
        Dry run (preview only, nothing deleted)
      </label>

      {/* Orphan recovery — HubSpot only */}
      {platform === 'hubspot' && (
        <label className="mb-6 flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={orphans}
            onChange={(e) => setOrphans(e.target.checked)}
            className="rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
          />
          Recover orphaned deals (HubSpot only — finds deals by name when the seeded tag is missing)
        </label>
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
            This will permanently delete all seeded data from {platform}. Are you sure?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleClean}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
            >
              Yes, delete seeded data
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Execute button (hidden when confirm is shown) */}
      {!showConfirm && (
        <button
          onClick={handleClean}
          disabled={clean.isPending}
          className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clean.isPending ? 'Cleaning...' : dryRun ? `Preview clean for ${platform}` : `Clean ${platform}`}
        </button>
      )}

      {/* Error */}
      {clean.error && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          {clean.error.message}
        </div>
      )}

      {/* Result */}
      {clean.data && (
        <div className="mt-6">
          <ResultDisplay type="clean" result={clean.data} />
        </div>
      )}

      {/* Clean all platforms */}
      <div className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-700">
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
          Or clean all platforms
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Runs Stripe, HubSpot, and Shopify cleans sequentially. Each platform runs independently —
          an error on one does not skip the others. Uses the dry-run toggle above and (for HubSpot)
          the orphan-recovery toggle.
        </p>

        {showAllConfirm && (
          <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              This will permanently delete all seeded data from Stripe, HubSpot, and Shopify. Are you sure?
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleCleanAll}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
              >
                Yes, clean all three platforms
              </button>
              <button
                onClick={() => setShowAllConfirm(false)}
                className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!showAllConfirm && (
          <button
            onClick={handleCleanAll}
            disabled={allState.running}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {allState.running
              ? `Cleaning ${allState.current ?? ''}…`
              : dryRun
                ? 'Preview clean for all platforms'
                : 'Clean all three platforms'}
          </button>
        )}

        {(allState.results.length > 0 || allState.errors.length > 0) && (
          <div className="mt-6 space-y-4">
            {allState.results.map((r) => (
              <ResultDisplay key={r.platform} type="clean" result={r} />
            ))}
            {allState.errors.map((e) => (
              <div
                key={e.platform}
                className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400"
              >
                <span className="font-semibold capitalize">{e.platform}:</span> {e.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
