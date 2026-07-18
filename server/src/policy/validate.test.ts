import { describe, expect, it } from 'vitest';
import { createLoop, reduce } from '../domain/reducer.js';
import type { FoundSlot, Loop } from '../domain/types.js';
import { validateAction } from './validate.js';

const roster = ['center-1', 'center-2'];
const compliantSlot: FoundSlot = {
  id: 'slot-1', centerId: 'center-1', slotISO: '2026-07-21T10:30:00Z', compliant: true,
};

function completedCenter(centerId: string): Loop {
  const started = reduce(createLoop(), {
    type: 'CENTER_CALL_STARTED', centerId, callId: `call-${centerId}`, idempotencyKey: `idem-${centerId}`,
  });
  return reduce(started, {
    type: 'CENTER_CALL_COMPLETED', centerId, callId: `call-${centerId}`, reached: 'no_answer',
  });
}

describe('validateAction', () => {
  it('rejects a call while another call is in flight', () => {
    const loop = reduce(createLoop(), {
      type: 'CENTER_CALL_STARTED', centerId: 'center-1', callId: 'call-1', idempotencyKey: 'idem-1',
    });
    expect(validateAction(loop, { type: 'call_imaging_center', centerId: 'center-2' }, roster).ok).toBe(false);
  });

  it('rejects an unknown center', () => {
    expect(validateAction(createLoop(), { type: 'call_imaging_center', centerId: 'center-9' }, roster).ok).toBe(false);
  });

  it('rejects a duplicate center dial', () => {
    expect(validateAction(completedCenter('center-1'), { type: 'call_imaging_center', centerId: 'center-1' }, roster).ok).toBe(false);
  });

  it('rejects calling the patient without a compliant slot', () => {
    expect(validateAction(createLoop(), { type: 'call_patient', slotIds: [] }, roster).ok).toBe(false);
  });

  it('rejects scheduling before PATIENT_CONFIRMED', () => {
    const loop = { ...createLoop(), slots: [compliantSlot] };
    expect(validateAction(loop, { type: 'mark_scheduled', centerId: 'center-1', slotId: 'slot-1' }, roster).ok).toBe(false);
  });

  it('allows a legal patient call', () => {
    const loop = { ...createLoop(), state: 'SLOT_FOUND' as const, slots: [compliantSlot] };
    expect(validateAction(loop, { type: 'call_patient', slotIds: ['slot-1'] }, roster)).toEqual({ ok: true });
  });

  it('rejects calling another center after a compliant slot and patient no-answer', () => {
    const withSlot: Loop = { ...createLoop(), state: 'SLOT_FOUND', slots: [compliantSlot] };
    const callingPatient = reduce(withSlot, {
      type: 'PATIENT_CALL_STARTED', callId: 'call-patient', idempotencyKey: 'idem-patient',
    });
    const noAnswer = reduce(callingPatient, {
      type: 'PATIENT_CALL_COMPLETED', callId: 'call-patient', reached: 'no_answer',
      clinicalQuestion: false, declined: false,
    });
    expect(validateAction(noAnswer, { type: 'call_imaging_center', centerId: 'center-2' }, roster)).toEqual({
      ok: false,
      rejection: 'a compliant slot already exists; do not call more centers',
    });
  });
});
