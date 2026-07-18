import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallEvent, PlaceCallRequest } from './types.js';
import { DemoMockClient } from './demo-mock.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function request(
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): PlaceCallRequest {
  return {
    idempotencyKey,
    toPhone: '+15550000000',
    callbackUrl: 'https://rangerloop.test/webhooks/askranger',
    script: { systemPrompt: 'Schedule the appointment.', captureSchema: {} },
    callerIdentity: { onBehalfOf: 'provider office', persona: 'scheduling assistant' },
    metadata,
  };
}

describe('DemoMockClient conversations', () => {
  it('delivers short transcripts for every campaign branch without clinical disclosure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T19:00:00.000Z'));
    const events: CallEvent[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      events.push(JSON.parse(String(init?.body)) as CallEvent);
      return new Response(null, { status: 200 });
    }));
    const client = new DemoMockClient({
      callbackUrl: 'https://rangerloop.test/webhooks/askranger',
      webhookSecret: 'test-secret',
      deliverDelayMs: 0,
    });
    const common = { loopId: 'loop-1', callId: 'engine-call', target: 'center', dueDate: '2026-07-30' };

    await client.placeCall(request('noncompliant', { ...common, centerId: 'center-noncompliant' }));
    await client.placeCall(request('no-answer', { ...common, centerId: 'center-no-answer' }));
    await client.placeCall(request('compliant', { ...common, centerId: 'center-compliant' }));
    await client.placeCall(request('patient', { loopId: 'loop-1', callId: 'patient-call', target: 'patient' }));
    await vi.runAllTimersAsync();

    expect(events).toHaveLength(4);
    for (const event of events) {
      expect(event.outcome?.captured.transcript).toEqual(expect.any(Array));
      expect(event.outcome?.captured.transcript).not.toHaveLength(0);
    }
    const patientEvent = events.find(({ metadata }) => metadata.target === 'patient');
    const patientTranscript = JSON.stringify(patientEvent?.outcome?.captured.transcript).toLowerCase();
    expect(patientTranscript).not.toMatch(/result|finding|diagnos/);
  });
});
