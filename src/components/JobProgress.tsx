'use client';

import { memo, useMemo } from 'react';
import type { JobProgress as JobProgressType } from '@/types/database';

interface JobProgressProps {
  progress: JobProgressType;
}

export const JobProgress = memo(function JobProgress({ progress }: JobProgressProps) {
  const completionPercentage = useMemo(
    () =>
      progress.total_tasks > 0
        ? Math.round((progress.complete_tasks / progress.total_tasks) * 100)
        : 0,
    [progress.complete_tasks, progress.total_tasks]
  );

  return (
    <div className="space-y-4">
      {/* Progress bar */}
      <div>
        <div className="mb-2 flex justify-between">
          <span className="text-sm font-medium">Progreso General</span>
          <span className="text-sm font-medium">{completionPercentage}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-secondary">
          <div
            className="h-2.5 rounded-full bg-primary transition-all duration-300"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
        <StatCard label="Total" value={progress.total_tasks} />
        <StatCard label="Pendientes" value={progress.pending_tasks} variant="muted" />
        <StatCard label="En Proceso" value={progress.running_tasks} variant="info" />
        <StatCard label="Completados" value={progress.complete_tasks} variant="success" />
        <StatCard label="Fallidos" value={progress.failed_tasks} variant="error" />
        <StatCard label="Cancelados" value={progress.cancelled_tasks} variant="warning" />
      </div>
    </div>
  );
});

interface StatCardProps {
  label: string;
  value: number;
  variant?: 'default' | 'muted' | 'info' | 'success' | 'error' | 'warning';
}

const StatCard = memo(function StatCard({ label, value, variant = 'default' }: StatCardProps) {
  const variantStyles = {
    default: 'border-border',
    muted: 'border-muted-foreground/20',
    info: 'border-blue-500/20 bg-blue-50/50 dark:bg-blue-950/20',
    success: 'border-green-500/20 bg-green-50/50 dark:bg-green-950/20',
    error: 'border-red-500/20 bg-red-50/50 dark:bg-red-950/20',
    warning: 'border-orange-500/20 bg-orange-50/50 dark:bg-orange-950/20',
  };

  return (
    <div className={`rounded-lg border p-4 ${variantStyles[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="break-words text-sm text-muted-foreground">{label}</div>
    </div>
  );
});
