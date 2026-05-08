interface StatusBadgeProps {
  connected: boolean;
  environment?: string;
}

export function StatusBadge({ connected, environment }: StatusBadgeProps) {
  if (connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/15 px-2.5 py-1 text-xs font-medium text-teal-600 dark:text-teal-400">
        <span className="h-1.5 w-1.5 rounded-full bg-teal-500 dark:bg-teal-400" />
        Connected{environment ? ` (${environment})` : ''}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-600 dark:text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500 dark:bg-red-400" />
      Disconnected
    </span>
  );
}
