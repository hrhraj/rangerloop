import { Fragment, useEffect, useRef, useState } from 'react';
import {
  getLoops, getLoop, getEscalations, getConfig,
  createLoopFromOrder, createLoopFromEncounter, getSampleEncounter, DEFAULT_ORDER_TEXT,
  type Loop, type LoopSummary, type EscalationRow, type ConfigCenter,
} from './api';
import { LoopDetail } from './LoopDetail';
import { EscalationQueue } from './EscalationQueue';
import { StateChip, fmtDate } from './ui';

const POLL_MS = 2000;

function usePoll<T>(fn: () => Promise<T>, enabled: boolean, key: string): T | null {
  const [data, setData] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = () => {
      fnRef.current().then((d) => { if (alive) setData(d); }).catch(() => { /* keep last */ });
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [enabled, key]);
  return data;
}

type View = 'loops' | 'escalations';
type Creating = 'order' | 'encounter' | null;

export function App() {
  const [view, setView] = useState<View>('loops');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<Creating>(null);
  const [centers, setCenters] = useState<ConfigCenter[]>([]);

  useEffect(() => { getConfig().then((c) => setCenters(c.centers)).catch(() => {}); }, []);

  const loops = usePoll<LoopSummary[]>(getLoops, true, 'loops') ?? [];
  const selected = usePoll<Loop>(
    () => getLoop(selectedId as string),
    view === 'loops' && selectedId !== null,
    `loop:${selectedId ?? ''}`,
  );
  const escalations = usePoll<EscalationRow[]>(getEscalations, view === 'escalations', 'esc') ?? [];

  useEffect(() => {
    if (selectedId === null && loops.length > 0) setSelectedId(loops[0]!.id);
  }, [loops, selectedId]);

  const escalationCount = loops.reduce((n, l) => n + l.escalationCount, 0);

  async function startOrder() {
    setCreating('order');
    try {
      const r = await createLoopFromOrder(DEFAULT_ORDER_TEXT);
      setView('loops'); setSelectedId(r.loopId);
    } catch { /* ignore */ } finally { setCreating(null); }
  }
  async function startEncounter() {
    setCreating('encounter');
    try {
      const enc = await getSampleEncounter();
      const r = await createLoopFromEncounter(enc);
      setView('loops'); setSelectedId(r.loopId);
    } catch { /* ignore */ } finally { setCreating(null); }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="wordmark">RangerLoop</span>
          <span className="tagline">Closed-loop care execution</span>
        </div>
        <nav className="nav">
          <button className={view === 'loops' ? 'active' : ''} onClick={() => setView('loops')}>
            Loops <span className="count">{loops.length}</span>
          </button>
          <button className={view === 'escalations' ? 'active' : ''} onClick={() => setView('escalations')}>
            Escalations <span className="count">{escalationCount}</span>
          </button>
        </nav>
        <div className="actions">
          <button className="btn primary" title="Start a loop from a signed imaging order document — RangerLoop extracts the order + due date and runs it" disabled={creating !== null} onClick={startOrder}>
            {creating === 'order' ? 'Starting…' : '＋ Imaging order'}
          </button>
          <button className="btn" title="Start a loop from an ambient doctor–patient encounter (Abridge synthetic-FHIR) — the order is spoken in the transcript" disabled={creating !== null} onClick={startEncounter}>
            {creating === 'encounter' ? 'Loading…' : 'Abridge encounter'}
          </button>
        </div>
      </header>

      {view === 'loops' ? (
        loops.length === 0 ? (
          <Hero onOrder={startOrder} onEncounter={startEncounter} creating={creating} />
        ) : (
          <main className="split">
            <aside className="board">
              {loops.map((l) => (
                <button
                  key={l.id}
                  className={`board-item ${l.id === selectedId ? 'selected' : ''}`}
                  onClick={() => setSelectedId(l.id)}
                >
                  <div className="board-item-top">
                    <StateChip state={l.state} />
                    {l.escalationCount > 0 && <span className="esc-dot" title="escalated" />}
                  </div>
                  <div className="board-item-name">{l.patientName ?? 'Unknown patient'}</div>
                  <div className="board-item-study">{l.study ?? '—'}</div>
                  <div className="board-item-meta">
                    due {fmtDate(l.dueDate)} · {l.centersTried} call(s) · {l.slotsFound} slot(s)
                  </div>
                </button>
              ))}
            </aside>
            <section className="detail">
              {selected ? <LoopDetail loop={selected} centers={centers} /> : <div className="empty">Select a loop.</div>}
            </section>
          </main>
        )
      ) : (
        <main className="single">
          <EscalationQueue
            rows={escalations}
            onOpen={(id) => { setSelectedId(id); setView('loops'); }}
          />
        </main>
      )}
    </div>
  );
}

function Hero({ onOrder, onEncounter, creating }: {
  onOrder: () => void;
  onEncounter: () => void;
  creating: Creating;
}) {
  const stages = ['Ordered', 'Extracted', 'Call centers', 'Compliant slot', 'Call patient', 'Scheduled'];
  return (
    <div className="hero">
      <div className="hero-inner">
        <div className="hero-kicker">CLOSED-LOOP CARE EXECUTION</div>
        <h1 className="hero-title">Every other agent summarizes. RangerLoop does the job.</h1>
        <p className="hero-sub">
          From a signed imaging order to a booked appointment — extracted with evidence, called
          through, guardrailed, and tracked ORDERED → SCHEDULED. Claude decides each next step; a
          deterministic policy layer decides whether it's allowed.
        </p>
        <div className="hero-pipeline">
          {stages.map((s, i) => (
            <Fragment key={s}>
              <span className="hp-stage"><span className="hp-dot" />{s}</span>
              {i < stages.length - 1 && <span className="hp-arrow">→</span>}
            </Fragment>
          ))}
        </div>
        <div className="hero-cta">
          <button className="btn primary lg" title="A signed imaging order document — RangerLoop extracts the order + due date and runs the loop" disabled={creating !== null} onClick={onOrder}>
            {creating === 'order' ? 'Starting…' : '＋ Start from an imaging order'}
          </button>
          <button className="btn lg" title="An ambient doctor–patient encounter (Abridge synthetic-FHIR) — the order is spoken in the transcript, extracted with the clinician's line as evidence" disabled={creating !== null} onClick={onEncounter}>
            {creating === 'encounter' ? 'Loading…' : 'Start from an Abridge encounter'}
          </button>
        </div>
        <div className="hero-note">Each click runs the whole loop end-to-end. The patient is reached by a real voice call. Imaging-center calls are simulated. An SMS confirmation is sent once complete.</div>
      </div>
    </div>
  );
}
