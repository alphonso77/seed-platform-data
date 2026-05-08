import { useState } from 'react';
import type { Platform, DatasetSize, SeedOptions } from '../lib/types';
import { DATASET_SIZES } from '../lib/types';

interface SeedFormProps {
  platform: Platform;
  onSubmit: (options: SeedOptions) => void;
  isLoading: boolean;
}

const sizeLabels: Record<DatasetSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

export function SeedForm({ platform, onSubmit, isLoading }: SeedFormProps) {
  const [size, setSize] = useState<DatasetSize>('small');
  const [useRandomDomains, setUseRandomDomains] = useState(true);
  const [customDomains, setCustomDomains] = useState('');
  const [dryRun, setDryRun] = useState(false);

  const counts = DATASET_SIZES[size];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailDomains = useRandomDomains
      ? []
      : customDomains.split(',').map((d) => d.trim()).filter(Boolean);
    onSubmit({ size, emailDomains, useRandomDomains, dryRun });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Size Selection */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">Dataset Size</label>
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
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{sizeLabels[s]}</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {DATASET_SIZES[s].contacts} contacts, {DATASET_SIZES[s].products} products, {DATASET_SIZES[s].orders} orders
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Preview for {platform}</div>
        <div className="mt-2 flex gap-6 text-sm">
          <span className="text-gray-900 dark:text-white"><strong className="text-teal-600 dark:text-teal-400">{counts.contacts}</strong> contacts</span>
          <span className="text-gray-900 dark:text-white"><strong className="text-teal-600 dark:text-teal-400">{counts.products}</strong> products</span>
          <span className="text-gray-900 dark:text-white"><strong className="text-teal-600 dark:text-teal-400">{counts.orders}</strong> orders</span>
        </div>
      </div>

      {/* Email Domains */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">Email Domains</label>
        <div className="mb-3 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={useRandomDomains}
              onChange={(e) => setUseRandomDomains(e.target.checked)}
              className="rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
            />
            Use random @example.com domains
          </label>
        </div>
        {!useRandomDomains && (
          <input
            type="text"
            value={customDomains}
            onChange={(e) => setCustomDomains(e.target.value)}
            placeholder="e.g. company.com, test.org"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
          />
        )}
      </div>

      {/* Dry Run Toggle */}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          checked={dryRun}
          onChange={(e) => setDryRun(e.target.checked)}
          className="rounded border-gray-300 bg-white text-teal-500 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-800"
        />
        Dry run (preview only, no data created)
      </label>

      {/* Submit */}
      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? 'Seeding...' : `Seed ${platform}`}
      </button>
    </form>
  );
}
