/**
 * Coordinator-specific types.
 *
 * TaskStatus, NodeStatus, DAGEventType, and DAGEvent are re-exported from the
 * canonical source at ../types/task. Do NOT redefine them here.
 */
import type {
  TaskStatus,
  NodeStatus,
  DAGEventType,
  DAGEvent,
} from "../types/task";

export type { TaskStatus, NodeStatus, DAGEventType, DAGEvent };

/** A single node in the execution DAG (coordinator runtime representation). */
export interface DAGNode {
  nodeId: string;
  /** Agent type / capability required */
  agentType: string;
  /** Prompt fragment for this node */
  prompt: string;
  /** nodeIds this node depends on */
  dependsOn: string[];
  status: NodeStatus;
  result?: unknown;
  error?: string;
}

/** Persisted task record (coordinator runtime representation). */
export interface Task {
  taskId: string;
  prompt: string;
  walletPublicKey: string;
  status: TaskStatus;
  dag: DAGNode[];
  createdAt: string;
  updatedAt: string;
  /** Correlation ID for distributed tracing across HTTP request → coordinator → agent */
  requestId?: string;
}
