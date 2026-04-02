import React, { useEffect, useState } from 'react';
import { fetchRuns } from '../api.js';

interface Run {
  id: string;
  sopName: string;
  eventSource: string;
  eventType: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  durationMs: number | null;
  costUsd: string | null;
  createdAt: string;
}

interface RunsResponse {
  runs: Run[];
  total: number;
  page: number;
  limit: number;
}

interface Props {
  onSelectRun: (id: string) => void;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  queued:    { bg: '#fef3c7', color: '#92400e' },
  running:   { bg: '#dbeafe', color: '#1e40af' },
  completed: { bg: '#d1fae5', color: '#065f46' },
  failed:    { bg: '#fee2e2', color: '#991b1b' },
};

export default function RunsTable({ onSelectRun }: Props) {
  const [data, setData] = useState<RunsResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [sopSearch, setSopSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params: Record<string, string> = { page: String(page), limit: '20' };
    if (statusFilter) params['status'] = statusFilter;
    if (sopSearch) params['sop'] = sopSearch;
    fetchRuns(params).then(setData);
  }, [statusFilter, sopSearch, page]);

  return (
    <div>
      <h2>Runs</h2>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6 }}
        >
          <option value="">All Statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <input
          type="text"
          placeholder="Filter by SOP name..."
          value={sopSearch}
          onChange={e => { setSopSearch(e.target.value); setPage(1); }}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, minWidth: 220 }}
        />
      </div>

      {!data ? (
        <div>Loading...</div>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left', background: '#f9fafb' }}>
                <th style={{ padding: '8px 12px' }}>Status</th>
                <th style={{ padding: '8px 12px' }}>SOP</th>
                <th style={{ padding: '8px 12px' }}>Source</th>
                <th style={{ padding: '8px 12px' }}>Type</th>
                <th style={{ padding: '8px 12px' }}>Duration</th>
                <th style={{ padding: '8px 12px' }}>Cost</th>
                <th style={{ padding: '8px 12px' }}>Created At</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map(run => {
                const sc = STATUS_COLORS[run.status] ?? { bg: '#f3f4f6', color: '#374151' };
                return (
                  <tr
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        background: sc.bg,
                        color: sc.color,
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        {run.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 13 }}>{run.sopName}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{run.eventSource}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{run.eventType}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>
                      {run.durationMs != null ? `${run.durationMs}ms` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>
                      {run.costUsd != null ? `$${run.costUsd}` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>
                      {new Date(run.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, cursor: page === 1 ? 'default' : 'pointer' }}
            >
              Previous
            </button>
            <span style={{ fontSize: 13 }}>
              Page {data.page} — {data.total} total runs
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * data.limit >= data.total}
              style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6, cursor: page * data.limit >= data.total ? 'default' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
