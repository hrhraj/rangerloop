import { describe, expect, it } from 'vitest';
import type {
  AskRangerClient,
  CallStatus,
  InboundExpectRequest,
  PlaceCallRequest,
  SmsRequest,
} from './types.js';
import { HybridAskRangerClient } from './hybrid.js';

class StubClient implements AskRangerClient {
  readonly calls: PlaceCallRequest[] = [];
  readonly reconciled: string[] = [];
  smsCount = 0;
  inboundCount = 0;

  constructor(readonly prefix: string) {}

  async placeCall(req: PlaceCallRequest) {
    this.calls.push(req);
    return { callId: `${this.prefix}-${this.calls.length}`, status: 'accepted' as const, idempotencyKey: req.idempotencyKey };
  }

  async getCall(callId: string): Promise<CallStatus> {
    this.reconciled.push(callId);
    return { callId, status: 'accepted', outcome: null };
  }

  async sendSms(_req: SmsRequest) {
    this.smsCount += 1;
    return { messageId: `${this.prefix}-sms`, status: 'queued' as const };
  }

  async armInboundExpect(_req: InboundExpectRequest) {
    this.inboundCount += 1;
    return { expectationId: `${this.prefix}-expect`, status: 'armed' as const, expiresAt: '' };
  }
}

function request(target: 'center' | 'patient', idempotencyKey: string): PlaceCallRequest {
  return {
    idempotencyKey,
    toPhone: '+15550000000',
    callbackUrl: 'https://rangerloop.test/webhooks/askranger',
    script: { systemPrompt: 'Schedule.', captureSchema: {} },
    callerIdentity: { onBehalfOf: 'provider office', persona: 'assistant' },
    metadata: { target },
  };
}

describe('HybridAskRangerClient', () => {
  it('routes centers to mock, patients and messaging to live, and reconciles by owner', async () => {
    const mock = new StubClient('mock');
    const live = new StubClient('live');
    const client = new HybridAskRangerClient({ mock, live });

    const center = await client.placeCall(request('center', 'center-call'));
    const patient = await client.placeCall(request('patient', 'patient-call'));
    await client.getCall(center.callId);
    await client.getCall(patient.callId);
    await client.sendSms({ idempotencyKey: 'sms', toPhone: '+15550000000', body: 'Confirmed' });
    await client.armInboundExpect({
      idempotencyKey: 'inbound', fromPhone: '+15550000000', answerNumber: '+15551111111', ttlSeconds: 60,
      context: { systemPrompt: 'Resume.', state: {} },
    });

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.metadata?.target).toBe('center');
    expect(live.calls).toHaveLength(1);
    expect(live.calls[0]?.metadata?.target).toBe('patient');
    expect(mock.reconciled).toEqual(['mock-1']);
    expect(live.reconciled).toEqual(['live-1']);
    expect(live.smsCount).toBe(1);
    expect(live.inboundCount).toBe(1);
  });
});
