import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextLoaderRegistry } from '../context/loader.js';
import { DocsContextLoader } from '../context/docs.js';
import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu-orchestration/core';

const mockEvent: OrchestratorEvent = {
  id: '00000000-0000-0000-0000-000000000001',
  source: 'test',
  sourceEventId: 'evt-1',
  type: 'test.event',
  timestamp: new Date().toISOString(),
  payload: {},
  meta: {
    tenant: 'test-tenant',
    deduplicationKey: 'dedup-key-1',
    interactive: false,
  },
};

describe('ContextLoaderRegistry', () => {
  it('registers and retrieves loaders by type', () => {
    const registry = new ContextLoaderRegistry();
    const loader: ContextLoader = {
      type: 'mock',
      load: vi.fn().mockResolvedValue({ type: 'mock', data: {} }),
    };
    registry.register(loader);
    expect(registry.get('mock')).toBe(loader);
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('loadAll calls loaders in order and returns results keyed by type', async () => {
    const registry = new ContextLoaderRegistry();

    const loader1: ContextLoader = {
      type: 'loader1',
      load: vi.fn().mockResolvedValue({ type: 'loader1', data: { value: 'one' } }),
    };
    const loader2: ContextLoader = {
      type: 'loader2',
      load: vi.fn().mockResolvedValue({ type: 'loader2', data: { value: 'two' } }),
    };

    registry.register(loader1);
    registry.register(loader2);

    const results = await registry.loadAll(
      [
        { type: 'loader1', params: { a: 1 } },
        { type: 'loader2', params: { b: 2 } },
      ],
      mockEvent
    );

    expect(results['loader1']).toEqual({ type: 'loader1', data: { value: 'one' } });
    expect(results['loader2']).toEqual({ type: 'loader2', data: { value: 'two' } });
    expect(loader1.load).toHaveBeenCalledWith({ a: 1 }, mockEvent);
    expect(loader2.load).toHaveBeenCalledWith({ b: 2 }, mockEvent);
  });

  it('loadAll skips unknown loader types with a warning', async () => {
    const registry = new ContextLoaderRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const results = await registry.loadAll([{ type: 'unknown' }], mockEvent);

    expect(results).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith('No loader registered for type: unknown');
    warnSpy.mockRestore();
  });
});

describe('DocsContextLoader', () => {
  it('reads a markdown file from a temp directory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vu-docs-test-'));
    try {
      const content = '# Hello World\nThis is a test document.';
      await writeFile(join(tmpDir, 'readme.md'), content, 'utf-8');

      const loader = new DocsContextLoader();
      const result = await loader.load(
        { base_path: tmpDir, paths: ['readme.md'] },
        mockEvent
      );

      expect(result.type).toBe('docs');
      expect((result.data['documents'] as Record<string, string>)['readme.md']).toBe(
        content
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reads all .md and .txt files from a subdirectory', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'vu-docs-test-'));
    try {
      const subDir = join(tmpDir, 'docs');
      await mkdir(subDir);
      await writeFile(join(subDir, 'doc1.md'), '# Doc 1', 'utf-8');
      await writeFile(join(subDir, 'doc2.txt'), 'Plain text', 'utf-8');
      await writeFile(join(subDir, 'ignored.json'), '{}', 'utf-8');

      const loader = new DocsContextLoader();
      const result = await loader.load(
        { base_path: tmpDir, paths: ['docs'] },
        mockEvent
      );

      const docs = result.data['documents'] as Record<string, string>;
      const keys = Object.keys(docs);
      expect(keys.some((k) => k.endsWith('doc1.md'))).toBe(true);
      expect(keys.some((k) => k.endsWith('doc2.txt'))).toBe(true);
      expect(keys.some((k) => k.endsWith('ignored.json'))).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('silently skips paths that do not exist', async () => {
    const loader = new DocsContextLoader();
    const result = await loader.load(
      { base_path: '/nonexistent/path', paths: ['missing.md'] },
      mockEvent
    );
    expect(result.data['documents']).toEqual({});
  });
});
