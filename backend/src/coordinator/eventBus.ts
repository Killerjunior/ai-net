import { EventEmitter } from 'events';
import type { DAGEvent } from './types';

/**
 * In-process pub/sub bus.  Coordinator emits events; WebSocket handlers
 * subscribe per taskId, and a persistence recorder subscribes to *all* events
 * via {@link EventBus.subscribeAll} so they can be replayed on reconnect.
 */
class EventBus extends EventEmitter {
  /** Internal channel that receives every event regardless of taskId. */
  private static readonly ALL = '__all__';

  emit(taskId: string, event: DAGEvent): boolean {
    // Notify the persistence recorder FIRST so the event is durably stored
    // before any per-task subscriber reacts to it.  Live WebSocket handlers
    // drain newly-persisted rows, so the row must exist by the time they run.
    super.emit(EventBus.ALL, event);
    return super.emit(taskId, event);
  }

  subscribe(taskId: string, handler: (e: DAGEvent) => void): () => void {
    this.on(taskId, handler);
    return () => this.off(taskId, handler);
  }

  /** Subscribe to every event on the bus (used by the persistence recorder). */
  subscribeAll(handler: (e: DAGEvent) => void): () => void {
    this.on(EventBus.ALL, handler);
    return () => this.off(EventBus.ALL, handler);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(100);
