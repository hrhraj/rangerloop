import type { CallEvent, CallOutcome } from '../askranger/types.js';
import { store as defaultStore } from '../domain/store.js';
import type { CallRecord, Loop } from '../domain/types.js';
import { ingestOrder as defaultIngestOrder } from '../extraction/ingest.js';
import { ingestEncounter as defaultIngestEncounter } from '../extraction/ingest.js';
import type { AbridgeEncounter } from '../extraction/encounter.js';
import { advance, onCallOutcome, type OrchestratorDeps } from '../orchestrator/engine.js';

export const RECONCILE_AFTER_MS = 8_000;

export interface RuntimeStore {
  get(id: string): Loop | undefined;
  getAll(): Loop[];
  save(loop: Loop): Loop;
}

export interface LoopRuntimeOptions {
  webhookSecret: string;
  store?: RuntimeStore;
  ingestOrder?: (documentText: string) => Promise<Loop>;
  ingestEncounter?: (encounter: AbridgeEncounter) => Promise<Loop>;
  reconcileAfterMs?: number;
  reconcileIntervalMs?: number;
  log?: (message: string) => void;
}

class AsyncMutex {
  #tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export class LoopRuntime {
  readonly deps: OrchestratorDeps;
  readonly store: RuntimeStore;
  readonly webhookSecret: string;
  readonly #ingestOrder: (documentText: string) => Promise<Loop>;
  readonly #ingestEncounter: (encounter: AbridgeEncounter) => Promise<Loop>;
  readonly #reconcileAfterMs: number;
  readonly #reconcileIntervalMs: number;
  readonly #log: (message: string) => void;
  readonly #dedupe = new Set<string>();
  readonly #mutexes = new Map<string, AsyncMutex>();
  #timer: NodeJS.Timeout | undefined;

  constructor(deps: OrchestratorDeps, opts: LoopRuntimeOptions) {
    this.deps = deps;
    this.store = opts.store ?? defaultStore;
    this.webhookSecret = opts.webhookSecret;
    this.#ingestOrder = opts.ingestOrder ?? defaultIngestOrder;
    this.#ingestEncounter = opts.ingestEncounter ?? defaultIngestEncounter;
    this.#reconcileAfterMs = opts.reconcileAfterMs ?? RECONCILE_AFTER_MS;
    this.#reconcileIntervalMs = opts.reconcileIntervalMs ?? RECONCILE_AFTER_MS;
    this.#log = opts.log ?? ((message) => console.warn(message));
  }

  async startLoop(documentText: string): Promise<Loop> {
    let loop = await this.#ingestOrder(documentText);
    return await this.#start(loop);
  }

  async startEncounter(encounter: AbridgeEncounter): Promise<Loop> {
    const loop = await this.#ingestEncounter(encounter);
    return await this.#start(loop);
  }

  async #start(initialLoop: Loop): Promise<Loop> {
    let loop = initialLoop;
    this.store.save(loop);
    if (loop.state === 'EXTRACTED') {
      const step = await advance(loop, this.deps);
      loop = step.loop;
      this.store.save(loop);
    }
    return loop;
  }

  async onWebhookEvent(event: CallEvent): Promise<void> {
    const dedupeKey = `${event.idempotencyKey}:${event.event}`;
    if (this.#dedupe.has(dedupeKey)) return;
    this.#dedupe.add(dedupeKey);
    if (event.event !== 'call.completed' && event.event !== 'call.failed') return;
    if (event.outcome === undefined) {
      this.#log(`Ignoring terminal event without outcome for ${event.callId}`);
      return;
    }
    const loopId = event.metadata.loopId;
    const engineCallId = event.metadata.callId;
    if (typeof loopId !== 'string' || typeof engineCallId !== 'string') {
      this.#log(`Ignoring terminal event ${event.callId} without loopId/callId metadata`);
      return;
    }
    await this.#applyTerminal(loopId, engineCallId, event.outcome);
  }

  async reconcileInFlight(nowMs: number): Promise<void> {
    const candidates = this.store.getAll().flatMap((loop) => loop.calls
      .filter((call) => call.status === 'accepted'
        && call.externalCallId !== undefined
        && nowMs - Date.parse(call.startedAt) >= this.#reconcileAfterMs)
      .map((call) => ({ loopId: loop.id, call })));

    for (const { loopId, call } of candidates) {
      const dedupeKey = `${call.idempotencyKey}:reconcile`;
      if (this.#dedupe.has(dedupeKey)) continue;
      const status = await this.deps.client.getCall(call.externalCallId!);
      if ((status.status === 'completed' || status.status === 'failed') && status.outcome !== null) {
        this.#dedupe.add(dedupeKey);
        await this.#applyTerminal(loopId, call.id, status.outcome);
      }
    }
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => {
      void this.reconcileInFlight(Date.now()).catch((error: unknown) => {
        this.#log(`Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.#reconcileIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async #applyTerminal(loopId: string, engineCallId: string, outcome: CallOutcome): Promise<void> {
    const mutex = this.#mutexes.get(loopId) ?? new AsyncMutex();
    this.#mutexes.set(loopId, mutex);
    await mutex.runExclusive(async () => {
      const loop = this.store.get(loopId);
      if (loop === undefined) {
        this.#log(`Ignoring terminal outcome for unknown loop ${loopId}`);
        return;
      }
      const call = loop.calls.find(({ id }) => id === engineCallId);
      if (call === undefined) {
        this.#log(`Ignoring terminal outcome for unknown call ${engineCallId}`);
        return;
      }
      if (this.#isTerminal(call)) return;
      const step = await onCallOutcome(loop, engineCallId, outcome, this.deps);
      this.store.save(step.loop);
    });
  }

  #isTerminal(call: CallRecord): boolean {
    return call.status === 'completed' || call.status === 'failed';
  }
}
