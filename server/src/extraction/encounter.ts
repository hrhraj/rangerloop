export interface AbridgeEncounter {
  metadata?: { encounter_id?: string; encounter_date?: string; specialty?: string };
  patient_context?: {
    name?: string;
    sex?: string;
    birth_date?: string;
    phone?: string;
    preferred_language?: string;
    chart_background?: string;
  };
  encounter_fhir?: {
    resourceType?: string;
    entry?: { resource?: Record<string, unknown> }[];
  };
  transcript: { speaker: string; text: string }[];
  note?: string;
  after_visit_summary?: string;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function firstRecord(value: unknown): UnknownRecord | undefined {
  return Array.isArray(value) ? record(value[0]) : undefined;
}

function nestedText(resource: UnknownRecord | undefined, field: string): string | undefined {
  const value = resource?.[field];
  const container = Array.isArray(value) ? firstRecord(value) : record(value);
  return typeof container?.text === 'string' ? container.text : undefined;
}

function findResource(encounter: AbridgeEncounter, resourceType: string): UnknownRecord | undefined {
  return encounter.encounter_fhir?.entry
    ?.map(({ resource }) => resource)
    .find((resource) => resource?.resourceType === resourceType);
}

export function serializeEncounter(encounter: AbridgeEncounter): string {
  const request = findResource(encounter, 'ServiceRequest');
  const fhirPatient = findResource(encounter, 'Patient');
  const requester = record(request?.requester);
  const timing = record(record(request?.occurrenceTiming)?.code);
  const patientName = encounter.patient_context?.name
    ?? nestedText(fhirPatient, 'name')
    ?? 'unknown';
  const birthDate = encounter.patient_context?.birth_date
    ?? (typeof fhirPatient?.birthDate === 'string' ? fhirPatient.birthDate : undefined)
    ?? 'unknown';
  const phone = encounter.patient_context?.phone
    ?? (typeof firstRecord(fhirPatient?.telecom)?.value === 'string' ? firstRecord(fhirPatient?.telecom)?.value : undefined)
    ?? 'unknown';
  const language = encounter.patient_context?.preferred_language
    ?? nestedText(firstRecord(fhirPatient?.communication), 'language')
    ?? 'unknown';
  const transcript = encounter.transcript.map(({ speaker, text }) => `${speaker}: ${text}`).join('\n');

  return `AMBIENT CLINICAL ENCOUNTER - treat the FHIR ServiceRequest as the signed imaging order. For study.type and urgency.due_date evidence, quote the clinician's spoken transcript line, not the FHIR summary or note.
Encounter date: ${encounter.metadata?.encounter_date ?? 'unknown'}
Ordering provider: ${typeof requester?.display === 'string' ? requester.display : 'unknown'}
Patient: ${patientName}, DOB ${birthDate}, phone ${phone}, language ${language}
FHIR ServiceRequest: ${nestedText(request, 'code') ?? 'unknown'}; bodySite ${nestedText(request, 'bodySite') ?? 'unknown'}; reason ${nestedText(request, 'reasonCode') ?? 'unknown'}; timing ${typeof timing?.text === 'string' ? timing.text : 'unknown'}
CLINICAL NOTE: ${encounter.note ?? ''}
AFTER VISIT SUMMARY: ${encounter.after_visit_summary ?? ''}

CONVERSATION TRANSCRIPT (source of the spoken order):
${transcript}`;
}

function normalizeEvidence(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '');
}

export function markEvidenceTurns(
  transcript: AbridgeEncounter['transcript'],
  evidenceQuotes: string[],
  studyKeyword = 'mammogram',
): NonNullable<import('../domain/types.js').Loop['encounter']>['transcript'] {
  const normalizedQuotes = evidenceQuotes.map(normalizeEvidence).filter((quote) => quote.length >= 20);
  let matched = transcript.map((turn) => {
    const text = normalizeEvidence(turn.text);
    const isEvidence = normalizedQuotes.some((quote) => text.includes(quote) || quote.includes(text));
    return { ...turn, ...(isEvidence ? { isEvidence: true } : {}) };
  });
  if (matched.some(({ isEvidence }) => isEvidence === true)) return matched;

  const fallbackIndex = matched.findLastIndex(({ speaker, text }) =>
    /^(dr|doctor|clinician|provider)$/i.test(speaker.trim())
    && (text.toLowerCase().includes(studyKeyword.toLowerCase()) || /\bweek\b/i.test(text)));
  if (fallbackIndex >= 0) {
    matched = matched.map((turn, index) => index === fallbackIndex ? { ...turn, isEvidence: true } : turn);
  }
  return matched;
}
