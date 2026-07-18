import type { EscalationReason } from '../domain/types.js';

export type OrchestratorAction =
  | { type: 'call_imaging_center'; centerId: string }
  | { type: 'call_patient'; slotIds: string[] }
  | { type: 'arm_inbound_callback' }
  | { type: 'send_sms_confirmation'; slotId: string }
  | { type: 'escalate_to_human'; reason: EscalationReason }
  | { type: 'mark_scheduled'; centerId: string; slotId: string };
