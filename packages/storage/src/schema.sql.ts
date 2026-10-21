/**
 * SQLite schema (PRD.md §15.1).
 *
 * Migrations are forward-only and applied in ascending `version` order inside a
 * single transaction (PRD §15). Never edit an applied migration; add a new one.
 *
 * There is deliberately no preferences table (D-05): preferences live only in
 * `config.json`.
 */

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

/** Identity tag used to keep DDL readable and visibly grouped per migration. */
function sql(strings: TemplateStringsArray, ...values: Array<string | number>): string {
  return strings.reduce(
    (result, part, index) => result + part + (index < values.length ? String(values[index]) : ""),
    "",
  );
}

export const SCHEMA_VERSION = 1;

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    description: "initial schema",
    sql: sql`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE agent_sessions (
        session_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        agent_id TEXT,
        agent_name TEXT NOT NULL,
        agent_version TEXT,
        parent_session_id TEXT,
        is_subagent INTEGER NOT NULL DEFAULT 0,
        project_id TEXT,
        project_name TEXT,
        working_directory TEXT,
        state TEXT NOT NULL,
        state_confidence TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_verified_at TEXT,
        last_accepted_sequence INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (adapter_id, session_id)
      );

      CREATE TABLE agent_tasks (
        adapter_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        PRIMARY KEY (adapter_id, session_id, task_id),
        FOREIGN KEY (adapter_id, session_id)
          REFERENCES agent_sessions (adapter_id, session_id)
          ON DELETE CASCADE
      );

      CREATE TABLE agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        adapter_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        task_id TEXT,
        event_type TEXT NOT NULL,
        summary_code TEXT,
        request_id TEXT,
        sequence INTEGER,
        ingest_seq INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        confidence TEXT NOT NULL,
        late INTEGER NOT NULL DEFAULT 0,
        fingerprint TEXT NOT NULL,
        processed_at TEXT,
        details_json TEXT
      );

      CREATE TABLE event_deliveries (
        event_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        error_code TEXT,
        attempted_at TEXT NOT NULL,
        PRIMARY KEY (event_id, channel)
      );

      CREATE TABLE pending_requests (
        adapter_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        resolved_at TEXT,
        resolution TEXT,
        reminders_sent INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (adapter_id, session_id, request_id),
        FOREIGN KEY (adapter_id, session_id)
          REFERENCES agent_sessions (adapter_id, session_id)
          ON DELETE CASCADE
      );

      CREATE TABLE dedupe_records (
        fingerprint TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        duplicate_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX idx_agent_events_received_at
        ON agent_events (received_at);
      CREATE INDEX idx_agent_events_session_time
        ON agent_events (adapter_id, session_id, occurred_at);
      CREATE INDEX idx_dedupe_records_expires_at
        ON dedupe_records (expires_at);
      CREATE INDEX idx_pending_requests_resolved_at
        ON pending_requests (resolved_at);
      CREATE INDEX idx_agent_sessions_last_seen_at
        ON agent_sessions (last_seen_at);
      CREATE INDEX idx_event_deliveries_event_id
        ON event_deliveries (event_id);
    `,
  },
]);

export const DEFAULT_MIGRATIONS = MIGRATIONS;
