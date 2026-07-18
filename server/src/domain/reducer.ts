import { randomUUID } from 'node:crypto';
import type {
  EscalationReason,
  ExtractedOrder,
  FoundSlot,
  Loop,
  Patient,
  ServiceRequest,
  Task,
  TimelineEvent,
} from './types.js';

export type LoopAction =
  | { type: 'ORDER_INGESTED'; documentText: string }
  | { type: 'ORDER_EXTRACTED'; order: ExtractedOrder; serviceRequest: ServiceRequest; patient: Patient }
  | { type: 'NEEDS_REVIEW'; reasons: string[] }
  | { type: 'CENTER_CALL_STARTED'; centerId: string; callId: string; idempotencyKey: string }
  | { type: 'CENTER_CALL_COMPLETED'; centerId: string; callId: string; reached: NonNullable<Loop['calls'][number]['reached']>; slot?: FoundSlot; transcript?: { speaker: string; text: string }[] }
  | { type: 'PATIENT_CALL_STARTED'; callId: string; idempotencyKey: string }
  | { type: 'PATIENT_CALL_COMPLETED'; callId: string; reached: NonNullable<Loop['calls'][number]['reached']>; acceptedSlotId?: string; clinicalQuestion: boolean; declined: boolean; transcript?: { speaker: string; text: string }[] }
  | { type: 'SMS_SENT'; messageId: string; slotId: string }
  | { type: 'INBOUND_ARMED'; expectationId: string }
  | { type: 'CALL_LINKED'; callId: string; externalCallId: string }
  | { type: 'TIMELINE_NOTE'; noteType: string; summary: string; reasoning?: string }
  | { type: 'ATTACH_ENCOUNTER'; encounter: NonNullable<Loop['encounter']> }
  | { type: 'SCHEDULED'; centerId: string; slotId: string }
  | { type: 'ESCALATED'; reason: EscalationReason; context: string };

function timelineEvent(
  type: string,
  summary: string,
  evidenceRef?: TimelineEvent['evidenceRef'],
): TimelineEvent {
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
    summary,
    ...(evidenceRef === undefined ? {} : { evidenceRef }),
  };
}

function withTask(task: Task, businessStatus: Task['businessStatus'], status: Task['status'], now: string): Task {
  return { ...task, businessStatus, status, lastModified: now };
}

export function createLoop(): Loop {
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    id,
    state: 'ORDERED',
    order: null,
    fhir: {
      serviceRequest: null,
      patient: null,
      task: {
        resourceType: 'Task',
        id: `task-${id}`,
        status: 'requested',
        businessStatus: 'ORDERED',
        intent: 'order',
        authoredOn: now,
        lastModified: now,
      },
      appointment: null,
    },
    timeline: [],
    calls: [],
    slots: [],
    escalations: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function reduce(loop: Loop, action: LoopAction): Loop {
  const now = new Date().toISOString();

  switch (action.type) {
    case 'ORDER_INGESTED':
      return {
        ...loop,
        state: 'ORDERED',
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, 'ORDERED', 'requested', now) },
        timeline: [...loop.timeline, timelineEvent('order_ingested', 'Order document ingested')],
        updatedAt: now,
      };
    case 'ORDER_EXTRACTED': {
      const studyEvidence = action.order.evidence_links.find(({ field }) => field === 'study.type');
      return {
        ...loop,
        state: 'EXTRACTED',
        order: action.order,
        fhir: {
          ...loop.fhir,
          serviceRequest: action.serviceRequest,
          patient: action.patient,
          task: {
            ...withTask(loop.fhir.task, 'EXTRACTED', 'in-progress', now),
            focus: { reference: `ServiceRequest/${action.serviceRequest.id}` },
            for: { reference: `Patient/${action.patient.id}` },
          },
        },
        timeline: [
          ...loop.timeline,
          timelineEvent(
            'order_extracted',
            `Order extracted for ${action.order.study.type}`,
            studyEvidence,
          ),
        ],
        updatedAt: now,
      };
    }
    case 'NEEDS_REVIEW':
      return {
        ...loop,
        state: 'NEEDS_REVIEW',
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, 'NEEDS_REVIEW', 'on-hold', now) },
        timeline: [
          ...loop.timeline,
          timelineEvent('needs_review', `Order needs review: ${action.reasons.join('; ')}`),
        ],
        updatedAt: now,
      };
    case 'CENTER_CALL_STARTED':
      return {
        ...loop,
        state: 'CENTERS_CALLING',
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, 'CENTERS_CALLING', 'in-progress', now) },
        calls: [
          ...loop.calls,
          {
            id: action.callId,
            idempotencyKey: action.idempotencyKey,
            target: 'center',
            centerId: action.centerId,
            status: 'accepted',
            startedAt: now,
          },
        ],
        timeline: [
          ...loop.timeline,
          { ...timelineEvent('center_call_started', `Calling imaging center ${action.centerId}`), callRef: action.callId },
        ],
        updatedAt: now,
      };
    case 'CENTER_CALL_COMPLETED': {
      const slots = action.slot === undefined ? loop.slots : [...loop.slots, action.slot];
      const compliantSlot = slots.find(({ compliant }) => compliant);
      const hasCompliant = slots.some(({ compliant }) => compliant);
      const state = loop.state === 'CENTERS_CALLING' && hasCompliant ? 'SLOT_FOUND' : loop.state;
      const taskStatus = state === loop.state ? loop.fhir.task.status : 'in-progress';
      return {
        ...loop,
        state,
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, state, taskStatus, now) },
        calls: loop.calls.map((call) => call.id === action.callId
          ? {
              ...call, status: 'completed', reached: action.reached, endedAt: now,
              ...(action.transcript === undefined ? {} : { transcript: action.transcript }),
            }
          : call),
        slots,
        timeline: [
          ...loop.timeline,
          {
            ...timelineEvent(
              compliantSlot === undefined ? 'center_attempt' : 'slot_found',
              compliantSlot === undefined
                ? `Center ${action.centerId} completed without a compliant slot`
                : `Compliant slot found at ${compliantSlot.centerId}: ${compliantSlot.slotISO}`,
            ),
            callRef: action.callId,
          },
        ],
        updatedAt: now,
      };
    }
    case 'PATIENT_CALL_STARTED':
      return {
        ...loop,
        state: 'PATIENT_CALLING',
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, 'PATIENT_CALLING', 'in-progress', now) },
        calls: [
          ...loop.calls,
          {
            id: action.callId,
            idempotencyKey: action.idempotencyKey,
            target: 'patient',
            status: 'accepted',
            startedAt: now,
          },
        ],
        timeline: [
          ...loop.timeline,
          { ...timelineEvent('patient_call_started', 'Calling patient'), callRef: action.callId },
        ],
        updatedAt: now,
      };
    case 'PATIENT_CALL_COMPLETED': {
      const state = loop.state === 'PATIENT_CALLING' && action.acceptedSlotId !== undefined
        ? 'PATIENT_CONFIRMED'
        : loop.state;
      const taskStatus = state === loop.state ? loop.fhir.task.status : 'in-progress';
      const escalation = action.clinicalQuestion
        ? {
            id: randomUUID(),
            ts: now,
            reason: 'clinical_question' as const,
            context: `Patient raised a clinical question during call ${action.callId}`,
          }
        : undefined;
      return {
        ...loop,
        state,
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, state, taskStatus, now) },
        calls: loop.calls.map((call) => call.id === action.callId
          ? {
              ...call, status: 'completed', reached: action.reached, endedAt: now,
              ...(action.transcript === undefined ? {} : { transcript: action.transcript }),
            }
          : call),
        escalations: escalation === undefined ? loop.escalations : [...loop.escalations, escalation],
        timeline: [
          ...loop.timeline,
          {
            ...timelineEvent(
              action.acceptedSlotId === undefined ? 'patient_attempt' : 'patient_confirmed',
              action.acceptedSlotId === undefined
                ? `Patient call completed without confirmation${action.declined ? ' (declined)' : ''}`
                : `Patient confirmed slot ${action.acceptedSlotId}`,
            ),
            callRef: action.callId,
          },
        ],
        updatedAt: now,
      };
    }
    case 'SMS_SENT':
      return {
        ...loop,
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, loop.state, loop.fhir.task.status, now) },
        timeline: [...loop.timeline, timelineEvent('sms_sent', `SMS ${action.messageId} sent for slot ${action.slotId}`)],
        updatedAt: now,
      };
    case 'INBOUND_ARMED':
      return {
        ...loop,
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, loop.state, loop.fhir.task.status, now) },
        timeline: [...loop.timeline, timelineEvent('inbound_armed', `Inbound expectation ${action.expectationId} armed`)],
        updatedAt: now,
      };
    case 'CALL_LINKED':
      return {
        ...loop,
        calls: loop.calls.map((call) => call.id === action.callId
          ? { ...call, externalCallId: action.externalCallId }
          : call),
        updatedAt: now,
      };
    case 'TIMELINE_NOTE':
      return {
        ...loop,
        timeline: [
          ...loop.timeline,
          {
            ...timelineEvent(action.noteType, action.summary),
            ...(action.reasoning === undefined ? {} : { reasoning: action.reasoning }),
          },
        ],
        updatedAt: now,
      };
    case 'ATTACH_ENCOUNTER':
      return {
        ...loop,
        encounter: action.encounter,
        timeline: [
          ...loop.timeline,
          timelineEvent(
            'encounter_attached',
            `Ambient encounter attached${action.encounter.title === undefined ? '' : `: ${action.encounter.title}`}`,
          ),
        ],
        updatedAt: now,
      };
    case 'SCHEDULED': {
      const slot = loop.slots.find(({ id }) => id === action.slotId);
      if (slot === undefined) throw new Error(`reduce: cannot schedule unknown slot ${action.slotId}`);
      return {
        ...loop,
        state: 'SCHEDULED',
        fhir: {
          ...loop.fhir,
          task: withTask(loop.fhir.task, 'SCHEDULED', 'completed', now),
          appointment: {
            resourceType: 'Appointment',
            id: `appointment-${loop.id}`,
            status: 'booked',
            start: slot.slotISO,
          },
        },
        timeline: [...loop.timeline, timelineEvent('scheduled', `Appointment scheduled with ${action.centerId} for ${slot.slotISO}`)],
        updatedAt: now,
      };
    }
    case 'ESCALATED': {
      const escalation = { id: randomUUID(), ts: now, reason: action.reason, context: action.context };
      return {
        ...loop,
        state: 'ESCALATED',
        fhir: { ...loop.fhir, task: withTask(loop.fhir.task, 'ESCALATED', 'on-hold', now) },
        escalations: [...loop.escalations, escalation],
        timeline: [...loop.timeline, timelineEvent('escalated', `Escalated: ${action.reason}`)],
        updatedAt: now,
      };
    }
    default:
      throw new Error(`reduce: ${(action as { type: string }).type} is unknown`);
  }
}
