import type { EscalationReason, Loop } from '../domain/types.js';

export function checkMandatoryEscalation(
  loop: Loop,
  roster: string[],
  nowISO: string,
): EscalationReason | null {
  if (loop.state === 'NEEDS_REVIEW') return 'extraction_ambiguity';

  const dueDate = loop.order?.urgency.due_date;
  const dueDateBreached = dueDate !== null && dueDate !== undefined
    && (/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      ? nowISO.slice(0, 10) > dueDate
      : Date.parse(nowISO) > Date.parse(dueDate));
  if (dueDateBreached && loop.state !== 'SCHEDULED') {
    return 'due_date_breach';
  }

  const triedCenters = new Set(
    loop.calls.filter(({ target }) => target === 'center').map(({ centerId }) => centerId),
  );
  const hasCompliantSlot = loop.slots.some(({ compliant }) => compliant);
  if (roster.length > 0 && roster.every((centerId) => triedCenters.has(centerId)) && !hasCompliantSlot) {
    return 'centers_exhausted';
  }

  const patientAttempts = loop.calls.filter(({ target }) => target === 'patient').length;
  if (patientAttempts >= 3 && loop.state !== 'PATIENT_CONFIRMED' && loop.state !== 'SCHEDULED') {
    return 'patient_unreachable';
  }
  return null;
}
