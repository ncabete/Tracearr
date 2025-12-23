/**
 * Summary statistics display for history page.
 * Shows aggregate totals for filtered results.
 */

import { Play, Clock, Users, Film } from 'lucide-react';
import { StatCard, formatWatchTime, formatNumber } from '@/components/ui/stat-card';
import type { HistoryAggregates as AggregatesType } from '@tracearr/shared';

interface Props {
  aggregates?: AggregatesType;
  total?: number;
  isLoading?: boolean;
}

export function HistoryAggregates({ aggregates, total, isLoading }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard
        icon={Play}
        label="Total Plays"
        value={formatNumber(total ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Clock}
        label="Watch Time"
        value={formatWatchTime(aggregates?.totalWatchTimeMs ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Users}
        label="Unique Users"
        value={formatNumber(aggregates?.uniqueUsers ?? 0)}
        isLoading={isLoading}
      />
      <StatCard
        icon={Film}
        label="Unique Titles"
        value={formatNumber(aggregates?.uniqueContent ?? 0)}
        isLoading={isLoading}
      />
    </div>
  );
}
