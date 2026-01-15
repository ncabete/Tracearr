/**
 * Inactive User Rule Evaluation Job
 *
 * Periodically checks for users who have not started a stream in N days
 * and creates violations for any matching inactive rules.
 */

import { and, eq, lt, isNotNull, sql } from 'drizzle-orm';
import type { Rule, RuleParams, InactiveUserParams } from '@tracearr/shared';
import { TIME_MS } from '@tracearr/shared';
import { db } from '../db/client.js';
import { rules, serverUsers, sessions } from '../db/schema.js';
import type { RuleEvaluationResult } from '../services/rules.js';
import type { PubSubService } from '../services/cache.js';
import { createViolation } from './poller/violations.js';

export interface InactiveUserRuleJobConfig {
  enabled: boolean;
  intervalMs: number;
}

const defaultConfig: InactiveUserRuleJobConfig = {
  enabled: true,
  intervalMs: 6 * TIME_MS.HOUR,
};

let inactiveUserRuleInterval: NodeJS.Timeout | null = null;
let pubSubService: PubSubService | null = null;

export function initializeInactiveUserRuleJob(pubSub: PubSubService): void {
  pubSubService = pubSub;
}

async function evaluateInactiveRules(): Promise<void> {
  try {
    const ruleRows = await db
      .select()
      .from(rules)
      .where(and(eq(rules.isActive, true), eq(rules.type, 'inactive_user')));

    if (ruleRows.length === 0) {
      return;
    }

    const now = Date.now();

    for (const ruleRow of ruleRows) {
      const rule: Rule = {
        id: ruleRow.id,
        name: ruleRow.name,
        type: ruleRow.type,
        params: ruleRow.params as unknown as RuleParams,
        serverUserId: ruleRow.serverUserId,
        isActive: ruleRow.isActive,
        createdAt: ruleRow.createdAt,
        updatedAt: ruleRow.updatedAt,
      };

      const params = rule.params as InactiveUserParams;
      const inactiveDays = Math.floor(params.inactiveDays ?? 0);
      const stickyAcknowledgement = params.stickyAcknowledgement ?? false;
      if (!Number.isFinite(inactiveDays) || inactiveDays <= 0) {
        continue;
      }

      const thresholdDate = new Date(now - inactiveDays * TIME_MS.DAY);
      const conditions = [
        isNotNull(serverUsers.lastActivityAt),
        lt(serverUsers.lastActivityAt, thresholdDate),
      ];

      if (rule.serverUserId) {
        conditions.push(eq(serverUsers.id, rule.serverUserId));
      }

      const inactiveUsers = await db
        .select({
          id: serverUsers.id,
          lastActivityAt: serverUsers.lastActivityAt,
        })
        .from(serverUsers)
        .where(and(...conditions));

      if (inactiveUsers.length === 0) {
        continue;
      }

      const serverUserIdList = inactiveUsers.map((user) => sql`${user.id}`);
      const lastActivityByUserId = new Map<string, string>();
      for (const user of inactiveUsers) {
        if (user.lastActivityAt) {
          lastActivityByUserId.set(user.id, new Date(user.lastActivityAt).toISOString());
        }
      }

      const acknowledgedActivityByUserId = new Map<string, string>();
      if (stickyAcknowledgement) {
        const acknowledgedResult = await db.execute(sql`
          SELECT DISTINCT ON (v.server_user_id)
            v.server_user_id as "serverUserId",
            v.data->>'lastActivityAt' as "lastActivityAt"
          FROM violations v
          WHERE v.rule_id = ${rule.id}
            AND v.rule_type = 'inactive_user'
            AND v.acknowledged_at IS NOT NULL
            AND v.server_user_id IN (${sql.join(serverUserIdList, sql`, `)})
          ORDER BY v.server_user_id, v.created_at DESC
        `);

        for (const row of acknowledgedResult.rows as Array<{
          serverUserId: string;
          lastActivityAt: string | null;
        }>) {
          if (row.lastActivityAt) {
            acknowledgedActivityByUserId.set(row.serverUserId, row.lastActivityAt);
          }
        }
      }

      const latestSessionsResult = await db.execute(sql`
        SELECT DISTINCT ON (s.server_user_id)
          s.id as "sessionId",
          s.server_user_id as "serverUserId"
        FROM sessions s
        WHERE s.server_user_id IN (${sql.join(serverUserIdList, sql`, `)})
        ORDER BY s.server_user_id, s.started_at DESC
      `);

      const sessionByUserId = new Map<string, string>();
      for (const row of latestSessionsResult.rows as Array<{
        sessionId: string;
        serverUserId: string;
      }>) {
        sessionByUserId.set(row.serverUserId, row.sessionId);
      }

      for (const user of inactiveUsers) {
        if (!user.lastActivityAt) {
          continue;
        }

        const lastActivityIso = lastActivityByUserId.get(user.id);
        if (
          stickyAcknowledgement &&
          lastActivityIso &&
          acknowledgedActivityByUserId.get(user.id) === lastActivityIso
        ) {
          continue;
        }

        const sessionId = sessionByUserId.get(user.id);
        if (!sessionId) {
          continue;
        }

        const daysInactive = Math.floor(
          (now - new Date(user.lastActivityAt).getTime()) / TIME_MS.DAY
        );

        const result: RuleEvaluationResult = {
          violated: true,
          severity: 'warning',
          data: {
            inactiveDays,
            daysInactive,
            lastActivityAt: new Date(user.lastActivityAt).toISOString(),
          },
        };

        await createViolation(rule.id, user.id, sessionId, result, rule, pubSubService);
      }
    }
  } catch (error) {
    console.error('[InactiveUserRule] Error evaluating inactive users:', error);
  }
}

export function startInactiveUserRuleJob(config: Partial<InactiveUserRuleJobConfig> = {}): void {
  const mergedConfig = { ...defaultConfig, ...config };

  if (!mergedConfig.enabled) {
    console.log('Inactive user rule job disabled');
    return;
  }

  if (inactiveUserRuleInterval) {
    console.log('Inactive user rule job already running');
    return;
  }

  console.log(`Starting inactive user rule job with ${mergedConfig.intervalMs}ms interval`);

  void evaluateInactiveRules();
  inactiveUserRuleInterval = setInterval(
    () => void evaluateInactiveRules(),
    mergedConfig.intervalMs
  );
}

export function stopInactiveUserRuleJob(): void {
  if (inactiveUserRuleInterval) {
    clearInterval(inactiveUserRuleInterval);
    inactiveUserRuleInterval = null;
    console.log('Inactive user rule job stopped');
  }
}

export async function triggerInactiveUserRuleJob(): Promise<void> {
  await evaluateInactiveRules();
}
