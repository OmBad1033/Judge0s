import type { Env } from '../env';
import { newId, now } from '../utils/common';


// testing comment
export interface AuditEntry {
  actorId: string | null;
  actorKind: 'user' | 'admin_cookie' | 'anonymous';
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export async function logAdminAction(env: Env, entry: AuditEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, actor_id, actor_kind, action, target, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      entry.actorId,
      entry.actorKind,
      entry.action,
      entry.target ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      now(),
    )
    .run();
}