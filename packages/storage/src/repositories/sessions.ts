/**
 * Session, task, and request persistence (PRD.md §13.1, §15.1).
 *
 * `saveSession` is the single write path used by the pipeline. It upserts the
 * session, replaces its task snapshot, and reconciles open requests so a
 * resolved request is retained as history rather than deleted.
 */

import type {
  SessionRecord,
  SessionState,
  SessionStateConfidence,
  TaskRecord,
  TaskState,
} from "@agent-attention/core";
import type { AgentAttentionDb } from "../db";
import { validateTimestamp } from "../time";
import type { RequestRepository } from "./requests";

/** Columns that have no equivalent on the core SessionRecord yet. */
export interface PersistedSession extends SessionRecord {
  agentId?: string;
  agentVersion?: string;
  projectId?: string;
}

interface SessionRow {
  session_id: string;
  adapter_id: string;
  agent_id: string | null;
  agent_name: string;
  agent_version: string | null;
  parent_session_id: string | null;
  is_subagent: number | bigint;
  project_id: string | null;
  project_name: string | null;
  working_directory: string | null;
  state: string;
  state_confidence: string;
  last_event_at: string;
  last_seen_at: string;
  last_verified_at: string | null;
  last_accepted_sequence: number | bigint | null;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  task_id: string;
  state: string;
  started_at: string;
  ended_at: string | null;
}

export interface SessionRepository {
  get(adapterId: string, sessionId: string): PersistedSession | undefined;
  upsert(session: SessionRecord): void;
  list(): PersistedSession[];
  purgeTerminalBefore(cutoff: string): number;
}

function stringOrUndefined(value: string | null): string | undefined {
  return value ?? undefined;
}

function mapTask(row: TaskRow): TaskRecord {
  return {
    taskId: row.task_id,
    state: row.state as TaskState,
    startedAt: row.started_at,
    ...(row.ended_at === null ? {} : { endedAt: row.ended_at }),
  };
}

function mapSession(
  row: SessionRow,
  pendingRequests: SessionRecord["pendingRequests"],
  tasks: TaskRecord[],
): PersistedSession {
  return {
    adapterId: row.adapter_id,
    sessionId: row.session_id,
    agentName: row.agent_name,
    state: row.state as SessionState,
    stateConfidence: row.state_confidence as SessionStateConfidence,
    lastEventAt: row.last_event_at,
    lastSeenAt: row.last_seen_at,
    lastVerifiedAt: stringOrUndefined(row.last_verified_at),
    pendingRequests,
    tasks,
    isSubagent: Number(row.is_subagent) !== 0,
    ...(row.parent_session_id === null ? {} : { parentSessionId: row.parent_session_id }),
    ...(row.project_name === null ? {} : { projectName: row.project_name }),
    ...(row.working_directory === null ? {} : { workingDirectory: row.working_directory }),
    ...(row.last_accepted_sequence === null
      ? {}
      : { lastAcceptedSequence: Number(row.last_accepted_sequence) }),
    ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
    ...(row.agent_version === null ? {} : { agentVersion: row.agent_version }),
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

export function createSessionRepository(
  db: AgentAttentionDb,
  requests: RequestRepository,
): SessionRepository {
  const get = db.raw.prepare(
    "SELECT * FROM agent_sessions WHERE adapter_id = ? AND session_id = ?",
  );
  const list = db.raw.prepare(
    "SELECT * FROM agent_sessions ORDER BY julianday(last_seen_at) DESC, adapter_id ASC, session_id ASC",
  );
  const tasks = db.raw.prepare(
    "SELECT task_id, state, started_at, ended_at FROM agent_tasks WHERE adapter_id = ? AND session_id = ? ORDER BY rowid ASC",
  );
  const upsert = db.raw.prepare(`
    INSERT INTO agent_sessions (
      session_id, adapter_id, agent_id, agent_name, agent_version,
      parent_session_id, is_subagent, project_id, project_name, working_directory,
      state, state_confidence, last_event_at, last_seen_at, last_verified_at,
      last_accepted_sequence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (adapter_id, session_id) DO UPDATE SET
      session_id = excluded.session_id,
      agent_id = excluded.agent_id,
      agent_name = excluded.agent_name,
      agent_version = excluded.agent_version,
      parent_session_id = excluded.parent_session_id,
      is_subagent = excluded.is_subagent,
      project_id = excluded.project_id,
      project_name = excluded.project_name,
      working_directory = excluded.working_directory,
      state = excluded.state,
      state_confidence = excluded.state_confidence,
      last_event_at = excluded.last_event_at,
      last_seen_at = excluded.last_seen_at,
      last_verified_at = excluded.last_verified_at,
      last_accepted_sequence = excluded.last_accepted_sequence,
      created_at = agent_sessions.created_at,
      updated_at = excluded.updated_at
  `);
  const deleteTasks = db.raw.prepare(
    "DELETE FROM agent_tasks WHERE adapter_id = ? AND session_id = ?",
  );
  const insertTask = db.raw.prepare(`
    INSERT INTO agent_tasks (adapter_id, session_id, task_id, state, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const upsertRequest = db.raw.prepare(`
    INSERT INTO pending_requests (
      adapter_id, session_id, request_id, kind, opened_at, resolved_at, resolution, reminders_sent
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    ON CONFLICT (adapter_id, session_id, request_id) DO UPDATE SET
      kind = excluded.kind,
      opened_at = excluded.opened_at,
      reminders_sent = excluded.reminders_sent,
      resolved_at = NULL,
      resolution = NULL
  `);
  const purge = db.raw.prepare(`
    DELETE FROM agent_sessions
     WHERE state IN ('ended', 'completed', 'failed', 'unknown')
       AND julianday(last_seen_at) < julianday(?)
  `);

  function readTasks(adapterId: string, sessionId: string): TaskRecord[] {
    const rows = tasks.all(adapterId, sessionId) as unknown as TaskRow[];
    return rows.map(mapTask);
  }

  return {
    get(adapterId, sessionId) {
      const row = get.get(adapterId, sessionId) as SessionRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      return mapSession(
        row,
        requests.listOpenForSession(adapterId, sessionId),
        readTasks(adapterId, sessionId),
      );
    },

    upsert(session) {
      const now = new Date().toISOString();
      const extended = session as PersistedSession;

      db.transaction(() => {
        upsert.run(
          session.sessionId,
          session.adapterId,
          extended.agentId ?? null,
          session.agentName,
          extended.agentVersion ?? null,
          session.parentSessionId ?? null,
          session.isSubagent ? 1 : 0,
          extended.projectId ?? null,
          session.projectName ?? null,
          session.workingDirectory ?? null,
          session.state,
          session.stateConfidence,
          validateTimestamp(session.lastEventAt, "session.lastEventAt"),
          validateTimestamp(session.lastSeenAt, "session.lastSeenAt"),
          session.lastVerifiedAt === undefined
            ? null
            : validateTimestamp(session.lastVerifiedAt, "session.lastVerifiedAt"),
          session.lastAcceptedSequence ?? null,
          now,
          now,
        );

        deleteTasks.run(session.adapterId, session.sessionId);
        for (const task of session.tasks) {
          insertTask.run(
            session.adapterId,
            session.sessionId,
            task.taskId,
            task.state,
            validateTimestamp(task.startedAt, "task.startedAt"),
            task.endedAt === undefined ? null : validateTimestamp(task.endedAt, "task.endedAt"),
          );
        }

        const openIds = new Set<string>();
        for (const request of session.pendingRequests) {
          openIds.add(request.requestId);
          upsertRequest.run(
            session.adapterId,
            session.sessionId,
            request.requestId,
            request.kind,
            validateTimestamp(request.openedAt, "request.openedAt"),
            request.remindersSent,
          );
        }

        // Requests missing from the new snapshot were closed by a transition;
        // retain the row with an explicit unknown resolution for history.
        if (openIds.size === 0) {
          db.raw
            .prepare(
              "UPDATE pending_requests SET resolved_at = ?, resolution = 'unknown' WHERE adapter_id = ? AND session_id = ? AND resolved_at IS NULL",
            )
            .run(now, session.adapterId, session.sessionId);
        } else {
          const placeholders = [...openIds].map(() => "?").join(", ");
          db.raw
            .prepare(
              `UPDATE pending_requests SET resolved_at = ?, resolution = 'unknown' WHERE adapter_id = ? AND session_id = ? AND resolved_at IS NULL AND request_id NOT IN (${placeholders})`,
            )
            .run(now, session.adapterId, session.sessionId, ...openIds);
        }
      });
    },

    list() {
      const rows = list.all() as unknown as SessionRow[];
      return rows.map((row) =>
        mapSession(
          row,
          requests.listOpenForSession(row.adapter_id, row.session_id),
          readTasks(row.adapter_id, row.session_id),
        ),
      );
    },

    purgeTerminalBefore(cutoff) {
      return Number(purge.run(validateTimestamp(cutoff, "cutoff")).changes);
    },
  };
}
