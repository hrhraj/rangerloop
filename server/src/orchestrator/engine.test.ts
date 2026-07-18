import { describe, expect, it } from 'vitest';
import { MockAskRangerClient } from '../askranger/mock.js';
import type { CallOutcome } from '../askranger/types.js';
import { createLoop, reduce } from '../domain/reducer.js';
import type { ExtractedOrder, Loop, Patient, ServiceRequest } from '../domain/types.js';
import { ScriptedDecider, type Decision } from './decider.js';
import { advance, onCallOutcome, type OrchestratorDeps, type OrchestratorStep } from './engine.js';

const roster = ['+15550001001', '+15550001002'];
const slotISO = '2026-07-21T10:30:00-07:00';

const order: ExtractedOrder = {
  order_id: 'order-1',
  patient: { name: 'Maria Reyes', dob: '1982-04-12', phone: '+15550148273', preferred_language: 'Spanish' },
  study: { type: 'Diagnostic mammogram', laterality: 'left', reason_code: null },
  urgency: {
    due_date: '2026-07-30', window_days: 14,
    evidence_quote: 'within two weeks', evidence_location: 'signed order',
  },
  ordering_provider: { name: 'Dr. Chen', practice: "Valley Women's Health", callback: '+15550140000' },
  evidence_links: [
    { field: 'study.type', quote: 'diagnostic mammogram', location: 'signed order' },
    { field: 'urgency.due_date', quote: 'within two weeks', location: 'signed order' },
    { field: 'patient.phone', quote: '+1 555 014 8273', location: 'patient header' },
  ],
};

const patient: Patient = {
  resourceType: 'Patient', id: 'patient-1', name: order.patient.name,
  ...(order.patient.dob === null ? {} : { birthDate: order.patient.dob }),
  telecom: [{ system: 'phone', value: order.patient.phone ?? '' }],
};

const request: ServiceRequest = {
  resourceType: 'ServiceRequest', id: order.order_id, status: 'active', intent: 'order',
  code: { text: order.study.type },
  ...(order.urgency.due_date === null ? {} : { occurrenceDateTime: order.urgency.due_date }),
  requester: { display: order.ordering_provider.name }, subject: { reference: `Patient/${patient.id}` },
};

function extractedLoop(): Loop {
  return reduce(createLoop(), { type: 'ORDER_EXTRACTED', order, serviceRequest: request, patient });
}

function outcome(captured: Record<string, unknown> = {}, reached: CallOutcome['reached'] = 'human'): CallOutcome {
  return { reached, captured, guardrail: { profile: 'healthcare_scheduling', violations: [], flags: [] } };
}

function deps(decisions: Decision[], client = new MockAskRangerClient()): OrchestratorDeps {
  return {
    client,
    decider: new ScriptedDecider(decisions),
    roster,
    now: () => new Date('2026-07-18T19:00:00.000Z'),
    callbackUrl: 'https://rangerloop.test/webhooks/askranger',
    callerIdentity: { onBehalfOf: "Dr. Chen's office", persona: 'automated scheduling assistant' },
    guardrailProfile: 'healthcare_scheduling',
    buildCenterPrompt: (_loop, centerId) => `Call ${centerId}`,
    buildPatientPrompt: (_loop, slotIds) => `Offer ${slotIds.join(',')}`,
  };
}

async function completeCenter(step: OrchestratorStep, orchestratorDeps: OrchestratorDeps, captured = {}): Promise<OrchestratorStep> {
  if (step.result.status !== 'awaiting_call') throw new Error('Expected an awaiting center call');
  return onCallOutcome(step.loop, step.result.callId, outcome(captured), orchestratorDeps);
}

describe('orchestrator engine', () => {
  it('runs a safe sequential happy loop through SMS to a booked appointment', async () => {
    const client = new MockAskRangerClient();
    const decisions: Decision[] = [
      { reasoning: 'Try the first center.', action: { type: 'call_imaging_center', centerId: roster[0]! } },
      { action: { type: 'call_patient', slotIds: [`${roster[0]}:${slotISO}`] } },
      { action: { type: 'send_sms_confirmation', slotId: `${roster[0]}:${slotISO}` } },
      { action: { type: 'mark_scheduled', centerId: roster[0]!, slotId: `${roster[0]}:${slotISO}` } },
    ];
    const orchestratorDeps = deps(decisions, client);

    const centerStarted = await advance(extractedLoop(), orchestratorDeps);
    const patientStarted = await completeCenter(centerStarted, orchestratorDeps, {
      earliest_slot: slotISO, fax_needed: false, reference_number: 'BAY-4471',
      transcript: [{ speaker: 'Imaging center', text: 'That appointment is available.' }],
    });
    if (patientStarted.result.status !== 'awaiting_call') throw new Error('Expected an awaiting patient call');
    const finished = await onCallOutcome(
      patientStarted.loop,
      patientStarted.result.callId,
      outcome({
        identity_verified: true,
        accepted_slot: slotISO,
        transcript: [{ speaker: 'Patient', text: 'Yes, that appointment works.' }],
      }),
      orchestratorDeps,
    );

    expect(finished.result.status).toBe('scheduled');
    expect(finished.loop.state).toBe('SCHEDULED');
    expect(finished.loop.fhir.appointment?.status).toBe('booked');
    expect(finished.loop.fhir.appointment?.start).toBe(slotISO);
    expect(finished.loop.timeline.map(({ type }) => type)).toContain('sms_sent');
    expect(finished.loop.calls.map(({ transcript }) => transcript?.[0]?.speaker)).toEqual([
      'Imaging center', 'Patient',
    ]);
    expect(client.placeCallRequests.map(({ calleeType }) => calleeType)).toEqual(['business', 'person']);
  });

  it('records a policy rejection and retries with the rejection context', async () => {
    const decider = new ScriptedDecider([
      { action: { type: 'call_patient', slotIds: [] } },
      { action: { type: 'call_imaging_center', centerId: roster[0]! } },
    ]);
    const orchestratorDeps = { ...deps([]), decider };
    const step = await advance(extractedLoop(), orchestratorDeps);

    expect(step.result.status).toBe('awaiting_call');
    expect(step.loop.timeline.map(({ type }) => type)).toContain('policy_rejected');
    expect(decider.contexts[1]?.rejection).toContain('compliant slot');
  });

  it('escalates after every roster center completes without a compliant slot', async () => {
    const decisions: Decision[] = roster.map((centerId) => ({
      action: { type: 'call_imaging_center' as const, centerId },
    }));
    const orchestratorDeps = deps(decisions);

    const first = await advance(extractedLoop(), orchestratorDeps);
    const second = await completeCenter(first, orchestratorDeps);
    const finished = await completeCenter(second, orchestratorDeps);

    expect(finished.result).toEqual({ status: 'escalated', reason: 'centers_exhausted' });
    expect(finished.loop.state).toBe('ESCALATED');
    expect(finished.loop.escalations.at(-1)?.reason).toBe('centers_exhausted');
  });
});
