import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import type { PlatformStatus } from '../lib/types';

const platformColors: Record<string, string> = {
  stripe: 'border-violet-500/30 bg-violet-500/5',
  hubspot: 'border-orange-500/30 bg-orange-500/5',
  shopify: 'border-green-500/30 bg-green-500/5',
};

const platformIconColors: Record<string, string> = {
  stripe: 'bg-violet-500/20 text-violet-400',
  hubspot: 'bg-orange-500/20 text-orange-400',
  shopify: 'bg-green-500/20 text-green-400',
};

export function PlatformCard({ platform, label, connected, environment }: PlatformStatus) {
  return (
    <div className={`rounded-xl border p-6 ${platformColors[platform] || 'border-gray-200 bg-gray-100/50 dark:border-gray-700 dark:bg-gray-800/50'}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold ${platformIconColors[platform]}`}>
            {label[0]}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">{label}</h3>
            <StatusBadge connected={connected} environment={environment} />
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <Link
          to={`/seed?platform=${platform}`}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-teal-500"
        >
          Seed Data
        </Link>
        <Link
          to={`/clean?platform=${platform}`}
          className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          Clean
        </Link>
      </div>
    </div>
  );
}
