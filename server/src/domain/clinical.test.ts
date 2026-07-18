import { describe, expect, it } from 'vitest';
import type { CallOutcome } from './types.js';
import { interpretCenterOutcome, interpretPatientOutcome, isSlotCompliant } from './clinical.js';

function callOutcome(overrides: Partial<CallOutcome> = {}): CallOutcome {
  return {
    reached: 'human',
    captured: {},
    guardrail: { profile: null, violations: [], flags: [] },
    ...overrides,
  };
}

describe('clinical interpretation', () => {
  it('classifies slots on or before the due date as compliant', () => {
    expect(isSlotCompliant('2026-07-21T10:30:00Z', '2026-07-30T23:59:59Z')).toBe(true);
    expect(isSlotCompliant('2026-07-30T17:30:00-07:00', '2026-07-30')).toBe(true);
    expect(isSlotCompliant('2026-08-06T09:00:00Z', '2026-07-30T23:59:59Z')).toBe(false);
  });

  it('classifies natural-language slot dates using the due-date year', () => {
    expect(isSlotCompliant('July 21 at 10:30 AM', '2026-07-30')).toBe(true);
    expect(isSlotCompliant('August 6th at 9 AM', '2026-07-30')).toBe(false);
    expect(isSlotCompliant('July twenty-first at ten thirty', '2026-07-30')).toBe(true);
    expect(isSlotCompliant('August sixth at nine', '2026-07-30')).toBe(false);
    expect(isSlotCompliant('sometime next week', '2026-07-30')).toBe(false);
  });

  it('interprets a raw center outcome containing a slot', () => {
    const interpreted = interpretCenterOutcome(callOutcome({
      captured: {
        earliest_slot: '2026-07-21T10:30:00Z',
        reference_number: 'BAY-4471',
        fax_needed: false,
      },
    }), 'center-2', '2026-07-30T23:59:59Z');
    expect(interpreted).toEqual({
      reached: 'human',
      slot: {
        id: 'center-2:2026-07-21T10:30:00Z',
        centerId: 'center-2',
        slotISO: '2026-07-21T10:30:00Z',
        compliant: true,
        referenceNumber: 'BAY-4471',
        faxNeeded: false,
      },
    });
  });

  it('interprets a raw center outcome without a slot', () => {
    expect(interpretCenterOutcome(callOutcome({ reached: 'no_answer' }), 'center-1', '2026-07-30')).toEqual({
      reached: 'no_answer',
    });
  });

  it('interprets patient confirmation', () => {
    expect(interpretPatientOutcome(callOutcome({ captured: { accepted_slot: '2026-07-21T10:30:00Z' } }))).toEqual({
      reached: 'human',
      acceptedSlotId: '2026-07-21T10:30:00Z',
      clinicalQuestion: false,
      declined: false,
    });
  });

  it('interprets a patient clinical question from flags or captured data', () => {
    const flagged = callOutcome({ guardrail: { profile: 'healthcare', violations: [], flags: ['question_outside_scope'] } });
    const captured = callOutcome({ captured: { asked_clinical_question: true } });
    expect(interpretPatientOutcome(flagged).clinicalQuestion).toBe(true);
    expect(interpretPatientOutcome(captured).clinicalQuestion).toBe(true);
  });

  it('interprets a patient decline', () => {
    expect(interpretPatientOutcome(callOutcome({ captured: { declined: true } })).declined).toBe(true);
  });

  it('interprets patient voicemail as no decision', () => {
    expect(interpretPatientOutcome(callOutcome({ reached: 'voicemail' }))).toEqual({
      reached: 'voicemail',
      clinicalQuestion: false,
      declined: false,
    });
  });
});
