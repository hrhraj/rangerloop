import type {
  AskRangerClient,
  CallStatus,
  InboundExpectRequest,
  PlaceCallRequest,
  SmsRequest,
} from './types.js';

export class MockAskRangerClient implements AskRangerClient {
  readonly placeCallRequests: PlaceCallRequest[] = [];
  #callCount = 0;
  #smsCount = 0;
  #expectationCount = 0;

  async placeCall(req: PlaceCallRequest): Promise<{
    callId: string;
    status: 'accepted';
    idempotencyKey: string;
  }> {
    this.placeCallRequests.push(req);
    this.#callCount += 1;
    return { callId: `ext_${this.#callCount}`, status: 'accepted', idempotencyKey: req.idempotencyKey };
  }

  async getCall(_callId: string): Promise<CallStatus> {
    throw new Error('MockAskRangerClient.getCall is not configured');
  }

  async sendSms(_req: SmsRequest): Promise<{ messageId: string; status: 'queued' }> {
    this.#smsCount += 1;
    return { messageId: `sms_${this.#smsCount}`, status: 'queued' };
  }

  async armInboundExpect(_req: InboundExpectRequest): Promise<{
    expectationId: string;
    status: 'armed';
    expiresAt: string;
  }> {
    this.#expectationCount += 1;
    return { expectationId: `exp_${this.#expectationCount}`, status: 'armed', expiresAt: '' };
  }
}
