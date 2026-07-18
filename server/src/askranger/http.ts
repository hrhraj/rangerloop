import type {
  AskRangerClient,
  CallOutcome,
  CallStatus,
  InboundExpectRequest,
  PlaceCallRequest,
  SmsRequest,
} from './types.js';

interface WireCallOutcome {
  reached: CallOutcome['reached'];
  captured: Record<string, unknown>;
  guardrail: CallOutcome['guardrail'];
  transcript_url?: string;
  recording_url?: string;
  summary?: string;
}

class AskRangerHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AskRangerHttpError';
  }
}

export class HttpAskRangerClient implements AskRangerClient {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #allowDeferredEndpointStubs: boolean;
  readonly #logWarning: (message: string) => void;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    allowDeferredEndpointStubs?: boolean;
    logWarning?: (message: string) => void;
  }) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '');
    this.#apiKey = options.apiKey;
    this.#allowDeferredEndpointStubs = options.allowDeferredEndpointStubs ?? false;
    this.#logWarning = options.logWarning ?? ((message) => console.warn(message));
  }

  async placeCall(req: PlaceCallRequest): Promise<{
    callId: string;
    status: 'accepted';
    idempotencyKey: string;
  }> {
    const response = await this.#request<{
      call_id: string;
      status: 'accepted';
      idempotency_key: string;
    }>('/api/v1/calls', {
      method: 'POST',
      body: JSON.stringify({
        idempotency_key: req.idempotencyKey,
        to_phone: req.toPhone,
        callback_url: req.callbackUrl,
        script: {
          system_prompt: req.script.systemPrompt,
          capture_schema: req.script.captureSchema,
        },
        guardrail_profile: req.guardrailProfile ?? null,
        ...(req.calleeType === undefined ? {} : { callee_type: req.calleeType }),
        caller_identity: {
          on_behalf_of: req.callerIdentity.onBehalfOf,
          persona: req.callerIdentity.persona,
        },
        metadata: req.metadata ?? {},
      }),
    });
    return {
      callId: response.call_id,
      status: response.status,
      idempotencyKey: response.idempotency_key,
    };
  }

  async getCall(callId: string): Promise<CallStatus> {
    const response = await this.#request<{
      call_id: string;
      status: CallStatus['status'];
      outcome: WireCallOutcome | null;
    }>(`/api/v1/calls/${encodeURIComponent(callId)}`);
    return {
      callId: response.call_id,
      status: response.status,
      outcome: response.outcome === null ? null : this.#fromWireOutcome(response.outcome),
    };
  }

  async sendSms(req: SmsRequest): Promise<{ messageId: string; status: 'queued' }> {
    try {
      const response = await this.#request<{ message_id: string; status: 'queued' }>('/api/v1/sms', {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: req.idempotencyKey,
          to_phone: req.toPhone,
          body: req.body,
          ...(req.callbackUrl === undefined ? {} : { callback_url: req.callbackUrl }),
        }),
      });
      return { messageId: response.message_id, status: response.status };
    } catch (error) {
      if (!this.#isDeferredEndpointError(error)) throw error;
      this.#logWarning('AskRanger POST /api/v1/sms is unavailable; returning explicit live-smoke stub success.');
      return { messageId: 'stub', status: 'queued' };
    }
  }

  async armInboundExpect(req: InboundExpectRequest): Promise<{
    expectationId: string;
    status: 'armed';
    expiresAt: string;
  }> {
    try {
      const response = await this.#request<{
        expectation_id: string;
        status: 'armed';
        expires_at: string;
      }>('/api/v1/inbound/expect', {
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: req.idempotencyKey,
          from_phone: req.fromPhone,
          answer_number: req.answerNumber,
          ttl_seconds: req.ttlSeconds,
          context: {
            system_prompt: req.context.systemPrompt,
            guardrail_profile: req.context.guardrailProfile ?? null,
            state: req.context.state,
          },
          ...(req.callbackUrl === undefined ? {} : { callback_url: req.callbackUrl }),
        }),
      });
      return {
        expectationId: response.expectation_id,
        status: response.status,
        expiresAt: response.expires_at,
      };
    } catch (error) {
      if (!this.#isDeferredEndpointError(error)) throw error;
      this.#logWarning('AskRanger POST /api/v1/inbound/expect is unavailable; returning explicit live-smoke stub success.');
      return {
        expectationId: 'stub',
        status: 'armed',
        expiresAt: new Date(Date.now() + req.ttlSeconds * 1_000).toISOString(),
      };
    }
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new AskRangerHttpError(
        response.status,
        `AskRanger ${init.method ?? 'GET'} ${path} failed (${response.status}): ${detail}`,
      );
    }
    return await response.json() as T;
  }

  #fromWireOutcome(outcome: WireCallOutcome): CallOutcome {
    return {
      reached: outcome.reached,
      captured: outcome.captured,
      guardrail: outcome.guardrail,
      ...(outcome.transcript_url === undefined ? {} : { transcriptUrl: outcome.transcript_url }),
      ...(outcome.recording_url === undefined ? {} : { recordingUrl: outcome.recording_url }),
      ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
    };
  }

  #isDeferredEndpointError(error: unknown): boolean {
    return this.#allowDeferredEndpointStubs
      && error instanceof AskRangerHttpError
      && (error.status === 404 || error.status === 501);
  }
}
