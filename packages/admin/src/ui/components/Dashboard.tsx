import React, { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchStats } from '../api.js';

interface Stats {
  runsPerDay: { date: string; count: number }[];
  tokenUsage: { date: string; tokens: number }[];
  errorRate: number;
  totalCostUsd: string;
  runsBySop: { sop: string; count: number; successRate: number }[];
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => { fetchStats().then(setStats); }, []);

  if (!stats) return <div>Loading...</div>;

  const totalRuns = stats.runsPerDay.reduce((s, d) => s + d.count, 0);
  const failedRuns = Math.round(totalRuns * stats.errorRate);

  return (
    <div>
      <h2>Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: 'Total Runs', value: totalRuns },
          { label: 'Failed', value: failedRuns },
          { label: 'Total Tokens', value: stats.tokenUsage.reduce((s, d) => s + d.tokens, 0).toLocaleString() },
          { label: 'Total Cost', value: `$${stats.totalCostUsd}` },
        ].map(card => (
          <div key={card.label} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{card.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h3>Runs per Day</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.runsPerDay}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#1d4ed8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h3>Token Usage per Day</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={stats.tokenUsage}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="tokens" stroke="#7c3aed" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <h3>Runs by SOP</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>SOP</th>
              <th style={{ padding: '8px 12px' }}>Runs</th>
              <th style={{ padding: '8px 12px' }}>Success Rate</th>
            </tr>
          </thead>
          <tbody>
            {stats.runsBySop.map(row => (
              <tr key={row.sop} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{row.sop}</td>
                <td style={{ padding: '8px 12px' }}>{row.count}</td>
                <td style={{ padding: '8px 12px' }}>{(row.successRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
