import React, { useState } from 'react';
import Dashboard from './components/Dashboard.js';
import RunsTable from './components/RunsTable.js';
import RunDetail from './components/RunDetail.js';
import SopsList from './components/SopsList.js';

type Page = 'dashboard' | 'runs' | 'sops';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto', padding: '0 16px' }}>
      <header style={{ borderBottom: '1px solid #e5e7eb', padding: '16px 0', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Via Unita — AI Orchestration Admin</h1>
        <nav style={{ marginTop: 12, display: 'flex', gap: 16 }}>
          {(['dashboard', 'runs', 'sops'] as Page[]).map(p => (
            <button
              key={p}
              onClick={() => { setPage(p); setSelectedRunId(null); }}
              style={{
                background: page === p ? '#1d4ed8' : 'transparent',
                color: page === p ? 'white' : '#374151',
                border: '1px solid ' + (page === p ? '#1d4ed8' : '#d1d5db'),
                padding: '6px 14px',
                borderRadius: 6,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {p}
            </button>
          ))}
        </nav>
      </header>

      {selectedRunId ? (
        <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
      ) : page === 'dashboard' ? (
        <Dashboard />
      ) : page === 'runs' ? (
        <RunsTable onSelectRun={setSelectedRunId} />
      ) : (
        <SopsList />
      )}
    </div>
  );
}
