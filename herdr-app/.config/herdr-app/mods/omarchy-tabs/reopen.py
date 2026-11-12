# Python holds the hc connect session; a mod's exec calls cannot keep its stdin open.
import copy
import datetime
import json
import os
from pathlib import Path
import select
import shlex
import subprocess
import sys
import uuid


def match_session(proc, sessions, used=()):
    matches = [s for s in sessions if s['cwd'] == proc['cwd']
               and s['id'] not in used and -2 <= s['created'] - proc['started'] <= 120]
    return min(matches, key=lambda s: abs(s['created'] - proc['started']), default=None)


def restore_tree(root, terminals, tab):
    node = copy.deepcopy(root)

    def visit(n):
        n['id'] = 'p' + uuid.uuid4().hex
        content = n.get('content', {})
        if 'terminal' in content:
            content['terminal'] = terminals[content['terminal']]
        for child in n.get('children', []):
            visit(child)

    visit(node)
    node['id'] = tab
    return node


class Core:
    def __init__(self, on=None):
        self.on = on
        self.process = subprocess.Popen(['hc', 'connect'], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, text=True)
        self.seq = 0

    def call(self, method, **params):
        if self.on:
            params['on'] = self.on
        self.seq += 1
        self.process.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': self.seq,
                                            'method': method, 'params': params}) + '\n')
        self.process.stdin.flush()
        if not select.select([self.process.stdout], [], [], 5)[0]:
            raise RuntimeError('hc connect did not reply')
        reply = json.loads(self.process.stdout.readline())
        if 'error' in reply:
            raise RuntimeError(json.dumps(reply['error']))
        return reply['result']

    def close(self):
        self.process.stdin.close()
        self.process.terminate()
        self.process.wait()


def timestamp(value):
    return datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def launch_args(argv, program):
    if argv and Path(argv[0]).name in ('bash', 'sh', 'zsh', 'fish'):
        lexer = shlex.shlex(argv[-1] if len(argv) > 2 else '', posix=True, punctuation_chars=';&|')
        lexer.whitespace_split = True
        argv = list(lexer)
    for i, arg in enumerate(argv):
        if Path(arg).name in (program, 'cc', 'ccp', 'cdx'):
            args = argv[i + 1:]
            end = next((i for i, a in enumerate(args) if a in (';', '&&', '||', '|', '&')), len(args))
            return args[:end]
    return []


def session_argument(program, args):
    if program == 'codex' and 'resume' in args:
        for arg in args[args.index('resume') + 1:]:
            try:
                return str(uuid.UUID(arg))
            except ValueError:
                pass
    if program == 'pi':
        for i, arg in enumerate(args):
            if arg.startswith('--session='):
                return arg.split('=', 1)[1]
            if arg == '--session' and i + 1 < len(args):
                return args[i + 1]
    return None


def session_files(proc):
    directory = Path(proc['dir'])
    root = directory / 'sessions'
    if proc['program'] == 'pi':
        encoded = '--' + proc['cwd'].lstrip('/').replace('/', '-').replace(':', '-') + '--'
        root = Path(proc.get('sessionDir') or root / encoded)
    result = []
    for path in root.glob('**/*.jsonl'):
        try:
            # Old sessions cannot belong to a newly started agent unless explicitly resumed.
            if path.stat().st_mtime < proc['started'] - 2:
                continue
            with path.open() as f:
                header = json.loads(f.readline())
            data = header.get('payload', header)
            result.append({'id': data['id'], 'cwd': data['cwd'],
                           'created': timestamp(data['timestamp']), 'path': str(path)})
        except (OSError, ValueError, KeyError):
            continue
    return result


def scan_processes(core):
    home = Path.home()
    boot = next(int(l.split()[1]) for l in Path('/proc/stat').read_text().splitlines()
                if l.startswith('btime '))
    ticks = os.sysconf('SC_CLK_TCK')
    procs = {}
    for path in Path('/proc').glob('[0-9]*'):
        try:
            program = (path / 'comm').read_text().strip()
            if program not in ('claude', 'codex', 'pi'):
                continue
            env = dict(s.split('=', 1) for s in (path / 'environ').read_bytes().decode().split('\0') if '=' in s)
            terminal = env.get('HC_TERMINAL_ID')
            if not terminal:
                continue
            args = (path / 'cmdline').read_bytes().decode().strip('\0').split('\0')[1:]
            if program == 'pi':
                args = launch_args(core.call('terminal.get', terminal=terminal)['argv'], program)
            key, default = {'claude': ('CLAUDE_CONFIG_DIR', '.claude'),
                            'codex': ('CODEX_HOME', '.codex'),
                            'pi': ('PI_CODING_AGENT_DIR', '.pi/agent')}[program]
            proc = {'pid': path.name, 'program': program, 'dir': env.get(key) or str(home / default),
                    'args': args, 'cwd': str((path / 'cwd').resolve()),
                    'started': boot + int((path / 'stat').read_text().rsplit(')', 1)[1].split()[19]) / ticks}
            if program == 'pi':
                proc['sessionDir'] = env.get('PI_CODING_AGENT_SESSION_DIR')
                for i, a in enumerate(args[:-1]):
                    if a == '--session-dir':
                        proc['sessionDir'] = args[i + 1]
            procs[terminal] = proc
        except (OSError, ValueError, UnicodeError, RuntimeError):
            continue

    used = set()
    for proc in sorted(procs.values(), key=lambda p: p['started']):
        try:
            if proc['program'] == 'claude':
                proc['session'] = json.loads((Path(proc['dir']) / 'sessions' / (proc['pid'] + '.json')).read_text())['sessionId']
                continue
            paths = [str(p.resolve()) for p in Path('/proc', proc['pid'], 'fd').iterdir()]
            opened = next((p for p in paths if p.endswith('.jsonl') and '/sessions/' in p), None)
            if opened:
                with open(opened) as f:
                    data = json.loads(f.readline())
                proc['session'] = data['payload']['id'] if proc['program'] == 'codex' else opened
                used.add(data.get('payload', data)['id'])
                continue
            explicit = session_argument(proc['program'], proc['args'])
            if explicit:
                proc['session'] = explicit
                used.add(explicit)
                continue
            session = match_session(proc, session_files(proc), used)
            if session:
                used.add(session['id'])
                proc['session'] = session['id'] if proc['program'] == 'codex' else session['path']
        except (OSError, ValueError, KeyError):
            pass
    return {'shell': os.environ.get('SHELL', '/bin/sh'), 'procs': procs}


def scan():
    core = Core()
    try:
        result = scan_processes(core)
        result['document'] = core.call('doc.get', name='herdr-app')['value']
        return result
    finally:
        core.close()


def app(command, **args):
    result = json.loads(subprocess.check_output(['herdr-app', 'do', command, json.dumps(args)], text=True))
    if 'error' in result:
        raise RuntimeError(result['error'])
    return result


def restore(saved):
    core = Core(saved.get('machine'))
    created = None
    try:
        doc = core.call('doc.get', name='herdr-app')['value']
        space = next((s for s in doc['spaces'] if s['id'] == saved['space'].split('/')[-1]), None)
        first, *rest = saved['panes']
        args = {k: v for k, v in {'name': saved.get('name'), 'folder': first.get('cwd'),
                                 'argv': first.get('argv')}.items() if v is not None}
        if space:
            created = app('tab.new', space=space['id'], **args)
        else:
            created = app('space.new', name=saved.get('spaceName') or '', machine=saved.get('machine'),
                          tab=saved.get('name'), folder=first.get('cwd'), argv=first.get('argv'))
        terminals = {first['terminal']: created['terminal'].split('/')[-1]}
        for pane in rest:
            # Target our own pane explicitly; a person's focus may change during startup.
            shell = saved['shell']
            command = 'cd ' + shlex.quote(pane.get('cwd') or str(Path.home())) + '; '
            command += (pane.get('cmd') + '; ') if pane.get('cmd') else ''
            command += 'exec ' + shlex.quote(shell)
            result = app('pane.split', pane=created['tab'], direction='right', argv=[shell, '-lc', command])
            terminals[pane['terminal']] = result['terminal'].split('/')[-1]
        for _ in range(5):
            current = core.call('doc.get', name='herdr-app')
            space = next(s for s in current['value']['spaces'] if s['id'] == created['space'].split('/')[-1])
            tab = next(t for t in space['tabs'] if t['id'] == created['tab'].split('/')[-1])
            if saved.get('root'):
                tab['root'] = restore_tree(saved['root'], terminals, tab['id'])
            space['tabs'].remove(tab)
            space['tabs'].insert(max(0, saved.get('index', len(space['tabs']) + 1) - 1), tab)
            try:
                core.call('doc.set', name='herdr-app', value=current['value'], version=current['version'])
                return created
            except RuntimeError as e:
                if 'conflict' not in str(e):
                    raise
        raise RuntimeError('The tab layout kept changing; could not restore its tree')
    except Exception:
        if created:
            app('tab.close', id=created['tab'])
        raise
    finally:
        core.close()


if __name__ == '__main__':
    print(json.dumps(scan() if sys.argv[1] == 'scan' else restore(json.loads(sys.argv[2]))))
