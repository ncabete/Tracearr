import { useState, useEffect, useCallback, useRef } from 'react';
import { Pencil, X, FlaskConical, Loader2, Check } from 'lucide-react';
import type { NotificationChannelRouting, NotificationEventType } from '@tracearr/shared';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ActiveAgent, RoutingChannel } from './types';
import { NOTIFICATION_EVENT_ORDER, NOTIFICATION_EVENT_CONFIG } from './types';

interface AgentCardProps {
  agent: ActiveAgent;
  routingData: NotificationChannelRouting[];
  onToggleEvent: (
    eventType: NotificationEventType,
    channel: RoutingChannel,
    enabled: boolean
  ) => void;
  onEdit: () => void;
  onRemove: () => void;
  onTest: () => void;
  isTesting: boolean;
}

export function AgentCard({
  agent,
  routingData,
  onToggleEvent,
  onEdit,
  onRemove,
  onTest,
  isTesting,
}: AgentCardProps) {
  const { config, displayValue, isConfigured } = agent;
  const Icon = config.icon;

  // Track save status per event - shows "Saved" briefly after toggle
  const [savedEvents, setSavedEvents] = useState<Set<string>>(new Set());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Build routing map for quick lookup
  const routingMap = new Map<NotificationEventType, NotificationChannelRouting>();
  routingData.forEach((r) => routingMap.set(r.eventType, r));

  // Get the enabled state for this agent's channel
  const getEventEnabled = (eventType: NotificationEventType): boolean => {
    const routing = routingMap.get(eventType);
    if (!routing) return false;

    switch (config.routingChannel) {
      case 'webToast':
        return routing.webToastEnabled;
      case 'discord':
        return routing.discordEnabled;
      case 'webhook':
        return routing.webhookEnabled;
      case 'push':
        return routing.pushEnabled;
      default:
        return false;
    }
  };

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const handleToggle = useCallback(
    (eventType: NotificationEventType, checked: boolean) => {
      // Trigger the mutation
      onToggleEvent(eventType, config.routingChannel, checked);

      // Show "Saved" immediately (optimistic - the mutation has optimistic updates)
      setSavedEvents((prev) => new Set(prev).add(eventType));

      // Clear any existing timer for this event
      if (timersRef.current[eventType]) {
        clearTimeout(timersRef.current[eventType]);
      }

      // Clear the "Saved" indicator after 2 seconds
      const timerId = setTimeout(() => {
        setSavedEvents((prev) => {
          const next = new Set(prev);
          next.delete(eventType);
          return next;
        });
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete timersRef.current[eventType];
      }, 2000);
      timersRef.current[eventType] = timerId;
    },
    [onToggleEvent, config.routingChannel]
  );

  const getStatusIndicator = (eventType: NotificationEventType) => {
    if (!savedEvents.has(eventType)) return null;

    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
        <Check className="h-3 w-3" />
        <span>Saved</span>
      </span>
    );
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="bg-muted flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg">
              {config.imagePath ? (
                <img
                  src={config.imagePath}
                  alt={config.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Icon className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{config.name}</h3>
                {config.isDefault && (
                  <Badge variant="secondary" className="text-xs">
                    Default
                  </Badge>
                )}
              </div>
              {displayValue ? (
                <p className="text-muted-foreground truncate text-sm">{displayValue}</p>
              ) : (
                <p className="text-muted-foreground text-sm">{config.description}</p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {config.fields.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            )}
            {config.isRemovable && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive h-8 w-8"
                    onClick={onRemove}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        {/* Event checkboxes */}
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Events
          </p>
          <div className="grid grid-cols-1 gap-2">
            {NOTIFICATION_EVENT_ORDER.map((eventType) => {
              const eventConfig = NOTIFICATION_EVENT_CONFIG[eventType];
              if (!eventConfig) return null;

              const isEnabled = getEventEnabled(eventType);

              return (
                <div key={eventType} className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={isEnabled}
                      onCheckedChange={(checked) => handleToggle(eventType, checked === true)}
                      disabled={!isConfigured}
                    />
                    <span className={!isConfigured ? 'text-muted-foreground' : ''}>
                      {eventConfig.name}
                    </span>
                  </label>
                  {getStatusIndicator(eventType)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Test button */}
        {isConfigured && config.type !== 'webToast' && config.type !== 'push' && (
          <div className="mt-auto pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onTest}
              disabled={isTesting}
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <FlaskConical className="mr-2 h-4 w-4" />
                  Send Test
                </>
              )}
            </Button>
          </div>
        )}

        {/* Not configured warning */}
        {!isConfigured && (
          <div className="mt-auto">
            <p className="text-muted-foreground text-center text-sm">
              Not fully configured.{' '}
              <button onClick={onEdit} className="text-primary hover:underline">
                Edit settings
              </button>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
