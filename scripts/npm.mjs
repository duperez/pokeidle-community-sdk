import { execFileSync } from 'node:child_process';

export function runNpm(args, options = {}) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('npm_execpath is missing. Run this command through an npm script.');
  // npm.cmd is not directly executable on Windows; use npm's JS entrypoint without a shell.
  return execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}
