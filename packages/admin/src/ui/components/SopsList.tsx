import React, { useEffect, useState } from 'react';
import { fetchSops } from '../api.js';

interface SopTrigger {
  source: string[];
  type: string[];
}

interface SopStep {
  name: string;
  model: string;
}

interface SopDefinition {
  name: string;
  version: string;
  description: string;
  trigger: SopTrigger;
  steps: SopStep[];
}

interface SopsResponse {
  sops: SopDefinition[];
}

export default function SopsList() {
  const [data, setData] = useState<SopsResponse | null>(null);

  useEffect(() => { fetchSops().then(setData); }, []);

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <h2>SOPs ({data.sops.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left', background: '#f9fafb' }}>
            <th style={{ padding: '8px 12px' }}>Name</th>
            <th style={{ padding: '8px 12px' }}>Version</th>
            <th style={{ padding: '8px 12px' }}>Sources</th>
            <th style={{ padding: '8px 12px' }}>Trigger Types</th>
            <th style={{ padding: '8px 12px' }}>Steps</th>
            <th style={{ padding: '8px 12px' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {data.sops.map(sop => (
            <tr key={sop.name} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>{sop.name}</td>
              <td style={{ padding: '8px 12px', fontSize: 13 }}>
                <span style={{ background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>
                  {sop.version}
                </span>
              </td>
              <td style={{ padding: '8px 12px', fontSize: 13 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {sop.trigger.source.map(s => (
                    <span key={s} style={{ background: '#e0f2fe', color: '#075985', padding: '2px 6px', borderRadius: 8, fontSize: 11 }}>
                      {s}
                    </span>
                  ))}
                </div>
              </td>
              <td style={{ padding: '8px 12px', fontSize: 13 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {sop.trigger.type.map(t => (
                    <span key={t} style={{ background: '#fce7f3', color: '#831843', padding: '2px 6px', borderRadius: 8, fontSize: 11 }}>
                      {t}
                    </span>
                  ))}
                </div>
              </td>
              <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'center' }}>
                <span style={{ background: '#f3f4f6', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
                  {sop.steps.length}
                </span>
              </td>
              <td style={{ padding: '8px 12px', fontSize: 13, color: '#6b7280' }}>{sop.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.sops.length === 0 && (
        <div style={{ textAlign: 'center', padding: 32, color: '#9ca3af' }}>No SOPs loaded.</div>
      )}
    </div>
  );
}
