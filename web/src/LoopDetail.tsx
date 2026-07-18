import { useState } from 'react';
import type { Loop } from './api';
import { STAGE_ORDER, STATE_LABEL, StateChip, fmtDate, fmtTime } from './ui';

type Tab = 'timeline' | 'evidence' | 'fhir';

export function LoopDetail({ loop }: { loop: Loop }) {
  const [tab, setTab] = useState<Tab>('timeline');
  const order = loop.order;
  return (
    <div className="loop">
      <div className="loop-head">
        <div>
          <h2>{order?.patient.name ?? 'Unknown patient'}</h2>
          <div className="loop-sub">
            {order?.study.type ?? 'Imaging order'} · due {fmtDate(order?.urgency.due_date ?? null)}
          </div>
        </div>
        <StateChip state={loop.state} />
      </div>

      <Stepper loop={loop} />

      <div className="tabs">
        {(['timeline', 'evidence', 'fhir'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'timeline' ? 'Timeline' : t === 'evidence' ? 'Evidence' : 'FHIR'}
          </button>
        ))}
      </div>

      {tab === 'timeline' && <TimelineTab loop={loop} />}
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

function TimelineTab({ loop }: { loop: Loop }) {
  const events = [...loop.timeline].reverse();
  const lastEsc = loop.escalations[loop.escalations.length - 1];
  return (
    <div className="tab-body">
      <GuardrailPanel loop={loop} />
      {loop.state === 'ESCALATED' && lastEsc && (
        <div className="banner bad">
          Escalated — {lastEsc.reason.replace(/_/g, ' ')}: {lastEsc.context}
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
                  <div className="reasoning-body">{e.reasoning}</div>
                </div>
              </li>
            );
          }
          if (e.type === 'policy_rejected') {
            return (
              <li key={e.id} className="tl policy">
                <div className="tl-time">{fmtTime(e.ts)}</div>
                <div className="policy-card">⛔ Policy blocked: {e.summary}</div>
              </li>
            );
          }
          return (
            <li key={e.id} className="tl">
              <div className="tl-time">{fmtTime(e.ts)}</div>
              <div className="tl-main">
                <div className="tl-summary">{e.summary}</div>
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
