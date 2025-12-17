/**
 * Notification dispatch service
 */

import type { ViolationWithDetails, ActiveSession, Settings, WebhookFormat } from '@tracearr/shared';
import { NOTIFICATION_EVENTS, RULE_DISPLAY_NAMES, SEVERITY_LEVELS } from '@tracearr/shared';

export interface NotificationPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface NtfyPayload {
  topic: string;
  title: string;
  message: string;
  priority: number;
  tags: string[];
}

interface ApprisePayload {
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning' | 'failure';
}

/**
 * Map severity to ntfy priority (1-5 scale)
 */
function severityToNtfyPriority(severity: string): number {
  const map: Record<string, number> = { high: 5, warning: 4, low: 3 };
  return map[severity] ?? 3;
}

/**
 * Map severity to Apprise notification type
 */
function severityToAppriseType(severity: string): 'info' | 'success' | 'warning' | 'failure' {
  const map: Record<string, 'info' | 'success' | 'warning' | 'failure'> = {
    high: 'failure',
    warning: 'warning',
    low: 'info',
  };
  return map[severity] ?? 'info';
}

/**
 * Truncate a string to fit Discord's field value limit (1024 chars)
 */
function truncateForDiscord(text: string, maxLength = 1000): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export class NotificationService {
  /**
   * Send violation notification
   */
  async notifyViolation(
    violation: ViolationWithDetails,
    settings: Settings
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    if (settings.discordWebhookUrl) {
      promises.push(this.sendDiscord(settings.discordWebhookUrl, violation));
    }

    if (settings.customWebhookUrl) {
      const payload = this.buildViolationPayload(violation);
      promises.push(
        this.sendFormattedWebhook(settings, payload, { violation })
      );
    }

    await Promise.allSettled(promises);
  }

  /**
   * Send session started notification
   */
  async notifySessionStarted(session: ActiveSession, settings: Settings): Promise<void> {
    const payload: NotificationPayload = {
      event: NOTIFICATION_EVENTS.STREAM_STARTED,
      timestamp: new Date().toISOString(),
      data: {
        user: { id: session.serverUserId, username: session.user.username },
        media: { title: session.mediaTitle, type: session.mediaType },
        location: { city: session.geoCity, country: session.geoCountry },
      },
    };

    if (settings.customWebhookUrl) {
      await this.sendFormattedWebhook(settings, payload, { session, eventType: 'session_started' });
    }
  }

  /**
   * Send session stopped notification
   */
  async notifySessionStopped(session: ActiveSession, settings: Settings): Promise<void> {
    const payload: NotificationPayload = {
      event: NOTIFICATION_EVENTS.STREAM_STOPPED,
      timestamp: new Date().toISOString(),
      data: {
        user: { id: session.serverUserId, username: session.user.username },
        media: { title: session.mediaTitle, type: session.mediaType },
        duration: session.durationMs,
      },
    };

    if (settings.customWebhookUrl) {
      await this.sendFormattedWebhook(settings, payload, { session, eventType: 'session_stopped' });
    }
  }

  /**
   * Send server down notification
   */
  async notifyServerDown(serverName: string, settings: Settings): Promise<void> {
    const payload: NotificationPayload = {
      event: NOTIFICATION_EVENTS.SERVER_DOWN,
      timestamp: new Date().toISOString(),
      data: { serverName },
    };

    if (settings.discordWebhookUrl) {
      await this.sendDiscordMessage(settings.discordWebhookUrl, {
        title: 'Server Connection Lost',
        description: `Lost connection to ${serverName}`,
        color: 0xff0000,
      });
    }

    if (settings.customWebhookUrl) {
      await this.sendFormattedWebhook(settings, payload, { serverName, eventType: 'server_down' });
    }
  }

  /**
   * Send server up notification
   */
  async notifyServerUp(serverName: string, settings: Settings): Promise<void> {
    const payload: NotificationPayload = {
      event: NOTIFICATION_EVENTS.SERVER_UP,
      timestamp: new Date().toISOString(),
      data: { serverName },
    };

    if (settings.discordWebhookUrl) {
      await this.sendDiscordMessage(settings.discordWebhookUrl, {
        title: 'Server Back Online',
        description: `${serverName} is back online`,
        color: 0x2ecc71, // Green
      });
    }

    if (settings.customWebhookUrl) {
      await this.sendFormattedWebhook(settings, payload, { serverName, eventType: 'server_up' });
    }
  }

  private buildViolationPayload(violation: ViolationWithDetails): NotificationPayload {
    return {
      event: NOTIFICATION_EVENTS.VIOLATION_DETECTED,
      timestamp: violation.createdAt.toISOString(),
      data: {
        user: { id: violation.serverUserId, username: violation.user.username },
        rule: { id: violation.ruleId, type: violation.rule.type, name: violation.rule.name },
        violation: { id: violation.id, severity: violation.severity, details: violation.data },
      },
    };
  }

  private async sendDiscord(webhookUrl: string, violation: ViolationWithDetails): Promise<void> {
    const severityColors: Record<keyof typeof SEVERITY_LEVELS, number> = {
      low: 0x3498db,
      warning: 0xf39c12,
      high: 0xe74c3c,
    };

    const ruleType = violation.rule.type as keyof typeof RULE_DISPLAY_NAMES;
    const severity = violation.severity as keyof typeof SEVERITY_LEVELS;

    const detailsJson = JSON.stringify(violation.data, null, 2);

    await this.sendDiscordMessage(webhookUrl, {
      title: `Sharing Violation Detected`,
      color: severityColors[severity] ?? 0x3498db,
      fields: [
        { name: 'User', value: violation.user.username, inline: true },
        { name: 'Rule', value: RULE_DISPLAY_NAMES[ruleType], inline: true },
        { name: 'Severity', value: SEVERITY_LEVELS[severity].label, inline: true },
        { name: 'Details', value: truncateForDiscord(detailsJson) },
      ],
    });
  }

  private async sendDiscordMessage(
    webhookUrl: string,
    embed: { title: string; description?: string; color: number; fields?: unknown[] }
  ): Promise<void> {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Tracearr',
        embeds: [
          {
            ...embed,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status}`);
    }
  }

  /**
   * Send webhook with format-specific payload transformation
   */
  private async sendFormattedWebhook(
    settings: Settings,
    rawPayload: NotificationPayload,
    context: {
      violation?: ViolationWithDetails;
      session?: ActiveSession;
      serverName?: string;
      eventType?: string;
    }
  ): Promise<void> {
    if (!settings.customWebhookUrl) return;

    const format: WebhookFormat = settings.webhookFormat ?? 'json';
    let payload: unknown;

    switch (format) {
      case 'ntfy':
        payload = this.buildNtfyPayload(rawPayload, settings.ntfyTopic, context);
        break;
      case 'apprise':
        payload = this.buildApprisePayload(rawPayload, context);
        break;
      case 'json':
      default:
        payload = rawPayload;
    }

    // Pass ntfy auth token for ntfy format
    const authToken = format === 'ntfy' ? settings.ntfyAuthToken : null;
    await this.sendWebhook(settings.customWebhookUrl, payload, authToken);
  }

  /**
   * Build ntfy-formatted payload
   */
  private buildNtfyPayload(
    rawPayload: NotificationPayload,
    topic: string | null,
    context: {
      violation?: ViolationWithDetails;
      session?: ActiveSession;
      serverName?: string;
      eventType?: string;
    }
  ): NtfyPayload {
    const { violation, session, serverName, eventType } = context;

    // Default topic if not configured
    const ntfyTopic = topic || 'tracearr';

    if (violation) {
      const ruleType = violation.rule.type as keyof typeof RULE_DISPLAY_NAMES;
      const severity = violation.severity as keyof typeof SEVERITY_LEVELS;
      return {
        topic: ntfyTopic,
        title: 'Violation Detected',
        message: `User ${violation.user.username} triggered ${RULE_DISPLAY_NAMES[ruleType]} (${SEVERITY_LEVELS[severity].label} severity)`,
        priority: severityToNtfyPriority(violation.severity),
        tags: ['warning', 'rotating_light'],
      };
    }

    if (session) {
      if (eventType === 'session_started') {
        return {
          topic: ntfyTopic,
          title: 'Stream Started',
          message: `${session.user.username} started watching ${session.mediaTitle}`,
          priority: 3,
          tags: ['arrow_forward'],
        };
      }
      // session_stopped
      return {
        topic: ntfyTopic,
        title: 'Stream Stopped',
        message: `${session.user.username} stopped watching ${session.mediaTitle}`,
        priority: 3,
        tags: ['stop_button'],
      };
    }

    if (serverName) {
      if (eventType === 'server_down') {
        return {
          topic: ntfyTopic,
          title: 'Server Down',
          message: `Lost connection to ${serverName}`,
          priority: 5,
          tags: ['rotating_light', 'x'],
        };
      }
      // server_up
      return {
        topic: ntfyTopic,
        title: 'Server Online',
        message: `${serverName} is back online`,
        priority: 4,
        tags: ['white_check_mark'],
      };
    }

    // Fallback for unknown event types
    return {
      topic: ntfyTopic,
      title: rawPayload.event,
      message: JSON.stringify(rawPayload.data),
      priority: 3,
      tags: ['bell'],
    };
  }

  /**
   * Build Apprise-formatted payload
   */
  private buildApprisePayload(
    rawPayload: NotificationPayload,
    context: {
      violation?: ViolationWithDetails;
      session?: ActiveSession;
      serverName?: string;
      eventType?: string;
    }
  ): ApprisePayload {
    const { violation, session, serverName, eventType } = context;

    if (violation) {
      const ruleType = violation.rule.type as keyof typeof RULE_DISPLAY_NAMES;
      const severity = violation.severity as keyof typeof SEVERITY_LEVELS;
      return {
        title: 'Violation Detected',
        body: `User ${violation.user.username} triggered ${RULE_DISPLAY_NAMES[ruleType]} (${SEVERITY_LEVELS[severity].label} severity)`,
        type: severityToAppriseType(violation.severity),
      };
    }

    if (session) {
      if (eventType === 'session_started') {
        return {
          title: 'Stream Started',
          body: `${session.user.username} started watching ${session.mediaTitle}`,
          type: 'info',
        };
      }
      // session_stopped
      return {
        title: 'Stream Stopped',
        body: `${session.user.username} stopped watching ${session.mediaTitle}`,
        type: 'info',
      };
    }

    if (serverName) {
      if (eventType === 'server_down') {
        return {
          title: 'Server Down',
          body: `Lost connection to ${serverName}`,
          type: 'failure',
        };
      }
      // server_up
      return {
        title: 'Server Online',
        body: `${serverName} is back online`,
        type: 'success',
      };
    }

    // Fallback for unknown event types
    return {
      title: rawPayload.event,
      body: JSON.stringify(rawPayload.data),
      type: 'info',
    };
  }

  private async sendWebhook(webhookUrl: string, payload: unknown, authToken?: string | null): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Add authorization header for ntfy servers with token auth
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }
  }
}

/**
 * Send a test notification to verify webhook configuration
 */
export async function sendTestWebhook(
  webhookUrl: string,
  type: 'discord' | 'custom',
  format: 'json' | 'ntfy' | 'apprise' = 'json',
  ntfyTopic?: string | null,
  ntfyAuthToken?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    if (type === 'discord') {
      // Send Discord test embed
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Tracearr',
          embeds: [
            {
              title: 'Test Notification',
              description: 'If you see this message, your Discord webhook is configured correctly!',
              color: 0x2ecc71, // Green
              fields: [
                { name: 'Status', value: 'Connected', inline: true },
                { name: 'Source', value: 'Tracearr', inline: true },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return { success: false, error: `Discord returned ${response.status}: ${text}` };
      }

      return { success: true };
    }

    // Custom webhook
    let payload: unknown;

    switch (format) {
      case 'ntfy':
        payload = {
          topic: ntfyTopic || 'tracearr',
          title: 'Test Notification',
          message: 'If you see this message, your ntfy webhook is configured correctly!',
          priority: 3,
          tags: ['white_check_mark', 'tracearr'],
        };
        break;

      case 'apprise':
        payload = {
          title: 'Test Notification',
          body: 'If you see this message, your Apprise webhook is configured correctly!',
          type: 'success',
        };
        break;

      case 'json':
      default:
        payload = {
          event: 'test',
          timestamp: new Date().toISOString(),
          message: 'If you see this message, your webhook is configured correctly!',
          data: {
            source: 'tracearr',
            test: true,
          },
        };
    }

    // Build headers with optional auth token for ntfy
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (format === 'ntfy' && ntfyAuthToken) {
      headers['Authorization'] = `Bearer ${ntfyAuthToken}`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Webhook returned ${response.status}: ${text}` };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export const notificationService = new NotificationService();
