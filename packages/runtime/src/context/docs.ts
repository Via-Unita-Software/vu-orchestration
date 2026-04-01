import { readFile, readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu/core';

export class DocsContextLoader implements ContextLoader {
  type = 'docs';

  async load(params: Record<string, unknown>, _event: OrchestratorEvent): Promise<ContextResult> {
    const paths = (params['paths'] as string[]) || [];
    const basePath = (params['base_path'] as string) || process.cwd();
    const docs: Record<string, string> = {};

    for (const docPath of paths) {
      const fullPath = join(basePath, docPath);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.isDirectory()) {
          const files = await readdir(fullPath);
          for (const file of files) {
            if (['.md', '.txt', '.rst'].includes(extname(file))) {
              docs[join(docPath, file)] = await readFile(join(fullPath, file), 'utf-8');
            }
          }
        } else {
          docs[docPath] = await readFile(fullPath, 'utf-8');
        }
      } catch {
        // Path doesn't exist, skip
      }
    }

    return { type: 'docs', data: { documents: docs } };
  }
}
