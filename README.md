# RangerLoop
A closed-loop care-execution agent: a clinician's signed imaging order -> extract the action + due
date (evidence-linked) -> call imaging centers for a compliant slot -> call the patient to confirm &
book (guardrailed, never discloses results) -> track ORDERED -> SCHEDULED -> escalate safely on failure.
> Every other agent summarizes or suggests. RangerLoop does the job.
Built at the Abridge x Anthropic x Lightspeed healthcare hackathon (2026-07-18).
## Built today (in this repo)
Order/encounter extraction with evidence links, the loop state machine, the Claude tool-use
orchestrator (reasoning rendered live on the dashboard), the deterministic policy/safety layer,
healthcare guardrails, two-level escalation, and the real-time dashboard.
## Pre-existing infrastructure (disclosed, not in this repo)
The AskRanger voice/telephony stack (placing/answering calls, IVR navigation, the live voice agent,
structured field capture, event webhooks) is pre-existing, consumed over an HTTPS API only. None of
its code is in this repository.
## Architecture
- Claude is the visible orchestrator (tool-use): sees loop state + tools [call_imaging_center,
  call_patient, escalate_to_human], decides each next action; reasoning shown live.
- Thin deterministic policy underneath validates each choice: sequential calls, escalation triggers,
  no patient call before a compliant slot, no duplicate dials. Agent decides WHAT, policy decides WHETHER.
- FHIR-shaped records (ServiceRequest / Patient / Task / Appointment).
- Real-time React dashboard: Loop Board, Loop Detail (timeline + evidence + Claude reasoning + guardrail
  panel + FHIR), Escalation Queue.
