import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import type { OrchestratorAction } from '../policy/actions.js';

const escalationReasons = [
  'centers_exhausted',
  'patient_unreachable',
  'extraction_ambiguity',
  'clinical_question',
  'due_date_breach',
  'patient_declined',
] as const;

export const orchestratorTools: Tool[] = [
  {
    name: 'call_imaging_center',
    description: 'Call one imaging center to ask for its earliest available slot.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['center_id'],
      properties: { center_id: { type: 'string' } },
    },
  },
  {
    name: 'call_patient',
    description: 'Call the patient to offer known compliant slots.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['slot_ids'],
      properties: { slot_ids: { type: 'array', items: { type: 'string' } } },
    },
  },
  {
    name: 'arm_inbound_callback',
    description: 'Arm an expected inbound patient callback with scheduling context.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'send_sms_confirmation',
    description: 'Send an SMS confirmation for a patient-confirmed slot.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['slot_id'],
      properties: { slot_id: { type: 'string' } },
    },
  },
  {
    name: 'escalate_to_human',
    description: 'Escalate the loop to a human with the applicable loop-level reason.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', enum: [...escalationReasons] } },
    },
  },
  {
    name: 'mark_scheduled',
    description: 'Mark the patient-confirmed compliant slot as scheduled.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['center_id', 'slot_id'],
      properties: { center_id: { type: 'string' }, slot_id: { type: 'string' } },
    },
  },
];

const schemas = {
  call_imaging_center: z.object({ center_id: z.string().min(1) }).strict(),
  call_patient: z.object({ slot_ids: z.array(z.string().min(1)) }).strict(),
  arm_inbound_callback: z.object({}).strict(),
  send_sms_confirmation: z.object({ slot_id: z.string().min(1) }).strict(),
  escalate_to_human: z.object({ reason: z.enum(escalationReasons) }).strict(),
  mark_scheduled: z.object({ center_id: z.string().min(1), slot_id: z.string().min(1) }).strict(),
};

export function toolUseToAction(name: string, input: unknown): OrchestratorAction {
  switch (name) {
    case 'call_imaging_center': {
      const parsed = schemas.call_imaging_center.parse(input);
      return { type: name, centerId: parsed.center_id };
    }
    case 'call_patient': {
      const parsed = schemas.call_patient.parse(input);
      return { type: name, slotIds: parsed.slot_ids };
    }
    case 'arm_inbound_callback':
      schemas.arm_inbound_callback.parse(input);
      return { type: name };
    case 'send_sms_confirmation': {
      const parsed = schemas.send_sms_confirmation.parse(input);
      return { type: name, slotId: parsed.slot_id };
    }
    case 'escalate_to_human': {
      const parsed = schemas.escalate_to_human.parse(input);
      return { type: name, reason: parsed.reason };
    }
    case 'mark_scheduled': {
      const parsed = schemas.mark_scheduled.parse(input);
      return { type: name, centerId: parsed.center_id, slotId: parsed.slot_id };
    }
    default:
      throw new Error(`Unknown orchestrator tool: ${name}`);
  }
}
