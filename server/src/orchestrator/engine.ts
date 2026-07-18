import { randomUUID } from 'node:crypto';
import type { AskRangerClient, CallOutcome } from '../askranger/types.js';
import { interpretCenterOutcome, interpretPatientOutcome } from '../domain/clinical.js';
import { reduce } from '../domain/reducer.js';
import type { EscalationReason, Loop } from '../domain/types.js';
import type { OrchestratorAction } from '../policy/actions.js';
import { checkMandatoryEscalation } from '../policy/escalation.js';
import { validateAction } from '../policy/validate.js';
import type { Decider } from './decider.js';

export interface OrchestratorDeps {
  client: AskRangerClient;
  decider: Decider;
  roster: string[];
  now: () => Date;
  callbackUrl: string;
  callerIdentity: { onBehalfOf: string; persona: string };
  guardrailProfile: string;
  buildCenterPrompt: (loop: Loop, centerId: string) => string;
  buildPatientPrompt: (loop: Loop, slotIds: string[]) => string;
  patientPhoneOverride?: string;
}

export type OrchestratorResult =
  | { status: 'awaiting_call'; callId: string }
  | { status: 'scheduled' }
  | { status: 'escalated'; reason: EscalationReason };

export interface OrchestratorStep {
  loop: Loop;
  result: OrchestratorResult;
}

export const CENTER_CAPTURE = {
  earliest_slot: 'datetime',
  fax_needed: 'bool',
  reference_number: 'string',
} as const;

export const PATIENT_CAPTURE = {
  identity_verified: 'bool',
  accepted_slot: 'datetime',
} as const;

const MAX_TURNS = 16;
const MAX_REJECTIONS = 3;

export function patientPhone(loop: Loop, deps: OrchestratorDeps): string {
  const phone = deps.patientPhoneOverride ?? loop.fhir.patient?.telecom?.[0]?.value;
  if (phone === undefined) throw new Error('orchestrator: patient phone is missing');
  return phone;
}

function escalationResult(loop: Loop, fallback: EscalationReason): OrchestratorResult {
  return { status: 'escalated', reason: loop.escalations.at(-1)?.reason ?? fallback };
}

export function deriveStuckReason(loop: Loop): EscalationReason {
  if (!loop.slots.some(({ compliant }) => compliant)) return 'centers_exhausted';
  if (loop.calls.some(({ target }) => target === 'patient')) return 'patient_unreachable';
  return 'extraction_ambiguity';
}

export function dueDateISO(loop: Loop): string {
  return loop.order?.urgency.due_date ?? '';
}

function escalate(loop: Loop, reason: EscalationReason, context: string): OrchestratorStep {
  const escalated = reduce(loop, { type: 'ESCALATED', reason, context });
  return { loop: escalated, result: { status: 'escalated', reason } };
}

async function executeAction(
  loop: Loop,
  action: OrchestratorAction,
  deps: OrchestratorDeps,
): Promise<OrchestratorStep | Loop> {
  switch (action.type) {
    case 'call_imaging_center': {
      const idempotencyKey = `${loop.id}:center:${action.centerId}`;
      const callId = `call_${randomUUID()}`;
      let started = reduce(loop, {
        type: 'CENTER_CALL_STARTED', centerId: action.centerId, callId, idempotencyKey,
      });
      const placed = await deps.client.placeCall({
        idempotencyKey,
        toPhone: action.centerId,
        callbackUrl: deps.callbackUrl,
        script: {
          systemPrompt: deps.buildCenterPrompt(started, action.centerId),
          captureSchema: CENTER_CAPTURE,
        },
        guardrailProfile: deps.guardrailProfile,
        calleeType: 'business',
        callerIdentity: deps.callerIdentity,
        metadata: { loopId: loop.id, callId, target: 'center', centerId: action.centerId },
      });
      started = reduce(started, { type: 'CALL_LINKED', callId, externalCallId: placed.callId });
      return { loop: started, result: { status: 'awaiting_call', callId } };
    }
    case 'call_patient': {
      const attempt = loop.calls.filter(({ target }) => target === 'patient').length + 1;
      const idempotencyKey = `${loop.id}:patient:${attempt}`;
      const callId = `call_${randomUUID()}`;
      let started = reduce(loop, { type: 'PATIENT_CALL_STARTED', callId, idempotencyKey });
      const placed = await deps.client.placeCall({
        idempotencyKey,
        toPhone: patientPhone(started, deps),
        callbackUrl: deps.callbackUrl,
        script: {
          systemPrompt: deps.buildPatientPrompt(started, action.slotIds),
          captureSchema: PATIENT_CAPTURE,
        },
        guardrailProfile: deps.guardrailProfile,
        calleeType: 'person',
        callerIdentity: deps.callerIdentity,
        metadata: { loopId: loop.id, callId, target: 'patient' },
      });
      started = reduce(started, { type: 'CALL_LINKED', callId, externalCallId: placed.callId });
      return { loop: started, result: { status: 'awaiting_call', callId } };
    }
    case 'send_sms_confirmation': {
      const sent = await deps.client.sendSms({
        idempotencyKey: `${loop.id}:sms:${action.slotId}`,
        toPhone: patientPhone(loop, deps),
        body: `Your appointment is confirmed for slot ${action.slotId}.`,
      });
      return reduce(loop, { type: 'SMS_SENT', messageId: sent.messageId, slotId: action.slotId });
    }
    case 'arm_inbound_callback': {
      const phone = patientPhone(loop, deps);
      const armed = await deps.client.armInboundExpect({
        idempotencyKey: `${loop.id}:inbound:${phone}`,
        fromPhone: phone,
        answerNumber: phone,
        ttlSeconds: 3_600,
        context: {
          systemPrompt: 'Resume the scheduling conversation with the prior context.',
          guardrailProfile: deps.guardrailProfile,
          state: { loopId: loop.id, loopState: loop.state },
        },
        callbackUrl: deps.callbackUrl,
      });
      return reduce(loop, { type: 'INBOUND_ARMED', expectationId: armed.expectationId });
    }
    case 'mark_scheduled': {
      const scheduled = reduce(loop, { type: 'SCHEDULED', centerId: action.centerId, slotId: action.slotId });
      return { loop: scheduled, result: { status: 'scheduled' } };
    }
    case 'escalate_to_human':
      return escalate(loop, action.reason, 'agent-initiated');
  }
}

export async function advance(loop: Loop, deps: OrchestratorDeps): Promise<OrchestratorStep> {
  let current = loop;

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const mandatoryReason = checkMandatoryEscalation(current, deps.roster, deps.now().toISOString());
    if (mandatoryReason !== null) return escalate(current, mandatoryReason, `mandatory: ${mandatoryReason}`);
    if (current.state === 'SCHEDULED') return { loop: current, result: { status: 'scheduled' } };
    if (current.state === 'ESCALATED') {
      return { loop: current, result: escalationResult(current, deriveStuckReason(current)) };
    }

    let rejection: string | undefined;
    let validatedAction: OrchestratorAction | undefined;
    for (let attempt = 0; attempt < MAX_REJECTIONS; attempt += 1) {
      const decision = await deps.decider.decide({
        loop: current,
        roster: deps.roster,
        ...(rejection === undefined ? {} : { rejection }),
      });
      if (decision.reasoning !== undefined) {
        current = reduce(current, {
          type: 'TIMELINE_NOTE', noteType: 'reasoning', summary: 'Claude reasoning', reasoning: decision.reasoning,
        });
      }
      const verdict = validateAction(current, decision.action, deps.roster);
      if (verdict.ok) {
        validatedAction = decision.action;
        break;
      }
      rejection = verdict.rejection;
      current = reduce(current, {
        type: 'TIMELINE_NOTE', noteType: 'policy_rejected', summary: verdict.rejection,
      });
    }

    if (validatedAction === undefined) {
      return escalate(current, deriveStuckReason(current), 'no legal action');
    }
    const executed = await executeAction(current, validatedAction, deps);
    if ('result' in executed) return executed;
    current = executed;
  }

  return escalate(current, deriveStuckReason(current), 'maximum turns exceeded');
}

export async function onCallOutcome(
  loop: Loop,
  callId: string,
  outcome: CallOutcome,
  deps: OrchestratorDeps,
): Promise<OrchestratorStep> {
  const call = loop.calls.find(({ id }) => id === callId);
  if (call === undefined) throw new Error(`orchestrator: unknown call ${callId}`);

  let current: Loop;
  if (call.target === 'center') {
    if (call.centerId === undefined) throw new Error(`orchestrator: center call ${callId} has no centerId`);
    const interpreted = interpretCenterOutcome(outcome, call.centerId, dueDateISO(loop));
    current = reduce(loop, {
      type: 'CENTER_CALL_COMPLETED',
      centerId: call.centerId,
      callId,
      reached: interpreted.reached,
      ...(interpreted.slot === undefined ? {} : { slot: interpreted.slot }),
    });
  } else {
    const interpreted = interpretPatientOutcome(outcome);
    current = reduce(loop, {
      type: 'PATIENT_CALL_COMPLETED',
      callId,
      reached: interpreted.reached,
      ...(interpreted.acceptedSlotId === undefined ? {} : { acceptedSlotId: interpreted.acceptedSlotId }),
      clinicalQuestion: interpreted.clinicalQuestion,
      declined: interpreted.declined,
    });
    if (interpreted.declined) return escalate(current, 'patient_declined', 'patient declined');
  }

  return await advance(current, deps);
}
