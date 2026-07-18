import { describe, expect, it } from 'vitest';
import { createLoop, reduce } from './reducer.js';
import type { ExtractedOrder, FoundSlot, Loop, Patient, ServiceRequest } from './types.js';

const order: ExtractedOrder = {
  order_id: 'order-1',
  patient: { name: 'Maria Reyes', dob: '1982-04-12', phone: '+15550148273', preferred_language: 'Spanish' },
  study: { type: 'Diagnostic mammogram', laterality: 'left', reason_code: null },
  urgency: {
    due_date: '2026-07-30', window_days: 14,
    evidence_quote: 'diagnostic mammogram within two weeks', evidence_location: 'signed order',
  },
  ordering_provider: { name: 'Dr. Chen', practice: "Valley Women's Health", callback: null },
  evidence_links: [{ field: 'study.type', quote: 'diagnostic mammogram', location: 'signed order' }],
};

const patient: Patient = {
  resourceType: 'Patient', id: 'patient-1', name: 'Maria Reyes', birthDate: '1982-04-12',
};

const serviceRequest: ServiceRequest = {
  resourceType: 'ServiceRequest', id: 'request-1', status: 'active', intent: 'order',
  code: { text: 'Diagnostic mammogram' }, subject: { reference: 'Patient/patient-1' },
};

const compliantSlot: FoundSlot = {
  id: 'center-2:2026-07-21T10:30:00Z',
  centerId: 'center-2',
  slotISO: '2026-07-21T10:30:00Z',
  compliant: true,
};

const lateSlot: FoundSlot = {
  id: 'center-3:2026-08-06T09:00:00Z',
  centerId: 'center-3',
  slotISO: '2026-08-06T09:00:00Z',
  compliant: false,
};

function startedCenter(centerId = 'center-2', callId = 'call-center'): Loop {
  return reduce(createLoop(), {
    type: 'CENTER_CALL_STARTED',
    centerId,
    callId,
    idempotencyKey: `idem-${callId}`,
  });
}

describe('loop reducer Batch B transitions', () => {
  it('ingests, extracts, and evidence-links an order', () => {
    const ingested = reduce(createLoop(), { type: 'ORDER_INGESTED', documentText: 'signed order' });
    const extracted = reduce(ingested, { type: 'ORDER_EXTRACTED', order, serviceRequest, patient });
    expect(ingested.timeline.at(-1)?.type).toBe('order_ingested');
    expect(extracted.state).toBe('EXTRACTED');
    expect(extracted.order).toEqual(order);
    expect(extracted.timeline.at(-1)?.evidenceRef).toEqual(order.evidence_links[0]);
  });

  it('holds an ambiguous extraction for review', () => {
    const loop = reduce(createLoop(), { type: 'NEEDS_REVIEW', reasons: ['Missing due date'] });
    expect(loop.state).toBe('NEEDS_REVIEW');
    expect(loop.fhir.task.status).toBe('on-hold');
    expect(loop.timeline.at(-1)?.type).toBe('needs_review');
  });

  it('starts a center call and records the call and timeline', () => {
    const loop = startedCenter();
    expect(loop.state).toBe('CENTERS_CALLING');
    expect(loop.calls[0]?.status).toBe('accepted');
    expect(loop.timeline.at(-1)?.type).toBe('center_call_started');
    expect(loop.fhir.task.businessStatus).toBe('CENTERS_CALLING');
  });

  it('moves to SLOT_FOUND when a center returns a compliant slot', () => {
    const loop = reduce(startedCenter(), {
      type: 'CENTER_CALL_COMPLETED', centerId: 'center-2', callId: 'call-center', reached: 'human', slot: compliantSlot,
    });
    expect(loop.state).toBe('SLOT_FOUND');
    expect(loop.slots).toEqual([compliantSlot]);
    expect(loop.calls[0]?.status).toBe('completed');
    expect(loop.timeline.at(-1)?.type).toBe('slot_found');
  });

  it('keeps calling centers when the returned slot is non-compliant', () => {
    const loop = reduce(startedCenter('center-3'), {
      type: 'CENTER_CALL_COMPLETED', centerId: 'center-3', callId: 'call-center', reached: 'human', slot: lateSlot,
    });
    expect(loop.state).toBe('CENTERS_CALLING');
    expect(loop.slots).toEqual([lateSlot]);
    expect(loop.timeline.at(-1)?.type).toBe('center_attempt');
  });

  it('does not regress PATIENT_CONFIRMED on a replayed center completion', () => {
    const centerCompleted = reduce(startedCenter(), {
      type: 'CENTER_CALL_COMPLETED', centerId: 'center-2', callId: 'call-center', reached: 'human', slot: compliantSlot,
    });
    const patientStarted = reduce(centerCompleted, {
      type: 'PATIENT_CALL_STARTED', callId: 'call-patient', idempotencyKey: 'idem-patient',
    });
    const confirmed = reduce(patientStarted, {
      type: 'PATIENT_CALL_COMPLETED', callId: 'call-patient', reached: 'human',
      acceptedSlotId: compliantSlot.slotISO, clinicalQuestion: false, declined: false,
    });
    const replayed = reduce(confirmed, {
      type: 'CENTER_CALL_COMPLETED', centerId: 'center-2', callId: 'call-center', reached: 'human', slot: compliantSlot,
    });
    expect(replayed.state).toBe('PATIENT_CONFIRMED');
    expect(replayed.fhir.task.businessStatus).toBe('PATIENT_CONFIRMED');
  });

  it('starts a patient call and records the call and timeline', () => {
    const loop = reduce(createLoop(), {
      type: 'PATIENT_CALL_STARTED', callId: 'call-patient', idempotencyKey: 'idem-patient',
    });
    expect(loop.state).toBe('PATIENT_CALLING');
    expect(loop.calls[0]?.target).toBe('patient');
    expect(loop.timeline.at(-1)?.type).toBe('patient_call_started');
  });

  it('confirms a patient and appends a parallel clinical escalation without stopping the loop', () => {
    const started = reduce(createLoop(), {
      type: 'PATIENT_CALL_STARTED', callId: 'call-patient', idempotencyKey: 'idem-patient',
    });
    const loop = reduce(started, {
      type: 'PATIENT_CALL_COMPLETED',
      callId: 'call-patient',
      reached: 'human',
      acceptedSlotId: compliantSlot.slotISO,
      clinicalQuestion: true,
      declined: false,
    });
    expect(loop.state).toBe('PATIENT_CONFIRMED');
    expect(loop.escalations.map(({ reason }) => reason)).toEqual(['clinical_question']);
    expect(loop.timeline.at(-1)?.type).toBe('patient_confirmed');
  });

  it('records an unconfirmed patient attempt without leaving PATIENT_CALLING', () => {
    const started = reduce(createLoop(), {
      type: 'PATIENT_CALL_STARTED', callId: 'call-patient', idempotencyKey: 'idem-patient',
    });
    const loop = reduce(started, {
      type: 'PATIENT_CALL_COMPLETED', callId: 'call-patient', reached: 'voicemail', clinicalQuestion: false, declined: false,
    });
    expect(loop.state).toBe('PATIENT_CALLING');
    expect(loop.timeline.at(-1)?.type).toBe('patient_attempt');
  });

  it('records SMS and inbound expectation events without changing state', () => {
    const sms = reduce(createLoop(), { type: 'SMS_SENT', messageId: 'msg-1', slotId: compliantSlot.id });
    const inbound = reduce(sms, { type: 'INBOUND_ARMED', expectationId: 'expect-1' });
    expect(inbound.state).toBe('ORDERED');
    expect(inbound.timeline.map(({ type }) => type)).toEqual(['sms_sent', 'inbound_armed']);
  });

  it('links external calls and records reasoning through reducer actions', () => {
    const started = startedCenter();
    const linked = reduce(started, {
      type: 'CALL_LINKED', callId: 'call-center', externalCallId: 'askranger-call-1',
    });
    const noted = reduce(linked, {
      type: 'TIMELINE_NOTE', noteType: 'reasoning', summary: 'Claude reasoning', reasoning: 'Try the nearest center.',
    });
    expect(linked.calls[0]?.externalCallId).toBe('askranger-call-1');
    expect(noted.timeline.at(-1)?.reasoning).toBe('Try the nearest center.');
  });

  it('materializes a booked appointment when scheduled', () => {
    const confirmed = { ...createLoop(), state: 'PATIENT_CONFIRMED' as const, slots: [compliantSlot] };
    const loop = reduce(confirmed, { type: 'SCHEDULED', centerId: 'center-2', slotId: compliantSlot.id });
    expect(loop.state).toBe('SCHEDULED');
    expect(loop.fhir.task.status).toBe('completed');
    expect(loop.fhir.appointment).toEqual({
      resourceType: 'Appointment',
      id: `appointment-${loop.id}`,
      status: 'booked',
      start: compliantSlot.slotISO,
    });
    expect(loop.timeline.at(-1)?.type).toBe('scheduled');
  });

  it('does not regress SCHEDULED on a replayed patient completion', () => {
    const confirmed: Loop = { ...createLoop(), state: 'PATIENT_CONFIRMED', slots: [compliantSlot] };
    const scheduled = reduce(confirmed, { type: 'SCHEDULED', centerId: 'center-2', slotId: compliantSlot.id });
    const replayed = reduce(scheduled, {
      type: 'PATIENT_CALL_COMPLETED', callId: 'call-patient', reached: 'human',
      clinicalQuestion: false, declined: false,
    });
    expect(replayed.state).toBe('SCHEDULED');
    expect(replayed.fhir.task.businessStatus).toBe('SCHEDULED');
    expect(replayed.fhir.task.status).toBe('completed');
  });

  it('moves to ESCALATED and records the escalation', () => {
    const loop = reduce(createLoop(), {
      type: 'ESCALATED', reason: 'centers_exhausted', context: 'All centers attempted',
    });
    expect(loop.state).toBe('ESCALATED');
    expect(loop.fhir.task.status).toBe('on-hold');
    expect(loop.escalations.map(({ reason }) => reason)).toEqual(['centers_exhausted']);
    expect(loop.timeline.at(-1)?.type).toBe('escalated');
  });
});
