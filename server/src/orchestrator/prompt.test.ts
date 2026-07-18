import { describe, expect, it } from 'vitest';
import { createLoop } from '../domain/reducer.js';
import type { ExtractedOrder, Loop } from '../domain/types.js';
import { buildPatientPrompt } from './prompt.js';

function loopWithDob(dob: string | null): Loop {
  const order: ExtractedOrder = {
    order_id: 'order-identity',
    patient: { name: 'Jordan Whitfield', dob, phone: '+14088873921', preferred_language: 'English' },
    study: { type: 'Diagnostic mammogram', laterality: 'left', reason_code: null },
    urgency: {
      due_date: '2026-07-30', window_days: 14,
      evidence_quote: 'within two weeks', evidence_location: 'clinician transcript',
    },
    ordering_provider: { name: 'Dr. Alicia Reyes', practice: 'Bay Valley Primary Care', callback: null },
    evidence_links: [{ field: 'study.type', quote: 'diagnostic mammogram', location: 'clinician transcript' }],
  };
  return { ...createLoop(), order };
}

describe('patient scheduling prompt', () => {
  it('includes the on-file DOB for private comparison without permission to disclose it', () => {
    const prompt = buildPatientPrompt(loopWithDob('1979-03-22'), []);
    expect(prompt).toContain('The date of birth on file is 1979-03-22');
    expect(prompt).toContain('Do NOT say the date yourself or read it aloud');
    expect(prompt).toContain('Only offer slots after the stated date of birth matches');
    expect(prompt).toContain('Say ONE short turn at a time, then STOP and WAIT');
  });

  it('uses cautious alternate verification when no DOB is on file', () => {
    const prompt = buildPatientPrompt(loopWithDob(null), []);
    expect(prompt).not.toContain('1979-03-22');
    expect(prompt).toContain('There is no date of birth on file to check');
    expect(prompt).toContain("Verify the patient's full name");
  });
});
