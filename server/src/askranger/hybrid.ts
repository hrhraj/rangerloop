import type {
  AskRangerClient,
  CallStatus,
  InboundExpectRequest,
  PlaceCallRequest,
  SmsRequest,
} from './types.js';

export class HybridAskRangerClient implements AskRangerClient {
  readonly #mock: AskRangerClient;
  readonly #live: AskRangerClient;
  readonly #owners = new Map<string, 'live' | 'mock'>();

  constructor(options: { mock: AskRangerClient; live: AskRangerClient }) {
    this.#mock = options.mock;
    this.#live = options.live;
  }

  async placeCall(req: PlaceCallRequest): Promise<{
    callId: string;
    status: 'accepted';
    idempotencyKey: string;
  }> {
    const owner = req.metadata?.target === 'patient' ? 'live' : 'mock';
    const client = owner === 'live' ? this.#live : this.#mock;
    const placed = await client.placeCall(req);
    this.#owners.set(placed.callId, owner);
    return placed;
  }

  async getCall(callId: string): Promise<CallStatus> {
    return await (this.#owners.get(callId) === 'live' ? this.#live : this.#mock).getCall(callId);
  }

  async sendSms(req: SmsRequest): Promise<{ messageId: string; status: 'queued' }> {
    return await this.#live.sendSms(req);
  }

  async armInboundExpect(req: InboundExpectRequest): Promise<{
    expectationId: string;
    status: 'armed';
    expiresAt: string;
  }> {
    return await this.#live.armInboundExpect(req);
  }
}
