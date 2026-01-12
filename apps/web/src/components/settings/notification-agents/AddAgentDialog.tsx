import { useState, useEffect } from 'react';
import type { Settings } from '@tracearr/shared';
import { Loader2, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateSettings } from '@/hooks/queries/useSettings';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { NotificationAgentType } from './types';
import { AGENT_CONFIGS, CUSTOM_WEBHOOK_AGENTS } from './agent-config';

interface AddAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableTypes: NotificationAgentType[];
  settings: Settings | undefined;
}

export function AddAgentDialog({
  open,
  onOpenChange,
  availableTypes,
  settings,
}: AddAgentDialogProps) {
  const updateSettings = useUpdateSettings({ silent: true });
  const [selectedType, setSelectedType] = useState<NotificationAgentType | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setSelectedType(null);
      setFormData({});
    }
  }, [open]);

  // When type is selected, initialize form with current settings values
  useEffect(() => {
    if (selectedType && settings) {
      const config = AGENT_CONFIGS[selectedType];
      const initialData: Record<string, string> = {};

      config.fields.forEach((field) => {
        const value = settings[field.key as keyof Settings];
        if (value != null) {
          initialData[field.key] = String(value);
        }
      });

      setFormData(initialData);
    }
  }, [selectedType, settings]);

  const selectedConfig = selectedType ? AGENT_CONFIGS[selectedType] : null;

  const handleFieldChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const canSave = () => {
    if (!selectedConfig) return false;

    // Check all required fields are filled
    return selectedConfig.fields.filter((f) => f.required).every((f) => formData[f.key]?.trim());
  };

  const handleSave = async () => {
    if (!selectedConfig) return;

    // Build settings update
    const update: Partial<Settings> = {};

    // Set the fields
    selectedConfig.fields.forEach((field) => {
      const value = formData[field.key]?.trim();
      if (value) {
        (update as Record<string, string>)[field.key] = value;
      }
    });

    // Set webhookFormat for custom webhook agents
    if (selectedConfig.webhookFormat) {
      update.webhookFormat = selectedConfig.webhookFormat;
    }

    try {
      await updateSettings.mutateAsync(update);
      toast.success(`${selectedConfig.name} Added`, {
        description: 'Notification agent has been configured.',
      });
      onOpenChange(false);
    } catch {
      toast.error('Failed to Add Agent');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Notification Agent</DialogTitle>
          <DialogDescription>Choose a notification service and configure it.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Agent type selector */}
          {!selectedType && (
            <div className="space-y-2">
              {availableTypes.map((type) => {
                const config = AGENT_CONFIGS[type];
                const Icon = config.icon;

                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedType(type)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      'hover:bg-muted hover:border-primary/50'
                    )}
                  >
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
                    <div className="flex-1">
                      <p className="font-medium">{config.name}</p>
                      <p className="text-muted-foreground text-xs">{config.description}</p>
                    </div>
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Configuration fields */}
          {selectedConfig && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 border-b pb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedType(null)}
                  className="h-8"
                >
                  ← Back
                </Button>
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 overflow-hidden rounded">
                    {selectedConfig.imagePath ? (
                      <img
                        src={selectedConfig.imagePath}
                        alt={selectedConfig.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      (() => {
                        const Icon = selectedConfig.icon;
                        return <Icon className="h-5 w-5" />;
                      })()
                    )}
                  </div>
                  <span className="font-medium">{selectedConfig.name}</span>
                </div>
              </div>

              {selectedConfig.fields.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No configuration needed for this agent.
                </p>
              ) : (
                selectedConfig.fields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      type={field.type === 'secret' ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      value={formData[field.key] ?? ''}
                      onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    />
                  </div>
                ))
              )}

              {/* Warning for custom webhook agents replacing existing */}
              {selectedType &&
                CUSTOM_WEBHOOK_AGENTS.includes(selectedType) &&
                settings?.webhookFormat &&
                settings.webhookFormat !== selectedConfig.webhookFormat && (
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
                    <p className="text-sm text-amber-600">
                      This will replace your current{' '}
                      <strong>
                        {AGENT_CONFIGS[settings.webhookFormat as NotificationAgentType]?.name ??
                          'webhook'}
                      </strong>{' '}
                      configuration. Only one custom webhook agent can be active at a time.
                    </p>
                  </div>
                )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {selectedType && (
            <Button onClick={handleSave} disabled={!canSave() || updateSettings.isPending}>
              {updateSettings.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Add Agent'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
