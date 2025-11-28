import { Badge } from '@/components/ui/badge';
import type { ViolationSeverity } from '@tracearr/shared';
import { SEVERITY_LEVELS } from '@tracearr/shared';
import { cn } from '@/lib/utils';

interface SeverityBadgeProps {
  severity: ViolationSeverity;
  className?: string;
}

const severityVariants: Record<ViolationSeverity, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  warning: 'warning',
  high: 'danger',
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <Badge variant={severityVariants[severity]} className={cn(className)}>
      {SEVERITY_LEVELS[severity].label}
    </Badge>
  );
}
