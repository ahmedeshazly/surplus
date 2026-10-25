// Owner: R1. Task C-5: per-merchant Server-Sent Events hub.
//
// Deliberately transport-agnostic: subscribers are plain objects, so the hub is
// unit-testable without an HTTP server. The Express route adapts a Response into
// a subscriber.
import type { AppEvent, MerchantId } from "@surplus/contracts";
import { AppEventSchema } from "@surplus/contracts";

export interface SseSubscriber {
  merchantId: MerchantId;
  send(chunk: string): void;
  end(): void;
}

/** SSE frame: event id + JSON payload, terminated by a blank line. */
export function formatSse(event: AppEvent): string {
  return `id: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`;
}

const CONNECTED_COMMENT = ": connected\n\n";
const HEARTBEAT_COMMENT = ": heartbeat\n\n";

export class SseHub {
  readonly #subscribers = new Set<SseSubscriber>();
  #heartbeat: ReturnType<typeof setInterval> | undefined;

  /** Registers a subscriber and sends the initial comment. Returns an unsubscribe fn. */
  subscribe(subscriber: SseSubscriber): () => void {
    this.#subscribers.add(subscriber);
    subscriber.send(CONNECTED_COMMENT);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  /** Sends an event to every subscriber of its merchant. Returns delivery count. */
  broadcast(event: AppEvent): number {
    const validated = AppEventSchema.parse(event);
    const frame = formatSse(validated);
    let delivered = 0;
    for (const subscriber of this.#subscribers) {
      if (subscriber.merchantId !== validated.merchantId) continue;
      subscriber.send(frame);
      delivered += 1;
    }
    return delivered;
  }

  /** Emits a comment line so proxies keep the connection open. */
  heartbeat(): void {
    for (const subscriber of this.#subscribers) {
      subscriber.send(HEARTBEAT_COMMENT);
    }
  }

  startHeartbeat(intervalMs = 15_000): () => void {
    this.stopHeartbeat();
    const timer = setInterval(() => this.heartbeat(), intervalMs);
    timer.unref();
    this.#heartbeat = timer;
    return () => this.stopHeartbeat();
  }

  stopHeartbeat(): void {
    if (this.#heartbeat !== undefined) {
      clearInterval(this.#heartbeat);
      this.#heartbeat = undefined;
    }
  }

  /** Ends every subscriber and clears the set (used on shutdown). */
  close(): void {
    this.stopHeartbeat();
    for (const subscriber of this.#subscribers) {
      subscriber.end();
    }
    this.#subscribers.clear();
  }

  count(merchantId?: MerchantId): number {
    if (merchantId === undefined) return this.#subscribers.size;
    let total = 0;
    for (const subscriber of this.#subscribers) {
      if (subscriber.merchantId === merchantId) total += 1;
    }
    return total;
  }
}
