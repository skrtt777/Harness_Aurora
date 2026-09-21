import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export function githubExecutable(env = process.env) {
  if (env.GH_BIN) return existsSync(env.GH_BIN) ? env.GH_BIN : null;
  const dirs = (env.PATH || env.Path || '').split(delimiter).filter(Boolean);
  if (process.platform === 'win32') dirs.push(join(env.ProgramFiles || 'C:/Program Files', 'GitHub CLI'));
  return dirs.map(dir => join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh')).find(existsSync) || null;
}
// JSON on stdin: neither memory text nor credentials are shell arguments.
// GitHub CLI owns the user's authentication. No maintainer token is distributed.
export function githubApi(endpoint, { method = 'GET', body, env = process.env } = {}) {
  const command = githubExecutable(env);
  if (!command) throw new Error('Para contribuir, instale o GitHub CLI e execute gh auth login. Downloads não precisam de conta.');
  if (!/^(user|repos\/|search\/)/.test(endpoint) || /[\r\n]/.test(endpoint)) throw new Error('Endpoint GitHub inválido.');
  return new Promise((resolve, reject) => {
    const args = ['api', '--hostname', 'github.com', '--method', method, '-H', 'Accept: application/vnd.github+json', endpoint];
    if (body !== undefined) args.push('--input', '-');
    const child = execFile(command, args, { windowsHide: true, timeout: 20000, maxBuffer: 2_000_000, env: { ...env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' } }, (error, stdout) => {
      if (error) return reject(new Error('O GitHub não confirmou a operação. Confira sua conexão e a autenticação com gh auth login.'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Resposta inesperada do GitHub.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
