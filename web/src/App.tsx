import { useEffect, useRef, useState } from 'react';
import {
  getLoops, getLoop, getEscalations,
  type Loop, type LoopSummary, type EscalationRow,
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

export function App() {
  const [view, setView] = useState<View>('loops');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        <div className="live"><span className="dot" /> live · 2s</div>
      </header>

      {view === 'loops' ? (
        <main className="split">
          <aside className="board">
            {loops.length === 0 && <div className="empty">No loops yet. POST an order to <code>/api/loops</code>.</div>}
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
            {selected ? <LoopDetail loop={selected} /> : <div className="empty">Select a loop.</div>}
          </section>
        </main>
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
