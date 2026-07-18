import type { Loop } from '../domain/types.js';
import type { OrchestratorAction } from './actions.js';

export type ValidationResult = { ok: true } | { ok: false; rejection: string };

export function validateAction(
  loop: Loop,
  action: OrchestratorAction,
  roster: string[],
): ValidationResult {
  const inFlightCall = loop.calls.find(({ status }) => status === 'accepted' || status === 'in_progress');
  const triedCenters = loop.calls
    .filter(({ target }) => target === 'center')
    .map(({ centerId }) => centerId);
  const patientAttempts = loop.calls.filter(({ target }) => target === 'patient').length;
  const hasCompliantSlot = loop.slots.some(({ compliant }) => compliant);

  if ((action.type === 'call_imaging_center' || action.type === 'call_patient') && inFlightCall !== undefined) {
    return { ok: false, rejection: `A ${inFlightCall.target} call is already in flight; calls must be sequential` };
  }

  switch (action.type) {
    case 'call_imaging_center':
      if (!roster.includes(action.centerId)) return { ok: false, rejection: `Unknown imaging center: ${action.centerId}` };
      if (triedCenters.includes(action.centerId)) return { ok: false, rejection: `Imaging center already tried: ${action.centerId}` };
      return { ok: true };
    case 'call_patient':
      if (!hasCompliantSlot) return { ok: false, rejection: 'Cannot call patient before finding a compliant slot' };
      if (patientAttempts >= 3) return { ok: false, rejection: 'Patient call attempt limit reached' };
      return { ok: true };
    case 'mark_scheduled': {
      if (loop.state !== 'PATIENT_CONFIRMED') return { ok: false, rejection: 'Cannot schedule before patient confirmation' };
      const slot = loop.slots.find(({ id }) => id === action.slotId);
      if (slot === undefined || !slot.compliant) return { ok: false, rejection: `Unknown or non-compliant slot: ${action.slotId}` };
      return { ok: true };
    }
    case 'send_sms_confirmation':
      return loop.state === 'PATIENT_CONFIRMED' || loop.state === 'SCHEDULED'
        ? { ok: true }
        : { ok: false, rejection: 'Cannot send confirmation SMS before patient confirmation' };
    case 'escalate_to_human':
    case 'arm_inbound_callback':
      return { ok: true };
  }
}
