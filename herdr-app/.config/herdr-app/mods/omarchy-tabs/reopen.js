export const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function options(program, args) {
  const out = [];
  const switches = new Set(['--dangerously-skip-permissions', '--yolo', '--dangerously-bypass-approvals-and-sandbox', '--no-daemon', '--no-alt-screen', '--search', '--oss', '--full-auto', '--verbose', '--debug', '--no-tools', '-nt', '--no-builtin-tools', '-nbt', '--no-mcp', '--no-extensions', '-ne', '--no-skills', '-ns', '--no-context-files', '-nc', '--offline', '--approve', '-a', '--no-approve', '-na']);
  if (program === 'codex') switches.delete('-a');
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (['--continue', '--last', '--all', '-c'].includes(a) && !(program === 'codex' && a === '-c')) continue;
    if (['--resume', '-r', '--session', '--session-id', '--fork'].includes(a)) {
      if (args[i + 1] && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (/^--(resume|session|session-id|fork)=/.test(a) || !a.startsWith('-')) continue;
    out.push(a);
    if (!a.includes('=') && !switches.has(a) && args[i + 1] && !args[i + 1].startsWith('-')) out.push(args[++i]);
  }
  return out;
}

// The command that brings a pane's agent back where it was. null: a plain shell.
export function resumeCommand(proc, sessionId, home) {
  if (!proc) return null;
  const args = options(proc.program, proc.args).map(quote);
  if (proc?.program === "claude") {
    const env = proc.dir && proc.dir !== `${home}/.claude` ? `CLAUDE_CONFIG_DIR=${quote(proc.dir)} ` : "";
    return `${env}${['claude', ...args, ...(sessionId ? ['--resume', quote(sessionId)] : [])].join(' ')}`;
  }
  if (proc?.program === "codex") {
    const id = sessionId;
    const env = proc.dir && proc.dir !== `${home}/.codex` ? `CODEX_HOME=${quote(proc.dir)} ` : '';
    return env + ['codex', ...(id ? ['resume'] : []), ...args, ...(id ? [quote(id)] : [])].join(' ');
  }
  if (proc.program === 'pi') {
    const env = proc.dir && proc.dir !== `${home}/.pi/agent` ? `PI_CODING_AGENT_DIR=${quote(proc.dir)} ` : '';
    return env + ['pi', ...args, ...(sessionId ? ['--session', quote(sessionId)] : [])].join(' ');
  }
  return null;
}

// Runs inside the person's shell, so the pane stays when the agent exits, as it was.
export const argvOf = (cmd, shell) => (cmd ? [shell, "-lc", `${cmd}; exec ${quote(shell)}`] : undefined);
