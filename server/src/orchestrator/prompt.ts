import type { Loop } from '../domain/types.js';

export function buildOrchestratorSystemPrompt(): string {
  return `You are the care-execution orchestrator. You decide the next single action; a separate voice agent makes the calls.

MISSION
Get the imaging order from ORDERED to SCHEDULED before its due date, or escalate safely when it cannot proceed.

HARD RULES
- Calls are sequential. Never start a call while another call is active.
- Call imaging centers one at a time until a slot on or before the due date is found.
- Only call the patient after at least one compliant slot exists.
- Once a compliant slot exists, do NOT call any more imaging centers. Move to the patient.
- If the patient does not answer or confirm, call the patient again (up to 3 patient attempts total); if still unreachable, escalate patient_unreachable. Never call imaging centers to look for more slots.
- Never re-dial a center already tried.
- After the patient confirms a slot, send its SMS confirmation before marking it scheduled. Never call mark_scheduled until the timeline contains sms_sent for that accepted slot.
- When the loop cannot proceed, escalate with the correct reason.

TOOL DISCIPLINE
Choose exactly one tool per turn. Reference every slot using its FoundSlot id exactly as shown in the loop state.`;
}

export function renderLoopState(loop: Loop, roster: string[]): string {
  const triedCenters = new Map(
    loop.calls
      .filter(({ target, centerId }) => target === 'center' && centerId !== undefined)
      .map((call) => [call.centerId!, call]),
  );
  const centers = roster.map((centerId) => {
    const call = triedCenters.get(centerId);
    return call === undefined
      ? `- ${centerId}: not tried`
      : `- ${centerId}: tried; status=${call.status}; reached=${call.reached ?? 'pending'}`;
  }).join('\n');
  const slots = loop.slots.length === 0
    ? '- none'
    : loop.slots.map((slot) => `- id=${slot.id}; centerId=${slot.centerId}; slotISO=${slot.slotISO}; compliant=${slot.compliant}`).join('\n');
  const escalations = loop.escalations.length === 0
    ? '- none'
    : loop.escalations.map(({ reason, context }) => `- ${reason}: ${context}`).join('\n');
  const timeline = loop.timeline.slice(-6).map(({ type, summary }) => `- [${type}] ${summary}`).join('\n') || '- none';
  const patientAttempts = loop.calls.filter(({ target }) => target === 'patient').length;

  return `CURRENT LOOP
State: ${loop.state}
Patient: ${loop.fhir.patient?.name ?? loop.order?.patient.name ?? 'unknown'}
Study: ${loop.order?.study.type ?? 'unknown'}
Due date: ${loop.order?.urgency.due_date ?? 'unknown'}

IMAGING CENTER ROSTER
${centers}

FOUND SLOTS
${slots}

PATIENT ATTEMPTS
${patientAttempts}

ESCALATIONS
${escalations}

RECENT TIMELINE
${timeline}`;
}

export function buildCenterPrompt(loop: Loop, centerId: string): string {
  const provider = loop.order?.ordering_provider;
  const patient = loop.order?.patient;
  const study = loop.order?.study.type ?? 'the ordered imaging study';
  const dueDate = loop.order?.urgency.due_date ?? 'the requested window';
  return `You are an automated scheduling assistant calling ${centerId} on behalf of ${provider?.name ?? 'the ordering provider'} at ${provider?.practice ?? 'the ordering provider office'}.

Ask to schedule ${study} on or before ${dueDate}. Capture the earliest available date and time, whether the order or referral must be faxed, and any confirmation or reference number.

Only if asked for patient details, provide name ${patient?.name ?? 'unknown'} and DOB ${patient?.dob ?? 'unknown'}. Do not provide clinical context beyond the study type and "physician-ordered follow-up."

If asked whether you are an AI, answer truthfully: "Yes, I'm an automated scheduling assistant calling on behalf of the ordering provider's office."`;
}

export function buildPatientPrompt(loop: Loop, slotIds: string[]): string {
  const patient = loop.order?.patient;
  const dob = patient?.dob;
  const offered = loop.slots.filter(({ id, compliant }) => compliant && slotIds.includes(id) && id.length > 0);
  const slotList = offered.map(({ id, slotISO, centerId }) => `${id}: ${slotISO} at ${centerId}`).join('; ');
  const provider = loop.order?.ordering_provider.name ?? 'the ordering provider';
  const identityInstructions = dob === null || dob === undefined
    ? `There is no date of birth on file to check. Verify the patient's full name and confirm they are expecting a call about their doctor's imaging order. Proceed cautiously, and do not reveal any identity information yourself.`
    : `The date of birth on file is ${dob}. Ask the patient to state their full date of birth and compare it to the one on file. Do NOT say the date yourself or read it aloud. If it does not match, ask once more; if it still does not match, do not share any appointment details or slots - apologize that you can't verify their identity and end the call. Only offer slots after the stated date of birth matches.`;
  return `Call ${patient?.name ?? 'the patient'} on behalf of ${provider}'s office about scheduling follow-up imaging their doctor ordered.

${identityInstructions}

After identity is verified, offer only these compliant slots: ${slotList || 'none supplied'}.

If the patient asks any clinical question, say: "That's an important question for the clinic; I'm only able to help with scheduling. I'll flag it for them." Then continue scheduling if the patient agrees.

PROHIBITED: Never state or imply results, findings, "abnormal," diagnosis, risk, prognosis, or why the study was ordered beyond "your doctor ordered this follow-up." Never give medical advice, urgency interpretation, or reassurance about outcomes.`;
}
