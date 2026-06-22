import Database from 'better-sqlite3';
import type { DAGEvent, DAGEventType } from './types';

/**
 * A persisted event with its monotonic store sequence id.  The `seq` is the
 * SQLite autoincrement row id and defines the canonical chronological order
 * used for replay and for streaming "events newer than X".
 */
export interface StoredEvent extends DAGEvent {
  seq: number;
}

/**
 * Durable, ordered log of {@link DAGEvent}s keyed by taskId.  Used to replay a
 * task's history to a (re)connecting WebSocket client before streaming live
 * events.  Append order is preserved by an autoincrement primary key, so
 * replay is always chronological.
 */
export interface EventStore {
  /** Append an event and return it with its assigned sequence id. */
  append(event: DAGEvent): StoredEvent;
  /** All events for a task in chronological order. */
  listByTask(taskId: string): StoredEvent[];
  /** Events for a task with seq strictly greater than `afterSeq`, ordered. */
  listByTaskSince(taskId: string, afterSeq: number): StoredEvent[];
  /** Release underlying resources. */
  close(): void;
}

/**
 * Create a SQLite-backed {@link EventStore}.
 *
 * @param db  An existing better-sqlite3 database, or a file path.  Defaults to
 *            an in-memory database scoped to the process — sufficient for a
 *            single long-running server and for tests, while still exercising
 *            the real "replay from DB" code path.
 */
export function createEventStore(db?: Database.Database | string): EventStore {
  const database =
    typeof db === 'string' ? new Database(db) : db ?? new Database(':memory:');

  database.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId      TEXT NOT NULL,
      type        TEXT NOT NULL,
      nodeId      TEXT,
      timestamp   TEXT NOT NULL,
      payloadJson TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events (taskId, seq);
  `);

  const insertStmt = database.prepare(`
    INSERT INTO task_events (taskId, type, nodeId, timestamp, payloadJson)
    VALUES (@taskId, @type, @nodeId, @timestamp, @payloadJson)
  `);
  const listStmt = database.prepare(
    'SELECT * FROM task_events WHERE taskId = ? ORDER BY seq ASC'
  );
  const listSinceStmt = database.prepare(
    'SELECT * FROM task_events WHERE taskId = ? AND seq > ? ORDER BY seq ASC'
  );

  function rowToEvent(row: Record<string, unknown>): StoredEvent {
    const payloadJson = row.payloadJson as string | null;
    return {
      seq: row.seq as number,
      type: row.type as DAGEventType,
      taskId: row.taskId as string,
      nodeId: (row.nodeId as string | null) ?? undefined,
      timestamp: row.timestamp as string,
      payload: payloadJson != null ? JSON.parse(payloadJson) : undefined,
    };
  }

  return {
    append(event: DAGEvent): StoredEvent {
      const info = insertStmt.run({
        taskId: event.taskId,
        type: event.type,
        nodeId: event.nodeId ?? null,
        timestamp: event.timestamp,
        payloadJson: event.payload !== undefined ? JSON.stringify(event.payload) : null,
      });
      return { ...event, seq: Number(info.lastInsertRowid) };
    },

    listByTask(taskId: string): StoredEvent[] {
      return (listStmt.all(taskId) as Array<Record<string, unknown>>).map(rowToEvent);
    },

    listByTaskSince(taskId: string, afterSeq: number): StoredEvent[] {
      return (listSinceStmt.all(taskId, afterSeq) as Array<Record<string, unknown>>).map(
        rowToEvent
      );
    },

    close(): void {
      database.close();
    },
  };
}
