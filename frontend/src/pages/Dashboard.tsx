import { usePlatforms } from '../hooks/usePlatforms';
import { PlatformCard } from '../components/PlatformCard';

export function Dashboard() {
  const { data: platforms, isLoading, error } = usePlatforms();

  return (
    <div>
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h2>

      {isLoading && (
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading platform status...</div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400">
          Failed to load platforms: {error.message}
        </div>
      )}

      {platforms && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {platforms.map((p) => (
            <PlatformCard key={p.platform} {...p} />
          ))}
        </div>
      )}
    </div>
  );
}
