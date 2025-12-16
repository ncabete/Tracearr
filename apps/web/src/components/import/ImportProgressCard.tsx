import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Progress } from '../ui/progress';
import { cn } from '@/lib/utils';

export type ImportStatus = 'idle' | 'fetching' | 'processing' | 'complete' | 'error';

export interface ImportProgressData {
  status: ImportStatus;
  message?: string;
  totalRecords: number;
  processedRecords: number;
  importedRecords: number;
  skippedRecords: number;
  errorRecords: number;
  // Tautulli-specific
  currentPage?: number;
  totalPages?: number;
  // Jellystat-specific
  enrichedRecords?: number;
}

interface ImportProgressCardProps {
  progress: ImportProgressData;
  showPageProgress?: boolean;
}

export function ImportProgressCard({ progress, showPageProgress = false }: ImportProgressCardProps) {
  const isActive = progress.status === 'fetching' || progress.status === 'processing';
  const isComplete = progress.status === 'complete';
  const isError = progress.status === 'error';

  const percentComplete = progress.totalRecords > 0
    ? Math.min(100, Math.round((progress.processedRecords / progress.totalRecords) * 100))
    : 0;

  const statusLabel = isComplete
    ? 'Import Complete'
    : isError
      ? 'Import Failed'
      : 'Importing...';

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {/* Header with status */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{statusLabel}</span>
        {isComplete && <CheckCircle2 className="h-5 w-5 text-green-600" />}
        {isError && <XCircle className="h-5 w-5 text-destructive" />}
        {isActive && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      </div>

      {/* Message */}
      {progress.message && (
        <p className={cn(
          'text-sm',
          isError ? 'text-destructive' : 'text-muted-foreground'
        )}>
          {progress.message}
        </p>
      )}

      {/* Progress bar and stats - only when we have records */}
      {progress.totalRecords > 0 && (
        <>
          <Progress
            value={isComplete ? 100 : percentComplete}
            className="h-2"
          />

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Processed:</span>{' '}
              <span className="font-medium">
                {progress.processedRecords.toLocaleString()} / {progress.totalRecords.toLocaleString()}
              </span>
            </div>

            {showPageProgress && progress.currentPage !== undefined && progress.totalPages !== undefined && (
              <div>
                <span className="text-muted-foreground">Page:</span>{' '}
                <span className="font-medium">
                  {progress.currentPage} / {progress.totalPages}
                </span>
              </div>
            )}

            <div>
              <span className="text-muted-foreground">Imported:</span>{' '}
              <span className="font-medium text-green-600">
                {progress.importedRecords.toLocaleString()}
              </span>
            </div>

            <div>
              <span className="text-muted-foreground">Skipped:</span>{' '}
              <span className="font-medium text-yellow-600">
                {progress.skippedRecords.toLocaleString()}
              </span>
            </div>

            {progress.enrichedRecords !== undefined && progress.enrichedRecords > 0 && (
              <div>
                <span className="text-muted-foreground">Enriched:</span>{' '}
                <span className="font-medium text-blue-600">
                  {progress.enrichedRecords.toLocaleString()}
                </span>
              </div>
            )}

            {progress.errorRecords > 0 && (
              <div>
                <span className="text-muted-foreground">Errors:</span>{' '}
                <span className="font-medium text-destructive">
                  {progress.errorRecords.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
