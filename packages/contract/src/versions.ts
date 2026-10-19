/**
 * Schema and protocol version constants.
 *
 * Source of truth: PRD.md §12.2 (`schemaVersion: 1` for events) and
 * PRD.md §8.3 (`schemaVersion: 2` for config).
 */

/** Version of the AgentEvent contract (PRD §12). */
export const EVENT_SCHEMA_VERSION = 1 as const;

/** Version of the user configuration file schema (PRD §8.3). */
export const CONFIG_SCHEMA_VERSION = 2 as const;
