import React, { useEffect, useState } from 'react';
import { fetchRun } from '../api.js';

interface Run {
  id: string;
  sopName: string;
  eventSource: string;
  eventType: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  triggerEvent: unknown;
  result: unknown;
  error: string | null;
  tokensUsed: number | null;
  costUsd: string | null;
  durationMs: number | null;
  createdAt: string;
  completedAt: string | null;
}

interface Props {
  runId: string;
  onBack: () => void;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  queued:    { bg: '#fef3c7', color: '#92400e' },
  running:   { bg: '#dbeafe', color: '#1e40af' },
  completed: { bg: '#d1fae5', color: '#065f46' },
  failed:    { bg: '#fee2e2', color: '#991b1b' },
};

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={{ padding: '6px 12px', color: '#6b7280', fontSize: 13, width: 160, fontWeight: 500 }}>{label}</td>
      <td style={{ padding: '6px 12px', fontSize: 13 }}>{value}</td>
    </tr>
  );
}

export default function RunDetail({ runId, onBack }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRun(runId)
      .then((data: Run & { error?: string }) => {
        if ('error' in data && data.error && !data.id) {
          setError(data.error as string);
        } else {
          setRun(data as Run);
        }
      })
      .catch((e: unknown) => setError(String(e)));
  }, [runId]);

  return (
    <div>
      <button
        onClick={onBack}
        style={{ marginBottom: 16, padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', background: 'transparent' }}
      >
        ← Back
      </button>

      {error && <div style={{ color: '#991b1b', padding: 12, background: '#fee2e2', borderRadius: 8 }}>{error}</div>}

      {!run && !error && <div>Loading...</div>}

      {run && (
        <>
          <h2 style={{ marginTop: 0 }}>Run Detail</h2>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 24, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                <MetaRow label="ID" value={<code style={{ fontSize: 12 }}>{run.id}</code>} />
                <MetaRow label="SOP" value={<code style={{ fontSize: 12 }}>{run.sopName}</code>} />
                <MetaRow label="Status" value={
                  <span style={{
                    background: STATUS_COLORS[run.status]?.bg ?? '#f3f4f6',
                    color: STATUS_COLORS[run.status]?.color ?? '#374151',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 600,
                  }}>
                    {run.status}
                  </span>
                } />
                <MetaRow label="Source" value={run.eventSource} />
                <MetaRow label="Event Type" value={run.eventType} />
                <MetaRow label="Duration" value={run.durationMs != null ? `${run.durationMs}ms` : '—'} />
                <MetaRow label="Tokens Used" value={run.tokensUsed != null ? run.tokensUsed.toLocaleString() : '—'} />
                <MetaRow label="Cost (USD)" value={run.costUsd != null ? `$${run.costUsd}` : '—'} />
                <MetaRow label="Created At" value={new Date(run.createdAt).toLocaleString()} />
                <MetaRow label="Completed At" value={run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'} />
              </tbody>
            </table>
          </div>

          {run.error && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ color: '#991b1b' }}>Error</h3>
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: 12, color: '#991b1b', fontSize: 13 }}>
                {run.error}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <h3>Trigger Event</h3>
            <pre style={{
              background: '#1e293b',
              color: '#e2e8f0',
              padding: 16,
              borderRadius: 8,
              overflow: 'auto',
              fontSize: 12,
              lineHeight: 1.6,
              margin: 0,
            }}>
              {JSON.stringify(run.triggerEvent, null, 2)}
            </pre>
          </div>

          {run.result != null && (
            <div>
              <h3>Result</h3>
              <pre style={{
                background: '#1e293b',
                color: '#e2e8f0',
                padding: 16,
                borderRadius: 8,
                overflow: 'auto',
                fontSize: 12,
                lineHeight: 1.6,
                margin: 0,
              }}>
                {JSON.stringify(run.result, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
