import { describe, expect, it } from 'vitest';
import { MockAskRangerClient } from '../askranger/mock.js';
import { createLoop, reduce } from '../domain/reducer.js';
import type { ExtractedOrder, Loop, Patient, ServiceRequest } from '../domain/types.js';
import { ScriptedDecider } from '../orchestrator/decider.js';
import type { OrchestratorDeps } from '../orchestrator/engine.js';
import { buildHttpApp } from './app.js';
import { LoopRuntime, type RuntimeStore } from './runtime.js';

class MemoryStore implements RuntimeStore {
  readonly loops = new Map<string, Loop>();
  get(id: string) { return this.loops.get(id); }
  getAll() { return [...this.loops.values()]; }
  save(loop: Loop) { this.loops.set(loop.id, loop); return loop; }
}

function extractedLoop(): Loop {
  const order: ExtractedOrder = {
    order_id: 'order-http',
    patient: { name: 'Maria Reyes', dob: '1982-04-12', phone: '+15550148273', preferred_language: 'Spanish' },
    study: { type: 'Diagnostic mammogram', laterality: null, reason_code: null },
    urgency: {
      due_date: '2026-07-30', window_days: 14,
      evidence_quote: 'within two weeks', evidence_location: 'signed order',
    },
    ordering_provider: { name: 'Dr. Chen', practice: "Valley Women's Health", callback: null },
    evidence_links: [{ field: 'study.type', quote: 'diagnostic mammogram', location: 'signed order' }],
  };
  const patient: Patient = {
    resourceType: 'Patient', id: 'patient-http', name: order.patient.name,
    telecom: [{ system: 'phone', value: order.patient.phone! }],
  };
  const serviceRequest: ServiceRequest = {
    resourceType: 'ServiceRequest', id: order.order_id, status: 'active', intent: 'order',
    code: { text: order.study.type }, subject: { reference: `Patient/${patient.id}` },
  };
  return reduce(createLoop(), { type: 'ORDER_EXTRACTED', order, serviceRequest, patient });
}

function testApp() {
  const store = new MemoryStore();
  const decider = new ScriptedDecider([{
    action: { type: 'escalate_to_human', reason: 'extraction_ambiguity' },
  }]);
  const deps: OrchestratorDeps = {
    client: new MockAskRangerClient(), decider, roster: ['center-a'],
    now: () => new Date('2026-07-18T19:00:00.000Z'),
    callbackUrl: 'https://rangerloop.test/webhooks/askranger',
    callerIdentity: { onBehalfOf: "the ordering provider's office", persona: 'automated scheduling assistant' },
    guardrailProfile: 'healthcare_scheduling',
    buildCenterPrompt: () => 'center prompt', buildPatientPrompt: () => 'patient prompt',
  };
  const runtime = new LoopRuntime(deps, {
    webhookSecret: 'test-secret', store, ingestOrder: async () => extractedLoop(),
  });
  return {
    app: buildHttpApp({ runtime, webhookSecret: 'test-secret', roster: deps.roster, mode: 'mock' }),
    runtime,
    store,
  };
}

describe('HTTP app', () => {
  it('rejects a webhook with the wrong signature', async () => {
    const { app } = testApp();
    const response = await app.inject({
      method: 'POST', url: '/webhooks/askranger',
      headers: { 'content-type': 'application/json', 'x-signature': 'sha256=wrong' },
      payload: JSON.stringify({ event: 'call.completed' }),
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('starts a loop and exposes summary and full-loop read APIs', async () => {
    const { app } = testApp();
    const started = await app.inject({
      method: 'POST', url: '/api/loops', payload: { documentText: 'signed order' },
    });
    expect(started.statusCode).toBe(202);
    const body = started.json<{ loopId: string; state: string }>();
    expect(body.state).toBe('ESCALATED');

    const summaries = await app.inject({ method: 'GET', url: '/api/loops' });
    expect(summaries.statusCode).toBe(200);
    expect(summaries.json<Array<{ id: string; state: string }>>()).toContainEqual({
      id: body.loopId, state: 'ESCALATED',
      patientName: 'Maria Reyes', study: 'Diagnostic mammogram', dueDate: '2026-07-30',
      centersTried: 0, slotsFound: 0, escalationCount: 1,
      lastTimeline: expect.any(Object),
    });

    const full = await app.inject({ method: 'GET', url: `/api/loops/${body.loopId}` });
    expect(full.statusCode).toBe(200);
    expect(full.json<{ id: string }>().id).toBe(body.loopId);
    const missing = await app.inject({ method: 'GET', url: '/api/loops/unknown' });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('cancels an active loop and exposes named center configuration', async () => {
    const { app, store } = testApp();
    const loop = extractedLoop();
    store.save(loop);

    const cancelled = await app.inject({ method: 'POST', url: `/api/loops/${loop.id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toEqual({ loopId: loop.id, state: 'ESCALATED' });
    expect(store.get(loop.id)?.escalations.at(-1)?.reason).toBe('operator_cancelled');

    const missing = await app.inject({ method: 'POST', url: '/api/loops/unknown/cancel' });
    expect(missing.statusCode).toBe(404);

    const config = await app.inject({ method: 'GET', url: '/api/config' });
    expect(config.statusCode).toBe(200);
    const configBody = config.json<{
      mode: string;
      centers: Array<{ id: string; name: string }>;
    }>();
    expect(configBody.mode).toBe('mock');
    expect(configBody.centers).toEqual([
      { id: 'center-a', name: 'Bayview Imaging Center' },
    ]);
    await app.close();
  });
});
