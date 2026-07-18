import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  markEvidenceTurns,
  serializeEncounter,
  type AbridgeEncounter,
} from './encounter.js';

describe('ambient encounter ingestion', () => {
  it('serializes the FHIR order and flags the clinician spoken-order evidence', async () => {
    const fixture = JSON.parse(await readFile(
      resolve(process.cwd(), '../fixtures/abridge-encounter-mammogram.json'),
      'utf8',
    )) as AbridgeEncounter;
    const serialized = serializeEncounter(fixture);
    const spokenOrder = "I'm ordering a diagnostic mammogram of the left breast, and I want you to have it done within the next two weeks";

    expect(serialized).toContain('Diagnostic mammogram, left breast');
    expect(serialized).toContain('within the next two weeks');
    const transcript = markEvidenceTurns(fixture.transcript, [
      'diagnostic mammogram of the left breast',
      'within the next two weeks',
    ]);
    const evidenceTurn = transcript.find(({ isEvidence }) => isEvidence === true);
    expect(evidenceTurn?.speaker).toBe('DR');
    expect(evidenceTurn?.text).toContain(spokenOrder);
  });
});
