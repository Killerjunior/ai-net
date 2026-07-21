import {
  VeniceClient as SharedVeniceClient,
  type VeniceChatOptions,
  type VeniceClientConfig,
  type VeniceMessage,
} from '../../services/venice/index.js';

/** Thrown when the Venice AI endpoint cannot be reached or returns a non-2xx. */
export class VeniceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VeniceUnavailableError';
  }
}

/**
 * Research-agent adapter for Venice chat completions.
 *
 * The HTTP, auth, retry, circuit-breaker, and response parsing behavior lives
 * in the shared Venice service client.
 */
export class VeniceClient {
  private readonly client: Pick<SharedVeniceClient, 'chat'>;

  constructor(config: VeniceClientConfig) {
    this.client = new SharedVeniceClient(config);
  }

  async chat(messages: VeniceMessage[], opts: VeniceChatOptions = {}): Promise<string> {
    try {
      return await this.client.chat(messages, opts);
    } catch (err) {
      if (err instanceof VeniceUnavailableError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Venice AI is unreachable';
      throw new VeniceUnavailableError(message);
    }
  }
}

export type { VeniceChatOptions, VeniceClientConfig, VeniceMessage };
