import type { LoopState } from './api';

export const STAGE_ORDER: LoopState[] = [
  'ORDERED', 'EXTRACTED', 'CENTERS_CALLING', 'SLOT_FOUND',
  'PATIENT_CALLING', 'PATIENT_CONFIRMED', 'SCHEDULED',
];

export const STATE_LABEL: Record<LoopState, string> = {
  ORDERED: 'Ordered',
  EXTRACTED: 'Extracted',
  NEEDS_REVIEW: 'Needs review',
  CENTERS_CALLING: 'Calling centers',
  SLOT_FOUND: 'Slot found',
  PATIENT_CALLING: 'Calling patient',
  PATIENT_CONFIRMED: 'Patient confirmed',
  SCHEDULED: 'Scheduled',
  ESCALATED: 'Escalated',
};

export type Tone = 'neutral' | 'active' | 'good' | 'strong' | 'warn' | 'bad';

export const STATE_TONE: Record<LoopState, Tone> = {
  ORDERED: 'neutral',
  EXTRACTED: 'active',
  NEEDS_REVIEW: 'warn',
  CENTERS_CALLING: 'active',
  SLOT_FOUND: 'good',
  PATIENT_CALLING: 'active',
  PATIENT_CONFIRMED: 'good',
  SCHEDULED: 'strong',
  ESCALATED: 'bad',
};

export function StateChip({ state }: { state: LoopState }) {
  return <span className={`chip tone-${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span>;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtSlot(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return /T\d{2}:\d{2}/.test(iso)
    ? `${datePart}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : datePart;
}

export function centerLabel(centerId: string | undefined): string {
  if (!centerId) return 'Imaging center';
  const digits = centerId.replace(/[^\d]/g, '');
  return digits.length >= 4 ? `Imaging center ••${digits.slice(-4)}` : centerId;
}
