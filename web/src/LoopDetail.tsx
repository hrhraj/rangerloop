import { useState } from 'react';
import { cancelLoop, type Loop, type ConfigCenter } from './api';
import { STAGE_ORDER, STATE_LABEL, StateChip, fmtDate, fmtTime, fmtSlot, humanize } from './ui';

type Tab = 'timeline' | 'transcripts' | 'evidence' | 'fhir';

const ESC_LABEL: Record<string, string> = {
  operator_cancelled: 'cancelled by operator',
  patient_unreachable: 'patient unreachable',
  centers_exhausted: 'no compliant slot (centers exhausted)',
  patient_declined: 'patient declined',
  due_date_breach: 'past the due date',
  extraction_ambiguity: 'needs review',
  clinical_question: 'clinical question raised',
};

function escalationText(esc: { reason: string; context: string }): string {
  const label = ESC_LABEL[esc.reason] ?? esc.reason.replace(/_/g, ' ');
  const ctx = (esc.context ?? '').trim();
  const redundant = ctx === ''
    || ctx.toLowerCase() === label.toLowerCase()
    || label.toLowerCase().includes(ctx.toLowerCase())
    || ctx.toLowerCase().includes(label.toLowerCase());
  return redundant ? label : `${label} — ${ctx}`;
}

export function LoopDetail({ loop, centers }: { loop: Loop; centers: ConfigCenter[] }) {
  const [tab, setTab] = useState<Tab>('timeline');
  const [stopping, setStopping] = useState(false);
  const order = loop.order;
  const terminal = loop.state === 'SCHEDULED' || loop.state === 'ESCALATED';

  async function stop() {
    setStopping(true);
    try { await cancelLoop(loop.id); } catch { /* ignore */ } finally { setStopping(false); }
  }

  return (
    <div className="loop">
      <div className="loop-head">
        <div>
          <h2>{order?.patient.name ?? 'Unknown patient'}</h2>
          <div className="loop-sub">
            {order?.study.type ?? 'Imaging order'} · due {fmtDate(order?.urgency.due_date ?? null)}
          </div>
        </div>
        <div className="loop-head-actions">
          {!terminal && (
            <button className="btn danger sm" disabled={stopping} onClick={stop}>
              {stopping ? 'Stopping…' : 'Stop'}
            </button>
          )}
          <StateChip state={loop.state} />
        </div>
      </div>

      <Stepper loop={loop} />
      <CampaignPanel loop={loop} centers={centers} />

      <div className="tabs">
        {(['timeline', 'transcripts', 'evidence', 'fhir'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'timeline' ? 'Timeline' : t === 'transcripts' ? 'Transcripts' : t === 'evidence' ? 'Evidence' : 'FHIR'}
          </button>
        ))}
      </div>

      {tab === 'timeline' && <TimelineTab loop={loop} centers={centers} />}
      {tab === 'transcripts' && <TranscriptsTab loop={loop} centers={centers} />}
      {tab === 'evidence' && <EvidenceTab loop={loop} />}
      {tab === 'fhir' && <FhirTab loop={loop} />}
    </div>
  );
}

function Stepper({ loop }: { loop: Loop }) {
  const idx = STAGE_ORDER.indexOf(loop.state);
  const off = idx === -1;
  return (
    <div className="stepper">
      {STAGE_ORDER.map((s, i) => {
        const done = !off && i < idx;
        const current = !off && i === idx;
        return (
          <div key={s} className={`step ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
            <span className="step-dot" />
            <span className="step-label">{STATE_LABEL[s]}</span>
          </div>
        );
      })}
    </div>
  );
}

function CampaignPanel({ loop, centers }: { loop: Loop; centers: ConfigCenter[] }) {
  if (centers.length === 0) return null;
  const compliantFound = loop.slots.some((s) => s.compliant);
  const phaseOver = ['SLOT_FOUND', 'PATIENT_CALLING', 'PATIENT_CONFIRMED', 'SCHEDULED'].includes(loop.state);

  return (
    <div className="campaign">
      <div className="campaign-title">
        Imaging-center campaign <span className="campaign-sub">· the agent works these one at a time</span>
      </div>
      <div className="campaign-grid">
        {centers.map((c) => {
          const call = loop.calls.find((k) => k.target === 'center' && k.centerId === c.id);
          const slot = loop.slots.find((s) => s.centerId === c.id);
          const active = call !== undefined && call.status !== 'completed' && call.status !== 'failed';

          let label = 'Queued';
          let tone = 'neutral';
          let slotText: string | null = null;
          let struck = false;

          if (call === undefined) {
            if (phaseOver && compliantFound) { label = 'Not needed'; tone = 'muted'; }
          } else if (active) {
            label = 'On call'; tone = 'active';
          } else if (call.reached === 'no_answer') {
            label = 'No answer'; tone = 'bad';
          } else if (call.reached === 'voicemail') {
            label = 'Voicemail'; tone = 'bad';
          } else if (call.reached === 'ivr_deadend') {
            label = 'IVR dead-end'; tone = 'bad';
          } else if (slot?.compliant) {
            // The center holds a compliant slot; it's only truly "booked" once the
            // patient confirms and the loop reaches SCHEDULED.
            label = loop.state === 'SCHEDULED' ? 'Booked ✓' : 'Slot held'; tone = 'good'; slotText = fmtSlot(slot.slotISO);
          } else if (slot && !slot.compliant) {
            label = 'Too late'; tone = 'warn'; slotText = fmtSlot(slot.slotISO); struck = true;
          } else {
            label = 'No slot'; tone = 'muted';
          }

          return (
            <div key={c.id} className={`cc ${active ? 'cc-active' : ''}`}>
              <div className="cc-name">{c.name}</div>
              <span className={`chip tone-${tone}`}>{label}</span>
              {slotText && <div className={`cc-slot ${struck ? 'struck' : ''}`}>{slotText}{struck ? ' · after due date' : ''}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TranscriptsTab({ loop, centers }: { loop: Loop; centers: ConfigCenter[] }) {
  const has = loop.calls.some((c) => c.transcript && c.transcript.length > 0);
  return (
    <div className="tab-body">
      {has
        ? <ConversationPanel loop={loop} centers={centers} />
        : <div className="empty">No call transcripts yet. (Live patient calls happen by voice, not text.)</div>}
    </div>
  );
}

function ConversationPanel({ loop, centers }: { loop: Loop; centers: ConfigCenter[] }) {
  const calls = loop.calls.filter((c) => c.transcript && c.transcript.length > 0);
  if (calls.length === 0) return null;
  return (
    <div className="conv">
      <div className="conv-head">📞 Call transcripts</div>
      <div className="conv-log">
        {calls.map((call) => {
          const who = call.target === 'patient'
            ? 'Patient'
            : (centers.find((c) => c.id === call.centerId)?.name ?? 'Imaging center');
          return (
            <div className="conv-call" key={call.id}>
              <div className="conv-call-who">{who}</div>
              {call.transcript!.map((t, i) => {
                const kind = /agent/i.test(t.speaker) ? 'agent' : /system/i.test(t.speaker) ? 'system' : 'other';
                // reveal at ~speaking pace so it reads like a live call, not a data dump
                return (
                  <div key={i} className={`conv-turn ${kind}`} style={{ animationDelay: `${i * 1.5}s` }}>
                    <span className="conv-speaker">{t.speaker}</span>
                    <span className="conv-text">{t.text}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentContext({ loop }: { loop: Loop }) {
  const centerAttempts = loop.calls.filter((c) => c.target === 'center').length;
  const patientAttempts = loop.calls.filter((c) => c.target === 'patient').length;
  const sr = loop.fhir.serviceRequest as { id?: string } | null;
  const task = loop.fhir.task as { businessStatus?: string } | null;
  return (
    <div className="context">
      <div className="context-title">🧠 Agent context <span className="context-sub">carried across every step</span></div>
      <div className="context-grid">
        <div><span className="ck">Order</span><span className="cv">{loop.order?.study.type ?? '—'} · due {fmtDate(loop.order?.urgency.due_date ?? null)}</span></div>
        <div><span className="ck">Linked FHIR</span><span className="cv">ServiceRequest {sr?.id ?? '—'} → Task {task?.businessStatus ?? loop.state}</span></div>
        <div><span className="ck">Patient</span><span className="cv">{loop.order?.patient.name ?? '—'} · DOB {loop.order?.patient.dob ?? '—'}</span></div>
        <div><span className="ck">Attempts</span><span className="cv">{centerAttempts} center · {patientAttempts} patient</span></div>
        <div><span className="ck">Source</span><span className="cv">{loop.encounter ? 'Abridge ambient encounter' : 'Signed imaging order'}</span></div>
      </div>
    </div>
  );
}

function GuardrailPanel({ loop }: { loop: Loop }) {
  const guarded = loop.calls.filter((c) => c.guardrail);
  const violations = guarded.flatMap((c) => (c.guardrail?.violations ?? []).map((v) => ({ target: c.target, v })));
  const rejections = loop.timeline.filter((e) => e.type === 'policy_rejected');
  const clean = violations.length === 0;
  return (
    <div className={`guardrail ${clean ? 'ok' : 'bad'}`}>
      <div className="guardrail-title">
        <span className="shield">{clean ? '🛡' : '⚠'}</span> Safety &amp; policy
      </div>
      <p className="guardrail-note">
        Patient calls run under the <code>healthcare_scheduling</code> guardrail — results, findings,
        and diagnosis are never disclosed. Calls are sequential; the patient is never called before a
        compliant slot exists.
      </p>
      {rejections.length > 0 && (
        <div className="guardrail-list">
          {rejections.map((r) => (
            <div key={r.id} className="guardrail-row warn">⛔ Policy blocked an action — {r.summary}</div>
          ))}
        </div>
      )}
      {violations.length > 0 ? (
        <div className="guardrail-list">
          {violations.map(({ target, v }, i) => (
            <div key={i} className="guardrail-row bad">Guardrail violation on {target} call: {v}</div>
          ))}
        </div>
      ) : (
        <div className="guardrail-row ok">No guardrail violations across {loop.calls.length} call(s).</div>
      )}
    </div>
  );
}

function TimelineTab({ loop, centers }: { loop: Loop; centers: ConfigCenter[] }) {
  const events = [...loop.timeline].reverse();
  const lastEsc = loop.escalations[loop.escalations.length - 1];
  return (
    <div className="tab-body">
      <AgentContext loop={loop} />
      <GuardrailPanel loop={loop} />
      {loop.state === 'ESCALATED' && lastEsc && (
        <div className="banner bad">
          Escalated — {escalationText(lastEsc)}
        </div>
      )}
      <ol className="timeline">
        {events.length === 0 && <li className="empty">No activity yet.</li>}
        {events.map((e) => {
          if (e.type === 'reasoning' && e.reasoning) {
            return (
              <li key={e.id} className="tl reasoning">
                <div className="tl-time">{fmtTime(e.ts)}</div>
                <div className="reasoning-card">
                  <div className="reasoning-head">✳ Claude reasoning</div>
                  <div className="reasoning-body">{humanize(e.reasoning, centers)}</div>
                </div>
              </li>
            );
          }
          if (e.type === 'policy_rejected') {
            return (
              <li key={e.id} className="tl policy">
                <div className="tl-time">{fmtTime(e.ts)}</div>
                <div className="policy-card">⛔ Policy blocked: {humanize(e.summary, centers)}</div>
              </li>
            );
          }
          return (
            <li key={e.id} className="tl">
              <div className="tl-time">{fmtTime(e.ts)}</div>
              <div className="tl-main">
                <div className="tl-summary">{e.type === 'sms_sent' ? 'Confirmation SMS sent to the patient' : humanize(e.summary, centers)}</div>
                {e.evidenceRef && (
                  <div className="tl-evidence">
                    “{e.evidenceRef.quote}” <span className="loc">— {e.evidenceRef.location}</span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EvidenceTab({ loop }: { loop: Loop }) {
  const order = loop.order;
  if (!order) return <div className="tab-body"><div className="empty">No extraction yet.</div></div>;
  return (
    <div className="tab-body">
      <div className="facts">
        <Fact label="Study" value={order.study.type + (order.study.laterality ? ` (${order.study.laterality})` : '')} />
        <Fact label="Due date" value={fmtDate(order.urgency.due_date)} />
        <Fact label="Window" value={order.urgency.window_days ? `${order.urgency.window_days} days` : '—'} />
        <Fact label="Patient" value={order.patient.name} />
        <Fact label="DOB" value={order.patient.dob ?? '—'} />
        <Fact label="Phone" value={order.patient.phone ?? '—'} />
        <Fact label="Provider" value={order.ordering_provider.name} />
        <Fact label="Reason" value={order.study.reason_code ?? '—'} />
      </div>

      {loop.encounter?.transcript && loop.encounter.transcript.length > 0 && (
        <div className="transcript-block">
          <div className="section-title">
            Ambient encounter transcript
            {loop.encounter.title ? ` — ${loop.encounter.title}` : ''}
          </div>
          <div className="transcript">
            {loop.encounter.transcript.map((t, i) => {
              const isDr = /^(d|dr|clin|prov|phys)/i.test(t.speaker.trim());
              return (
                <div key={i} className={`turn ${t.isEvidence ? 'evidence' : ''}`}>
                  <span className={`speaker ${isDr ? 'dr' : 'pt'}`}>{isDr ? 'DR' : 'PT'}</span>
                  <span className="turn-text">{t.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="section-title">Evidence links</div>
      <div className="evidence-cards">
        {order.evidence_links.length === 0 && <div className="empty">No evidence links.</div>}
        {order.evidence_links.map((ev, i) => {
          const key = ev.field.startsWith('urgency') || ev.field.includes('due') || ev.field.includes('date');
          return (
            <div key={i} className={`evidence-card ${key ? 'key' : ''}`}>
              <div className="ev-field">{ev.field}{key ? ' · drives the deadline' : ''}</div>
              <div className="ev-quote">“{ev.quote}”</div>
              <div className="ev-loc">{ev.location}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{value}</div>
    </div>
  );
}

function FhirTab({ loop }: { loop: Loop }) {
  const resources: [string, unknown][] = [
    ['ServiceRequest', loop.fhir.serviceRequest],
    ['Patient', loop.fhir.patient],
    ['Task', loop.fhir.task],
    ['Appointment', loop.fhir.appointment],
  ];
  return (
    <div className="tab-body">
      <p className="fhir-note">FHIR R4 resources — the loop's state is native EHR data, ready to write back to Epic / Oracle Health.</p>
      {resources.map(([name, res]) => (
        <div key={name} className="fhir-card">
          <div className="fhir-name">{name}</div>
          {res ? <pre>{JSON.stringify(res, null, 2)}</pre> : <div className="empty">not yet created</div>}
        </div>
      ))}
    </div>
  );
}
