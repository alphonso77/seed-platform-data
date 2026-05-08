import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Platform } from '../lib/types';
import { SeedForm } from '../components/SeedForm';
import { ResultDisplay } from '../components/ResultDisplay';
import { useValidate } from '../hooks/useValidate';
import { useSeed } from '../hooks/useSeed';
import { useCacheStatus } from '../hooks/useCacheStatus';

const platforms: { value: Platform; label: string }[] = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'hubspot', label: 'HubSpot' },
  { value: 'shopify', label: 'Shopify' },
];

const platformLabels: Record<Platform, string> = {
  stripe: 'Stripe',
  hubspot: 'HubSpot',
  shopify: 'Shopify',
};

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const seconds = Math.round(diffMs / 1000);
  if (Math.abs(seconds) < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(-days, 'day');
}

export function SeedPage() {
  const [searchParams] = useSearchParams();
  const initialPlatform = (searchParams.get('platform') as Platform) || 'stripe';
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [reuse, setReuse] = useState(false);

  const validate = useValidate();
  const seed = useSeed();
  const cacheStatus = useCacheStatus();

  // Validate environment when platform changes
  function handlePlatformChange(p: Platform) {
    setPlatform(p);
    setReuse(false);
    seed.reset();
    validate.mutate(p);
  }

  const cache = cacheStatus.data;
  const showReuse = !cacheStatus.isLoading && cache?.exists === true;

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">Seed Data</h2>

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

      {/* Environment check */}
      {validate.data && (
        <div
          className={`mb-6 rounded-lg border p-4 text-sm ${
            validate.data.overridden
              ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
              : validate.data.isSandbox
                ? 'border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400'
                : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          <div className="font-medium">
            {validate.data.overridden
              ? 'Sandbox override active'
              : validate.data.isSandbox
                ? 'Sandbox environment confirmed'
                : 'NOT a sandbox environment'}
          </div>
          <div className="mt-1 text-xs opacity-75">{validate.data.reason}</div>
        </div>
      )}

      {validate.error && (
        <div className="mb-6 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-600 dark:text-yellow-400">
          Could not validate environment: {validate.error.message}
        </div>
      )}

      {/* Reuse contacts toggle (only when cache exists) */}
      {showReuse && cache && (
        <label className="mb-6 flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={reuse}
            onChange={(e) => setReuse(e.target.checked)}
            className="rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
          />
          Reuse {cache.count} contacts from previous seed
          {cache.sourcePlatform && ` (${platformLabels[cache.sourcePlatform]}`}
          {cache.generatedAt && `, ${formatRelativeTime(cache.generatedAt)}`}
          {cache.sourcePlatform && ')'}
        </label>
      )}

      {/* Seed form */}
      <SeedForm
        platform={platform}
        isLoading={seed.isPending}
        onSubmit={(options) => seed.mutate({ platform, options, reuse })}
      />

      {/* Error */}
      {seed.error && (
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          {seed.error.message}
        </div>
      )}

      {/* Result */}
      {seed.data && (
        <div className="mt-6">
          <ResultDisplay type="seed" result={seed.data} />
        </div>
      )}
    </div>
  );
}
