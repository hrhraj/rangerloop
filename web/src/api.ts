// Typed client for the RangerLoop backend. In production the dashboard is served
// by the backend, so the default base is same-origin ('') and /api/* is relative.
// For local `vite dev`, set VITE_API_BASE (or use the dev proxy in vite.config).

const API_BASE: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE ?? '';

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
  target: 'center' | 'patient';
  centerId?: string;
  status: string;
  reached?: string;
  captured?: Record<string, unknown>;
  guardrail?: { profile: string | null; violations: string[]; flags: string[] };
  recordingUrl?: string;
  summary?: string;
  startedAt: string;
  endedAt?: string;
}

export interface FoundSlot {
  id: string;
  centerId: string;
  slotISO: string;
  compliant: boolean;
  referenceNumber?: string;
}

export interface Escalation {
  id: string;
  ts: string;
  reason: string;
  context: string;
}

export interface EvidenceLink { field: string; quote: string; location: string }

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
  evidence_links: EvidenceLink[];
}

export interface TranscriptTurn { speaker: string; text: string; isEvidence?: boolean }

export interface Loop {
  id: string;
  state: LoopState;
  order: ExtractedOrder | null;
  fhir: {
    serviceRequest: unknown;
    patient: unknown;
    task: unknown;
    appointment: unknown;
  };
  timeline: TimelineEvent[];
  calls: CallRecord[];
  slots: FoundSlot[];
  escalations: Escalation[];
  createdAt: string;
  updatedAt: string;
  // Populated when the loop was ingested from an Abridge ambient-FHIR encounter.
  source?: 'order' | 'encounter';
  encounter?: {
    title?: string;
    date?: string;
    transcript: TranscriptTurn[];
  };
}

export interface LoopSummary {
  id: string;
  state: LoopState;
  patientName: string | null;
  study: string | null;
  dueDate: string | null;
  centersTried: number;
  slotsFound: number;
  escalationCount: number;
  lastTimeline: TimelineEvent | null;
}

export interface EscalationRow {
  loopId: string;
  patientName: string | null;
  reason: string;
  context: string;
  ts: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export const getLoops = () => getJson<LoopSummary[]>('/api/loops');
export const getLoop = (id: string) => getJson<Loop>(`/api/loops/${encodeURIComponent(id)}`);
export const getEscalations = () => getJson<EscalationRow[]>('/api/escalations');
