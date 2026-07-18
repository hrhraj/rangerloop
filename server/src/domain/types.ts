export type LoopState =
  | 'ORDERED' | 'EXTRACTED' | 'NEEDS_REVIEW'
  | 'CENTERS_CALLING' | 'SLOT_FOUND'
  | 'PATIENT_CALLING' | 'PATIENT_CONFIRMED' | 'SCHEDULED'
  | 'ESCALATED';

export interface TimelineEvent {
  id: string;
  ts: string;
  type: string;
  summary: string;
  evidenceRef?: { field: string; quote: string; location: string };
  reasoning?: string;
  callRef?: string;
}

export interface CallRecord {
  id: string;
  externalCallId?: string;
  idempotencyKey: string;
  target: 'center' | 'patient';
  centerId?: string;
  status: 'accepted' | 'in_progress' | 'completed' | 'failed';
  reached?: 'human' | 'voicemail' | 'ivr_deadend' | 'no_answer';
  captured?: Record<string, unknown>;
  guardrail?: { profile: string | null; violations: string[]; flags: string[] };
  transcriptUrl?: string;
  recordingUrl?: string;
  summary?: string;
  startedAt: string;
  endedAt?: string;
}

export type EscalationReason =
  | 'centers_exhausted' | 'patient_unreachable' | 'extraction_ambiguity'
  | 'clinical_question' | 'due_date_breach' | 'patient_declined';

export interface Escalation {
  id: string;
  ts: string;
  reason: EscalationReason;
  context: string;
  transcriptRef?: string;
}

export interface FoundSlot {
  id: string;
  centerId: string;
  slotISO: string;
  compliant: boolean;
  referenceNumber?: string;
  faxNeeded?: boolean;
}

export interface ExtractedOrder {
  order_id: string;
  patient: { name: string; dob: string | null; phone: string | null; preferred_language: string };
  study: { type: string; laterality: string | null; reason_code: string | null };
  urgency: {
    due_date: string | null;
    window_days: number | null;
    evidence_quote: string | null;
    evidence_location: string | null;
  };
  ordering_provider: { name: string; practice: string | null; callback: string | null };
  evidence_links: { field: string; quote: string; location: string }[];
}

export interface CallOutcome {
  reached: NonNullable<CallRecord['reached']>;
  captured: Record<string, unknown>;
  guardrail: { profile: string | null; violations: string[]; flags: string[] };
}

export interface ServiceRequest {
  resourceType: 'ServiceRequest';
  id: string;
  status: string;
  intent: 'order';
  code: { text: string };
  occurrenceDateTime?: string;
  reasonCode?: { text: string }[];
  requester?: { display: string };
  subject: { reference: string };
}

export interface Patient {
  resourceType: 'Patient';
  id: string;
  name: string;
  birthDate?: string;
  telecom?: { system: 'phone'; value: string }[];
  communication?: { language: string }[];
}

export interface Task {
  resourceType: 'Task';
  id: string;
  status: 'requested' | 'in-progress' | 'completed' | 'failed' | 'on-hold';
  businessStatus: LoopState;
  intent: 'order';
  focus?: { reference: string };
  for?: { reference: string };
  authoredOn: string;
  lastModified: string;
  output?: unknown[];
}

export interface Appointment {
  resourceType: 'Appointment';
  id: string;
  status: 'booked' | 'proposed' | 'cancelled';
  start?: string;
  end?: string;
}

export interface Loop {
  id: string;
  state: LoopState;
  order: ExtractedOrder | null;
  fhir: {
    serviceRequest: ServiceRequest | null;
    patient: Patient | null;
    task: Task;
    appointment: Appointment | null;
  };
  timeline: TimelineEvent[];
  calls: CallRecord[];
  slots: FoundSlot[];
  escalations: Escalation[];
  encounter?: {
    title?: string;
    date?: string;
    transcript: { speaker: string; text: string; isEvidence?: boolean }[];
  };
  createdAt: string;
  updatedAt: string;
}
