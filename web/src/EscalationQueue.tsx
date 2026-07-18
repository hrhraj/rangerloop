import type { EscalationRow } from './api';
import { fmtTime } from './ui';

export function EscalationQueue({ rows, onOpen }: {
  rows: EscalationRow[];
  onOpen: (loopId: string) => void;
}) {
  return (
    <div className="escalations">
      <h2>Escalation queue</h2>
      <p className="muted">Loops a human needs to act on — RangerLoop escalates safely rather than guessing.</p>
      {rows.length === 0 ? (
        <div className="empty">No escalations. Every loop is progressing on its own.</div>
      ) : (
        <table className="esc-table">
          <thead>
            <tr><th>Patient</th><th>Reason</th><th>Context</th><th>When</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.patientName ?? 'Unknown'}</td>
                <td><span className="chip tone-bad">{r.reason.replace(/_/g, ' ')}</span></td>
                <td className="ctx">{r.context}</td>
                <td>{fmtTime(r.ts)}</td>
                <td><button className="link" onClick={() => onOpen(r.loopId)}>open →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
