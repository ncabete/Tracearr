import { Badge } from '@/components/ui/badge';
import type { SessionState } from '@tracearr/shared';
import { cn } from '@/lib/utils';
import { Play, Pause, Square } from 'lucide-react';

interface ActiveSessionBadgeProps {
  state: SessionState;
  className?: string;
}

const stateConfig: Record<
  SessionState,
  { variant: 'success' | 'warning' | 'secondary'; label: string; icon: typeof Play }
> = {
  playing: { variant: 'success', label: 'Playing', icon: Play },
  paused: { variant: 'warning', label: 'Paused', icon: Pause },
  stopped: { variant: 'secondary', label: 'Stopped', icon: Square },
};

export function ActiveSessionBadge({ state, className }: ActiveSessionBadgeProps) {
  const config = stateConfig[state];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={cn('gap-1', className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
