import { useState, useEffect } from 'react';
import type { Settings } from '@tracearr/shared';
import { Loader2 } from 'lucide-react';
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
import type { NotificationAgentType } from './types';
import { AGENT_CONFIGS } from './agent-config';

interface EditAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentType: NotificationAgentType;
  settings: Settings | undefined;
}

export function EditAgentDialog({ open, onOpenChange, agentType, settings }: EditAgentDialogProps) {
  const updateSettings = useUpdateSettings({ silent: true });
  const [formData, setFormData] = useState<Record<string, string>>({});

  const config = AGENT_CONFIGS[agentType];

  // Initialize form with current settings values when dialog opens
  useEffect(() => {
    if (open && settings && config) {
      const initialData: Record<string, string> = {};

      config.fields.forEach((field) => {
        const value = settings[field.key as keyof Settings];
        if (value != null) {
          initialData[field.key] = String(value);
        }
      });

      setFormData(initialData);
    }
  }, [open, settings, config]);

  const handleFieldChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const canSave = () => {
    // Check all required fields are filled
    return config.fields.filter((f) => f.required).every((f) => formData[f.key]?.trim());
  };

  const handleSave = async () => {
    // Build settings update
    const update: Record<string, string | null> = {};

    // Set the fields
    config.fields.forEach((field) => {
      const value = formData[field.key]?.trim();
      update[field.key] = value || null;
    });

    try {
      await updateSettings.mutateAsync(update);
      toast.success(`${config.name} Updated`, {
        description: 'Notification agent settings have been saved.',
      });
      onOpenChange(false);
    } catch {
      toast.error('Failed to Update Agent');
    }
  };

  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-6 w-6 overflow-hidden rounded">
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
            Edit {config.name}
          </DialogTitle>
          <DialogDescription>
            Update the configuration for this notification agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {config.fields.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No configuration available for this agent.
            </p>
          ) : (
            config.fields.map((field) => (
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave() || updateSettings.isPending}>
            {updateSettings.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
