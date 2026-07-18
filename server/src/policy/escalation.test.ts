import { describe, expect, it } from 'vitest';
import { createLoop, reduce } from '../domain/reducer.js';
import type { ExtractedOrder, Loop } from '../domain/types.js';
import { checkMandatoryEscalation } from './escalation.js';

const roster = ['center-1', 'center-2'];

function order(dueDate: string): ExtractedOrder {
  return {
    order_id: 'order-1',
    patient: { name: 'Maria Reyes', dob: null, phone: '+15550148273', preferred_language: 'Spanish' },
    study: { type: 'Diagnostic mammogram', laterality: 'left', reason_code: null },
    urgency: { due_date: dueDate, window_days: 14, evidence_quote: 'within two weeks', evidence_location: 'instruction' },
    ordering_provider: { name: 'Dr. Chen', practice: null, callback: null },
    evidence_links: [{ field: 'urgency.due_date', quote: 'within two weeks', location: 'instruction' }],
  };
}

function withCompletedCenter(loop: Loop, centerId: string): Loop {
  const callId = `call-${centerId}`;
  return reduce(reduce(loop, {
    type: 'CENTER_CALL_STARTED', centerId, callId, idempotencyKey: `idem-${centerId}`,
  }), {
    type: 'CENTER_CALL_COMPLETED', centerId, callId, reached: 'no_answer',
  });
}

function withPatientAttempt(loop: Loop, attempt: number): Loop {
  const callId = `patient-${attempt}`;
  return reduce(reduce(loop, {
    type: 'PATIENT_CALL_STARTED', callId, idempotencyKey: `idem-${callId}`,
  }), {
    type: 'PATIENT_CALL_COMPLETED', callId, reached: 'voicemail', clinicalQuestion: false, declined: false,
  });
}

describe('checkMandatoryEscalation', () => {
  it('fires extraction ambiguity for NEEDS_REVIEW', () => {
    const loop = reduce(createLoop(), { type: 'NEEDS_REVIEW', reasons: ['missing due date'] });
    expect(checkMandatoryEscalation(loop, roster, '2026-07-16')).toBe('extraction_ambiguity');
  });

  it('fires due date breach when an unscheduled order is past due', () => {
    const loop = { ...createLoop(), state: 'EXTRACTED' as const, order: order('2026-07-15') };
    expect(checkMandatoryEscalation(loop, roster, '2026-07-16')).toBe('due_date_breach');
  });

  it('treats a date-only due date as inclusive through the full calendar day', () => {
    const loop = { ...createLoop(), state: 'EXTRACTED' as const, order: order('2026-07-30') };
    expect(checkMandatoryEscalation(loop, roster, '2026-07-30T23:59:59-07:00')).toBe(null);
    expect(checkMandatoryEscalation(loop, roster, '2026-07-31T00:00:00-07:00')).toBe('due_date_breach');
  });

  it('fires centers exhausted when every roster center was tried without a compliant slot', () => {
    let loop: Loop = { ...createLoop(), state: 'EXTRACTED', order: order('2026-07-30') };
    loop = withCompletedCenter(loop, 'center-1');
    loop = withCompletedCenter(loop, 'center-2');
    expect(checkMandatoryEscalation(loop, roster, '2026-07-16')).toBe('centers_exhausted');
  });

  it('fires patient unreachable after three attempts', () => {
    let loop: Loop = { ...createLoop(), state: 'SLOT_FOUND', order: order('2026-07-30'), slots: [{
      id: 'slot-1', centerId: 'center-1', slotISO: '2026-07-21', compliant: true,
    }] };
    loop = withPatientAttempt(loop, 1);
    loop = withPatientAttempt(loop, 2);
    loop = withPatientAttempt(loop, 3);
    expect(checkMandatoryEscalation(loop, roster, '2026-07-16')).toBe('patient_unreachable');
  });

  it('returns null for a healthy loop', () => {
    const loop = { ...createLoop(), state: 'EXTRACTED' as const, order: order('2026-07-30') };
    expect(checkMandatoryEscalation(loop, roster, '2026-07-16')).toBe(null);
  });
});
