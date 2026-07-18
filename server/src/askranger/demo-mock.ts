import type {
  AskRangerClient,
  CallEvent,
  CallOutcome,
  CallStatus,
  InboundExpectRequest,
  PlaceCallRequest,
  SmsRequest,
} from './types.js';
import { signPayload } from '../http/signing.js';

export class DemoMockClient implements AskRangerClient {
  readonly #callbackUrl: string;
  readonly #webhookSecret: string;
  readonly #deliverDelayMs: number;
  readonly #dueOffsetDays: number;
  readonly #slotByLoop = new Map<string, string>();
  #counter = 0;

  constructor(options: {
    callbackUrl: string;
    webhookSecret: string;
    deliverDelayMs?: number;
    dueOffsetDays?: number;
  }) {
    this.#callbackUrl = options.callbackUrl;
    this.#webhookSecret = options.webhookSecret;
    this.#deliverDelayMs = options.deliverDelayMs ?? 1_500;
    this.#dueOffsetDays = options.dueOffsetDays ?? 3;
  }

  async placeCall(req: PlaceCallRequest): Promise<{
    callId: string;
    status: 'accepted';
    idempotencyKey: string;
  }> {
    this.#counter += 1;
    const sequence = this.#counter;
    const callId = `ext_${sequence}`;
    setTimeout(() => {
      void this.#deliver(req, callId, sequence);
    }, this.#deliverDelayMs).unref();
    return { callId, status: 'accepted', idempotencyKey: req.idempotencyKey };
  }

  async getCall(callId: string): Promise<CallStatus> {
    return { callId, status: 'accepted', outcome: null };
  }

  async sendSms(_req: SmsRequest): Promise<{ messageId: string; status: 'queued' }> {
    this.#counter += 1;
    return { messageId: `sms_${this.#counter}`, status: 'queued' };
  }

  async armInboundExpect(req: InboundExpectRequest): Promise<{
    expectationId: string;
    status: 'armed';
    expiresAt: string;
  }> {
    this.#counter += 1;
    return {
      expectationId: `exp_${this.#counter}`,
      status: 'armed',
      expiresAt: new Date(Date.now() + req.ttlSeconds * 1_000).toISOString(),
    };
  }

  async #deliver(req: PlaceCallRequest, externalCallId: string, sequence: number): Promise<void> {
    const loopId = req.metadata?.loopId;
    const target = req.metadata?.target;
    const centerId = req.metadata?.centerId;
    let reached: CallOutcome['reached'] = 'human';
    let captured: Record<string, unknown>;
    if (target === 'center' && typeof loopId === 'string' && typeof centerId === 'string') {
      if (centerId.includes('no-answer')) {
        reached = 'no_answer';
        captured = {};
      } else if (centerId.includes('noncompliant')) {
        const dueDate = req.metadata?.dueDate;
        const date = typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
          ? new Date(`${dueDate}T00:00:00.000Z`)
          : new Date();
        date.setUTCDate(date.getUTCDate() + (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? 14 : 45));
        const earliestSlot = date.toISOString().slice(0, 10);
        captured = { earliest_slot: earliestSlot, fax_needed: false, reference_number: `REF${sequence}` };
      } else {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + this.#dueOffsetDays);
        const earliestSlot = date.toISOString().slice(0, 10);
        this.#slotByLoop.set(loopId, `${centerId}:${earliestSlot}`);
        captured = { earliest_slot: earliestSlot, fax_needed: false, reference_number: `REF${sequence}` };
      }
    } else {
      const accepted = typeof loopId === 'string' ? this.#slotByLoop.get(loopId) ?? '' : '';
      captured = { identity_verified: true, accepted_slot: accepted };
    }
    const outcome: CallOutcome = {
      reached,
      captured,
      guardrail: { profile: 'healthcare_scheduling', violations: [], flags: [] },
    };
    const event: CallEvent = {
      event: 'call.completed',
      callId: externalCallId,
      idempotencyKey: req.idempotencyKey,
      timestamp: new Date().toISOString(),
      metadata: req.metadata ?? {},
      outcome,
    };
    const rawBody = JSON.stringify(event);
    try {
      const response = await fetch(this.#callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signPayload(rawBody, this.#webhookSecret),
        },
        body: rawBody,
      });
      if (!response.ok) console.warn(`Demo webhook delivery failed with status ${response.status}`);
    } catch (error) {
      console.warn(`Demo webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
