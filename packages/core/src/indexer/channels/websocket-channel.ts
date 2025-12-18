import { EventEmitter } from "node:events";
import NodeWebSocket from "ws";

type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type JsonRpcNotification<T = unknown> = {
  method: string;
  params: {
    subscription: number;
    result: T;
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type SubscriptionRequest = {
  method: string;
  params: unknown[];
  unsubscribeMethod: string;
};

type SubscriptionEntry<T = unknown> = {
  request: SubscriptionRequest;
  subscription: WebSocketSubscription<T>;
};

export type ReconnectOptions = {
  retries?: number;
  delay?: number;
  factor?: number;
  maxDelay?: number;
};

export type WebSocketChannelOptions = {
  nodeUrl: string;
  websocket?: typeof WebSocket;
  maxBufferSize?: number;
  autoReconnect?: boolean;
  reconnectOptions?: ReconnectOptions;
  requestTimeout?: number;
};

export type BlockSubscribeConfig = {
  filter?: "all" | { mentionsAccountOrProgram: string };
  commitment?: "confirmed" | "finalized";
  encoding?: "json" | "jsonParsed" | "base58" | "base64";
  transactionDetails?: "full" | "accounts" | "signatures" | "none";
  maxSupportedTransactionVersion?: number;
  showRewards?: boolean;
};

export type BlockNotificationPayload = {
  context: { slot: number };
  value: {
    slot: number;
    block?: {
      blockhash: string;
      previousBlockhash: string;
      parentSlot: number;
      blockTime?: number;
      blockHeight?: number;
      transactions?: unknown[];
    } | null;
    err: unknown;
  };
};

export class WebSocketSubscription<T> extends EventEmitter {
  #id: number;
  #teardown: () => Promise<void>;

  constructor(teardown: () => Promise<void>, id: number) {
    super();
    this.#id = id;
    this.#teardown = teardown;
    this.setMaxListeners(50);
  }

  get id(): number {
    return this.#id;
  }

  /** @internal */
  _updateId(nextId: number): void {
    this.#id = nextId;
  }

  /** @internal */
  _emitData(payload: T): void {
    this.emit("data", payload);
  }

  /** @internal */
  _emitError(error: Error): void {
    this.emit("error", error);
  }

  /** @internal */
  _emitClosed(): void {
    this.emit("close");
  }

  async unsubscribe(): Promise<void> {
    await this.#teardown();
  }
}

export class WebSocketChannel extends EventEmitter {
  private readonly options: Required<Omit<WebSocketChannelOptions, "websocket" | "reconnectOptions">> & {
    websocket: typeof WebSocket | undefined;
    reconnectOptions: Required<ReconnectOptions>;
  };

  private ws: WebSocket | null = null;
  private isUserDisconnect = false;
  private reconnectAttempts = 0;
  private requestId = 0;
  private requestQueue: string[] = [];
  private pendingRequests = new Map<number, PendingRequest>();
  private connectionWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private disconnectionWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
  private unsubscriptionWaiters = new Map<number, Array<() => void>>();
  private subscriptions = new Map<number, SubscriptionEntry>();

  constructor(options: WebSocketChannelOptions) {
    super();
    const resolvedWebSocket =
      options.websocket ??
      (typeof globalThis.WebSocket !== "undefined"
        ? globalThis.WebSocket
        : (NodeWebSocket as unknown as typeof WebSocket));
    this.options = {
      nodeUrl: options.nodeUrl,
      autoReconnect: options.autoReconnect ?? true,
      maxBufferSize: options.maxBufferSize ?? 1000,
      requestTimeout: options.requestTimeout ?? 60_000,
      websocket: resolvedWebSocket,
      reconnectOptions: {
        retries: options.reconnectOptions?.retries ?? 5,
        delay: options.reconnectOptions?.delay ?? 2000,
        factor: options.reconnectOptions?.factor ?? 1.5,
        maxDelay: options.reconnectOptions?.maxDelay ?? 30_000,
      },
    };

    if (!this.options.websocket) {
      throw new Error("No WebSocket implementation available");
    }

    this.connect();
  }

  isConnected(): boolean {
    return this.ws?.readyState === this.options.websocket!.OPEN;
  }

  async waitForConnection(): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    return new Promise((resolve, reject) => {
      this.connectionWaiters.push({ resolve, reject });
    });
  }

  async waitForDisconnection(): Promise<void> {
    if (!this.ws || this.ws.readyState === this.options.websocket!.CLOSED) {
      return;
    }
    return new Promise((resolve, reject) => {
      this.disconnectionWaiters.push({ resolve, reject });
    });
  }

  disconnect(code?: number, reason?: string): void {
    this.isUserDisconnect = true;
    this.ws?.close(code, reason);
  }

  reconnect(): void {
    this.isUserDisconnect = false;
    if (this.ws && this.ws.readyState === this.options.websocket!.OPEN) {
      this.ws.close();
      return;
    }
    this.connect();
  }

  send(method: string, params: unknown[] = [], id?: number): number {
    const requestId = id ?? ++this.requestId;
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    });

    if (this.isConnected() && this.ws) {
      this.ws.send(payload);
    } else {
      if (this.requestQueue.length >= this.options.maxBufferSize) {
        this.requestQueue.shift();
      }
      this.requestQueue.push(payload);
    }

    return requestId;
  }

  async sendReceive<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    await this.waitForConnection();
    const requestId = this.send(method, params);

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`WebSocket request ${method} timed out`));
      }, this.options.requestTimeout);

      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject: (error) => reject(error),
        timeout,
      });
    });
  }

  async subscribeNewHeads(
    config: BlockSubscribeConfig = {},
  ): Promise<WebSocketSubscription<BlockNotificationPayload>> {
    const params: [BlockSubscribeConfig["filter"] | "all", {
      commitment: "confirmed" | "finalized";
      encoding: "json" | "jsonParsed" | "base58" | "base64";
      transactionDetails: "full" | "accounts" | "signatures" | "none";
      maxSupportedTransactionVersion: number;
      showRewards: boolean;
    }] = [
      config.filter ?? "all",
      {
        commitment: config.commitment ?? "confirmed",
        encoding: config.encoding ?? "json",
        transactionDetails: config.transactionDetails ?? "full",
        maxSupportedTransactionVersion: config.maxSupportedTransactionVersion ?? 0,
        showRewards: config.showRewards ?? false,
      },
    ];

    const subscriptionId = await this.sendReceive<number>("blockSubscribe", params as unknown[]);
    return this.registerSubscription<BlockNotificationPayload>(
      subscriptionId,
      {
        method: "blockSubscribe",
        params: params as unknown[],
        unsubscribeMethod: "blockUnsubscribe",
      },
    );
  }

  async unsubscribe(subscriptionId: number): Promise<boolean> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    try {
      const success = await this.sendReceive<boolean>(subscription.request.unsubscribeMethod, [subscriptionId]);
      if (success) {
        this.removeSubscription(subscriptionId);
      }
      return success;
    } catch (error) {
      subscription.subscription._emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async waitForUnsubscription(targetId: number): Promise<void> {
    if (!this.subscriptions.has(targetId)) {
      return;
    }
    return new Promise((resolve) => {
      const existing = this.unsubscriptionWaiters.get(targetId) ?? [];
      existing.push(resolve);
      this.unsubscriptionWaiters.set(targetId, existing);
    });
  }

  // ----------------------
  // Internal plumbing
  // ----------------------

  private connect(): void {
    const WebSocketImpl = this.options.websocket!;
    this.ws = new WebSocketImpl(this.options.nodeUrl);
    this.isUserDisconnect = false;

    const handleOpen = () => {
      this.reconnectAttempts = 0;
      this.emit("open");
      this.flushQueue();
      this.resolveAll(this.connectionWaiters);
      this.resubscribeAll().catch((error) => {
        this.emit("error", error);
      });
    };

    const handleMessage = (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : event.data?.toString?.() ?? "";
      this.handleMessage(data);
    };

    const handleError = (event: Event) => {
      const error = (event as ErrorEvent).error ?? new Error("WebSocket error");
      this.emit("error", error);
    };

    const handleClose = () => {
      this.emit("close");
      this.rejectAllPending(new Error("WebSocket closed"));
      this.resolveAll(this.disconnectionWaiters);
      this.resolveAll(
        this.connectionWaiters,
        new Error("WebSocket closed before connection established"),
      );
      if (!this.isUserDisconnect && this.options.autoReconnect) {
        this.scheduleReconnect();
      }
    };

    if ("addEventListener" in this.ws) {
      this.ws.addEventListener("open", handleOpen);
      this.ws.addEventListener("message", handleMessage);
      this.ws.addEventListener("error", handleError);
      this.ws.addEventListener("close", handleClose);
    } else {
      (this.ws as any).onopen = handleOpen;
      (this.ws as any).onmessage = handleMessage;
      (this.ws as any).onerror = handleError;
      (this.ws as any).onclose = handleClose;
    }
  }

  private flushQueue(): void {
    if (!this.ws || !this.isConnected()) {
      return;
    }
    while (this.requestQueue.length > 0) {
      const payload = this.requestQueue.shift();
      if (payload) {
        this.ws.send(payload);
      }
    }
  }

  private handleMessage(payload: string): void {
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse | JsonRpcNotification;
      if ("id" in parsed) {
        this.handleResponse(parsed);
      } else if ("method" in parsed && parsed.params) {
        this.handleNotification(parsed as JsonRpcNotification);
      }
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const entry = this.subscriptions.get(notification.params.subscription);
    if (!entry) {
      return;
    }
    entry.subscription._emitData(notification.params.result);
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private resolveAll(waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>, error?: Error): void {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (!waiter) continue;
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.reconnectOptions.retries) {
      this.emit("error", new Error("Max WebSocket reconnect attempts reached"));
      return;
    }
    const delay = Math.min(
      this.options.reconnectOptions.maxDelay,
      this.options.reconnectOptions.delay * Math.pow(this.options.reconnectOptions.factor, this.reconnectAttempts),
    );
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  private async resubscribeAll(): Promise<void> {
    const existingEntries = Array.from(this.subscriptions.entries());
    for (const [oldId, entry] of existingEntries) {
      this.subscriptions.delete(oldId);
      try {
        const newId = await this.sendReceive<number>(entry.request.method, entry.request.params);
        entry.subscription._updateId(newId);
        this.subscriptions.set(newId, entry);
      } catch (error) {
        entry.subscription._emitError(
          error instanceof Error ? error : new Error("Failed to re-subscribe after reconnect"),
        );
      }
    }
  }

  private registerSubscription<T>(subscriptionId: number, request: SubscriptionRequest): WebSocketSubscription<T> {
    let subscription: WebSocketSubscription<T>;
    subscription = new WebSocketSubscription<T>(
      async () => {
        try {
          await this.unsubscribe(subscription.id);
        } catch {
          // noop - subscription may already be closed
        }
      },
      subscriptionId,
    );
    this.subscriptions.set(subscriptionId, { request, subscription });
    return subscription;
  }

  private removeSubscription(subscriptionId: number): void {
    const entry = this.subscriptions.get(subscriptionId);
    if (!entry) {
      return;
    }
    this.subscriptions.delete(subscriptionId);
    entry.subscription._emitClosed();
    this.notifyUnsubscription(subscriptionId);
  }

  private notifyUnsubscription(subscriptionId: number): void {
    const waiters = this.unsubscriptionWaiters.get(subscriptionId);
    if (!waiters) return;
    waiters.forEach((resolve) => resolve());
    this.unsubscriptionWaiters.delete(subscriptionId);
  }
}

