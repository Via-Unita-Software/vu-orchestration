import simpleGit from 'simple-git';
import { readFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu/core';

export class RepoContextLoader implements ContextLoader {
  type = 'repo';

  async load(params: Record<string, unknown>, event: OrchestratorEvent): Promise<ContextResult> {
    const repoUrl = (params['url'] as string) || (event.payload['repo_url'] as string);
    const paths = (params['paths'] as string[]) || [];
    const tmpDir = await mkdtemp(join(tmpdir(), 'vu-repo-'));

    try {
      const git = simpleGit();
      await git.clone(repoUrl, tmpDir, ['--depth', '1']);

      const fileContents: Record<string, string> = {};
      for (const filePath of paths) {
        try {
          fileContents[filePath] = await readFile(join(tmpDir, filePath), 'utf-8');
        } catch {
          // File doesn't exist, skip
        }
      }

      return { type: 'repo', data: { files: fileContents, url: repoUrl } };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
}
