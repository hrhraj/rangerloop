# RangerLoop

A closed-loop care-execution agent: a clinician's signed imaging order (or an ambient clinical
encounter) → extract the action + due date (evidence-linked) → call imaging centers for a compliant
slot → call the patient to confirm & book (guardrailed, never discloses results) → track
ORDERED → SCHEDULED → escalate safely on failure.

> Every other agent summarizes or suggests. RangerLoop does the job.

**Live demo:** https://rangerloop-api.fly.dev — click **"＋ Imaging order"** or **"Abridge encounter"**
and watch a full loop run. The hosted demo runs in simulation mode, so it's phone-free and safe to click.

Built at the Abridge × Anthropic × Lightspeed healthcare hackathon (2026-07-18).

## Built today (in this repo)
- **Evidence-linked extraction** from a signed order **or** an Abridge ambient-FHIR encounter — every
  action-driving field (study, due date, phone) is tied to an exact quote; for encounters, the quote is
  the clinician's spoken transcript line.
- The **loop state machine** — a forward-only reducer that is the single writer of all state, timeline,
  slots, and escalations.
- The **Claude tool-use orchestrator** — decides each next action; its reasoning renders live on the dashboard.
- The **deterministic policy / safety layer** (calls are sequential, no patient call before a compliant
  slot, no re-dialing a found center, mandatory escalation) and **healthcare guardrails** (never disclose
  results / findings / diagnosis; verify patient identity by date of birth).
- The **real-time dashboard**: loop board, imaging-center campaign view, per-call conversation, Claude
  reasoning cards, evidence, FHIR resources, escalation queue, and an operator **Stop**.

## Pre-existing infrastructure (disclosed, not in this repo)
The AskRanger voice/telephony stack (placing/answering calls, IVR navigation, the live voice agent,
structured field capture, event webhooks) is pre-existing, consumed over an HTTPS API only. None of its
code is in this repository.

## Architecture
- **Claude is the visible orchestrator** (tool-use): it sees the loop state + tools
  [call_imaging_center, call_patient, send_sms_confirmation, escalate_to_human, mark_scheduled] and
  decides each next action; its reasoning is streamed to the dashboard.
- A **thin deterministic policy** underneath validates every choice. **The agent decides WHAT, the
  policy decides WHETHER.**
- **FHIR-shaped records** (ServiceRequest / Patient / Task / Appointment) — the loop's state is native
  EHR data, ready to write back to Epic / Oracle Health.
- **Real-time React dashboard** polling the backend every 2s.
- Stack: TypeScript · Node + Fastify · React + Vite · Claude Opus 4.8 (adaptive thinking + tool use).

## Run it locally
Requires Node 22+ and an `ANTHROPIC_API_KEY` (extraction and the orchestrator use Claude).

```
npm install
npm run build
ANTHROPIC_API_KEY=sk-... ASKRANGER_MODE=mock node server/dist/index.js
```

Open http://localhost:8080 and click **"＋ Imaging order"**. `ASKRANGER_MODE=mock` simulates the calls
(phone-free, deterministic); set `ASKRANGER_MODE=live` with the AskRanger API credentials to place real
calls through the disclosed voice stack.
