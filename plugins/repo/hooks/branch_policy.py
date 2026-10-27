#!/usr/bin/env python3
"""Branch-policy hook for the repo plugin (PreToolUse on Bash).

Applies the rules in skills/branch/SKILL.md to a Bash command before it runs:

1. No commit-producing git command on main or master, apart from /repo:init's
   first commit ("New repo initialisation" on a branch with no commits yet).
2. Every branch a command creates matches BRANCH_RE.
3. No bypass routes: --no-verify, a core.hooksPath override, a push that writes
   main or master from another ref, or renaming main or master away.

A violation exits 2 with the reason on stderr, which blocks the command and
shows the reason to the agent. Anything the hook cannot work out, such as a
branch name in a variable it has not seen set or a directory it cannot
resolve, is allowed, and an internal error exits 0: the hook must never break
an unrelated command.

Needs Python 3.8 or later and nothing outside the standard library. Tests:
python3 -m unittest discover -s plugins/repo/hooks
"""
import json
import os
import re
import shlex
import subprocess
import sys

PROTECTED = ('main', 'master')
BRANCH_RE = re.compile(r'^(feat|fix|chore|docs|refactor|rnd|hotfix)/[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$')
PREFIXES = 'feat/, fix/, chore/, docs/, refactor/, rnd/, hotfix/'
INIT_MESSAGE = 'New repo initialisation'

REFUSE_MAIN = (
    'Refusing `{cmd}` on `{branch}`: commits on main or master are not allowed. '
    'Create a branch first with /repo:newbranch, using one of the required prefixes ({prefixes}).{hint}'
)
REFUSE_NAME = (
    'Refusing to create branch `{name}` ({cmd}): branch names must match {regex}, '
    'a prefix from {prefixes} then 1-50 lowercase letters, digits and hyphens that '
    'neither start nor end with a hyphen. Run /repo:branch for a corrected name.{hint}'
)
REFUSE_NO_VERIFY = 'Refusing `{cmd}` with --no-verify: git hooks must run. Fix what the hook reports instead.'
REFUSE_HOOKS_PATH = 'Refusing to override core.hooksPath: that skips the repository\'s git hooks.'
REFUSE_PUSH = (
    'Refusing `git push {spec}`: it writes `{dst}` from another ref. '
    'Push your own branch and open a Pull Request (PR) instead.'
)
REFUSE_RENAME = 'Refusing to rename `{old}` to `{new}`: renaming main or master is a route to committing on it.'

NOREPO, UNKNOWN = 'no-repo', 'unknown'
NAME_RE = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
HEREDOC_RE = re.compile(r'<<(-?)[ \t]*(?:\'([^\']*)\'|"([^"]*)"|([^\s;&|()<>]+))')
OPEN, CLOSE = '(', ')'

KEYWORDS = {'!', '{', '}', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until'}
WRAPPERS = {'command', 'builtin', 'exec', 'nohup', 'env', 'sudo', 'nice', 'time'}
DECLARERS = {'export', 'declare', 'local', 'readonly', 'typeset'}
SHELLS = {'sh', 'bash', 'zsh', 'dash'}
BRANCH_NOT_CREATING = {
    '-d', '-D', '--delete', '-a', '--all', '-r', '--remotes', '-l', '--list', '-v', '--verbose',
    '--show-current', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at',
    '--sort', '--format', '--column', '--no-column', '-u', '--set-upstream-to', '--unset-upstream',
    '--edit-description', '-i', '--ignore-case', '--omit-empty', '-h',
}
CONFIG_VALUE_OPTIONS = {'-f', '--file', '--blob', '-t', '--type', '--default', '--comment', '--value', '--url'}
CONFIG_NOT_WRITING = {
    '--get', '--get-all', '--get-regexp', '--get-urlmatch', '--get-color', '--get-colorbool',
    '--unset', '--unset-all', '--rename-section', '--remove-section', '-l', '--list', '-e', '--edit',
}


# --- Lexing -----------------------------------------------------------------
#
# The lexer approximates POSIX sh closely enough to find git invocations and
# their arguments. It is not a shell. Quoted text stays inside its word, so a
# commit message or PR body that mentions `git push origin HEAD:main` is never
# read as a command, and here-document bodies are skipped.

def _skip_heredoc_bodies(s, i, pending):
    """Skip the here-document bodies that start at s[i]; return the index after the last."""
    n = len(s)
    for delim, strip_tabs in pending:
        while i < n:
            j = s.find('\n', i)
            line = s[i:] if j < 0 else s[i:j]
            i = n if j < 0 else j + 1
            if (line.lstrip('\t') if strip_tabs else line) == delim:
                break
    return i


def _read_heredoc(s, i):
    """Parse the <<DELIM operator at s[i]; return (index after it, (delim, strip_tabs))."""
    m = HEREDOC_RE.match(s, i)
    if not m:
        return i + 2, None
    delim = next(g for g in m.groups()[1:] if g is not None)
    return m.end(), (re.sub(r'[\'"\\]', '', delim), m.group(1) == '-')


def _skip_backtick(s, i):
    n = len(s)
    while i < n:
        if s[i] == '\\':
            i += 2
        elif s[i] == '`':
            return i + 1
        else:
            i += 1
    return n


def _skip_double(s, i):
    n = len(s)
    while i < n:
        c = s[i]
        if c == '\\':
            i += 2
        elif c == '"':
            return i + 1
        elif s.startswith('$(', i):
            i = _skip_subst(s, i + 2)
        elif c == '`':
            i = _skip_backtick(s, i + 1)
        else:
            i += 1
    return n


def _skip_subst(s, i):
    """Return the index just past the ')' that closes a $( opened before s[i]."""
    n, depth, pending = len(s), 1, []
    while i < n:
        c = s[i]
        if c == '\\':
            i += 2
        elif c == "'":
            j = s.find("'", i + 1)
            i = n if j < 0 else j + 1
        elif c == '"':
            i = _skip_double(s, i + 1)
        elif c == '`':
            i = _skip_backtick(s, i + 1)
        elif s.startswith('<<', i) and not s.startswith('<<<', i):
            i, doc = _read_heredoc(s, i)
            if doc:
                pending.append(doc)
        elif c == '\n' and pending:
            i = _skip_heredoc_bodies(s, i + 1, pending)
            pending = []
        else:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
                if depth == 0:
                    return i + 1
            i += 1
    return n


class _Lexer:
    """Split a command into simple commands, each a list of words.

    A word is a list of parts: ('lit', text), ('var', name) for $name or
    ${name}, or ('dyn', None) for anything only the shell can evaluate.
    Subshell parentheses come through as OPEN and CLOSE markers.
    """

    def __init__(self, s):
        self.s, self.i = s, 0
        self.out, self.words = [], []
        self.parts, self.lit, self.started = [], [], False
        self.redirect_target = False
        self.heredocs = []

    def lex(self):
        s, n = self.s, len(self.s)
        while self.i < n:
            c = s[self.i]
            if c == '\\':
                if not s.startswith('\\\n', self.i):
                    self.lit.append(s[self.i + 1:self.i + 2])
                    self.started = True
                self.i += 2
            elif c in ' \t\r':
                self.end_word()
                self.i += 1
            elif c == '\n':
                self.end_command()
                self.i += 1
                if self.heredocs:
                    self.i = _skip_heredoc_bodies(s, self.i, self.heredocs)
                    self.heredocs = []
            elif c in ';&|':
                self.end_command()
                self.i += 1
            elif c in '()':
                self.end_command()
                self.out.append(c)
                self.i += 1
            elif c in '<>':
                self.redirect()
            elif c == '#' and not self.started:
                j = s.find('\n', self.i)
                self.i = n if j < 0 else j
            elif c == "'":
                j = s.find("'", self.i + 1)
                j = n if j < 0 else j
                self.lit.append(s[self.i + 1:j])
                self.started = True
                self.i = j + 1
            elif c == '"':
                self.double_quoted()
            elif c == '$':
                self.dollar()
            elif c == '`':
                self.i = _skip_backtick(s, self.i + 1)
                self.add('dyn', None)
            else:
                self.lit.append(c)
                self.started = True
                self.i += 1
        self.end_command()
        return self.out

    def add(self, kind, value):
        if self.lit:
            self.parts.append(('lit', ''.join(self.lit)))
            self.lit = []
        self.parts.append((kind, value))
        self.started = True

    def end_word(self):
        if self.lit:
            self.parts.append(('lit', ''.join(self.lit)))
            self.lit = []
        if self.started:
            if self.redirect_target:
                self.redirect_target = False
            else:
                self.words.append(self.parts)
        self.parts, self.started = [], False

    def end_command(self):
        self.end_word()
        self.redirect_target = False
        if self.words:
            self.out.append(self.words)
            self.words = []

    def redirect(self):
        s, n = self.s, len(self.s)
        if self.started and not self.parts and ''.join(self.lit).isdigit():
            self.lit, self.started = [], False  # the file descriptor in 2>&1
        else:
            self.end_word()
        if s.startswith('<<', self.i) and not s.startswith('<<<', self.i):
            self.i, doc = _read_heredoc(s, self.i)
            if doc:
                self.heredocs.append(doc)
            return
        j = self.i + 1
        while j < n and s[j] in '<>&|':
            j += 1
        self.i = j
        self.redirect_target = True

    def double_quoted(self):
        s, n = self.s, len(self.s)
        self.started = True
        self.i += 1
        while self.i < n:
            c = s[self.i]
            if c == '"':
                self.i += 1
                return
            if c == '\\' and s[self.i + 1:self.i + 2] in ('"', '\\', '$', '`', '\n'):
                if s[self.i + 1] != '\n':
                    self.lit.append(s[self.i + 1])
                self.i += 2
            elif c == '$':
                self.dollar()
            elif c == '`':
                self.i = _skip_backtick(s, self.i + 1)
                self.add('dyn', None)
            else:
                self.lit.append(c)
                self.i += 1

    def dollar(self):
        s = self.s
        self.started = True
        nxt = s[self.i + 1:self.i + 2]
        name = NAME_RE.match(s, self.i + 1)
        if nxt == '(':
            self.i = _skip_subst(s, self.i + 2)
            self.add('dyn', None)
        elif nxt == '{':
            j = s.find('}', self.i + 2)
            j = len(s) if j < 0 else j
            body = s[self.i + 2:j]
            self.i = j + 1
            if NAME_RE.fullmatch(body):
                self.add('var', body)
            else:
                self.add('dyn', None)
        elif name:
            self.i = name.end()
            self.add('var', name.group())
        elif nxt and nxt in '@*#?$!-0123456789':
            self.i += 2
            self.add('dyn', None)
        else:
            self.lit.append('$')
            self.i += 1


def _resolve(word, env):
    """The word's value, or None when it depends on something the hook cannot evaluate."""
    out = []
    for kind, value in word:
        if kind == 'lit':
            out.append(value)
        elif kind == 'var' and env.get(value) is not None:
            out.append(env[value])
        else:
            return None
    return ''.join(out)


def _assignment(word, env):
    """(name, value) when the word is NAME=value, else None; value is None when unresolvable."""
    if not word or word[0][0] != 'lit':
        return None
    m = re.match(r'([A-Za-z_][A-Za-z0-9_]*)=', word[0][1])
    if not m:
        return None
    return m.group(1), _resolve([('lit', word[0][1][m.end():])] + word[1:], env)


def _unwrap(argv):
    """Drop shell keywords and wrappers such as `env` or `command` in front of the real command."""
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in KEYWORDS:
            i += 1
        elif a is not None and os.path.basename(a) in WRAPPERS:
            i += 1
            while i < len(argv) and argv[i] is not None and (argv[i].startswith('-') or '=' in argv[i]):
                i += 1
        else:
            break
    return argv[i:]


# --- Repository state ---------------------------------------------------------

def _git(cwd, *args):
    """Run a read-only git query in cwd; its stripped stdout, or None if it failed."""
    try:
        r = subprocess.run(
            ['git', '-C', cwd] + list(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, universal_newlines=True, timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _short(ref):
    ref = ref.lstrip('+')
    return ref[len('refs/heads/'):] if ref.startswith('refs/heads/') else ref


class Repos:
    """Branch state per repository: what git reports before the command runs,
    updated by the command's own earlier inits, checkouts and commits.

    A state is NOREPO, UNKNOWN, or (branch, unborn), where branch is None for
    a detached HEAD and unborn means the branch has no commits yet.
    """

    def __init__(self):
        self.states, self.keys = {}, {}

    def key(self, d):
        if d not in self.keys:
            top = _git(d, 'rev-parse', '--show-toplevel') if os.path.isdir(d) else None
            self.keys[d] = (top or os.path.normpath(d), top is not None)
        return self.keys[d]

    def state(self, d):
        if d is None:
            return UNKNOWN
        k, is_repo = self.key(d)
        if k not in self.states:
            if not is_repo:
                self.states[k] = NOREPO
            else:
                branch = _git(d, 'symbolic-ref', '--quiet', '--short', 'HEAD')
                unborn = _git(d, 'rev-parse', '--verify', '--quiet', 'HEAD') is None
                self.states[k] = (branch or None, unborn)
        return self.states[k]

    def set(self, d, state):
        if d is not None:
            self.states[self.key(d)[0]] = state

    def branch(self, d):
        st = self.state(d)
        return st[0] if isinstance(st, tuple) else None

    def has_branch(self, d, name):
        return _git(d, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + name) is not None


# --- Command analysis -----------------------------------------------------------

def _has(args, *flags):
    return any(a in flags for a in args)


def _value_after(args, i):
    return args[i + 1] if i + 1 < len(args) else None


def _commit_flags(args):
    """The -m/--message values and whether --no-verify (-n) is set, from `git commit` arguments."""
    messages, no_verify, i = [], False, 0
    while i < len(args):
        a = args[i]
        i += 1
        if a == '--':
            break
        if a is None:
            continue
        if a == '--no-verify':
            no_verify = True
        elif a in ('--message', '--file', '--reuse-message', '--reedit-message', '--template',
                   '--author', '--date', '--trailer', '--cleanup', '--fixup', '--squash'):
            if a == '--message':
                messages.append(_value_after(args, i - 1))
            i += 1
        elif a.startswith('--message='):
            messages.append(a[len('--message='):])
        elif a.startswith('-') and not a.startswith('--'):
            for k, ch in enumerate(a[1:], 1):
                if ch == 'n':
                    no_verify = True
                if ch in 'mFcCt':
                    attached = a[k + 1:]
                    value = attached or _value_after(args, i - 1)
                    if not attached:
                        i += 1
                    if ch == 'm':
                        messages.append(value)
                    break
                if ch in 'uS':
                    break  # takes an optional value attached to the flag
    return messages, no_verify


class Shell:
    """Walks a Bash command in order, tracking the working directory, variables
    and branch state, and returns the first policy violation it finds."""

    def __init__(self, cwd):
        self.cwd = cwd
        self.env = {'HOME': os.path.expanduser('~')}
        self.repos = Repos()
        self.stack = []

    def path(self, base, p):
        if p is None:
            return None
        p = os.path.expanduser(p)
        if os.path.isabs(p):
            return os.path.normpath(p)
        return None if base is None else os.path.normpath(os.path.join(base, p))

    def run(self, command, depth=0):
        for item in _Lexer(command).lex():
            if item == OPEN:
                self.stack.append((self.cwd, dict(self.env)))
            elif item == CLOSE:
                if self.stack:
                    self.cwd, self.env = self.stack.pop()
            else:
                reason = self.simple(item, depth)
                if reason:
                    return reason
        return None

    def simple(self, words, depth):
        k = 0
        while k < len(words) and _assignment(words[k], self.env):
            k += 1
        if k == len(words):
            for w in words:
                name, value = _assignment(w, self.env)
                self.env[name] = value
            return None
        argv = _unwrap([_resolve(w, self.env) for w in words[k:]])
        if not argv or argv[0] is None:
            return None
        cmd = os.path.basename(argv[0])
        if cmd in DECLARERS:
            for w in words[k + 1:]:
                a = _assignment(w, self.env)
                if a:
                    self.env[a[0]] = a[1]
        elif cmd in ('cd', 'pushd'):
            args = [a for a in argv[1:] if a is None or a == '-' or not a.startswith('-')]
            if not args:
                self.cwd = self.env.get('HOME') if cmd == 'cd' else None
            else:
                self.cwd = None if args[0] == '-' else self.path(self.cwd, args[0])
        elif cmd == 'popd':
            self.cwd = None
        elif cmd in SHELLS and len(argv) > 2 and argv[1] in ('-c', '-lc', '-ic') and argv[2] and depth < 3:
            saved = (self.cwd, dict(self.env))
            reason = self.run(argv[2], depth + 1)
            self.cwd, self.env = saved
            return reason
        elif cmd == 'git':
            return self.git(argv[1:])
        return None

    def git(self, args):
        d, i = self.cwd, 0
        while i < len(args):
            a = args[i]
            if a == '-C':
                d = self.path(d, _value_after(args, i))
                i += 2
            elif a == '-c':
                value = _value_after(args, i)
                if value is not None and value.lower().startswith('core.hookspath'):
                    return REFUSE_HOOKS_PATH
                i += 2
            elif a in ('--git-dir', '--work-tree'):
                d = None
                i += 2
            elif a is not None and a.startswith(('--git-dir=', '--work-tree=')):
                d = None
                i += 1
            elif a is not None and a.lower().startswith('--config-env=core.hookspath'):
                return REFUSE_HOOKS_PATH
            elif a is not None and a.startswith('-'):
                i += 1
            else:
                break
        if i >= len(args) or args[i] is None:
            return None
        sub, rest = args[i], args[i + 1:]
        if '--no-verify' in rest:
            return REFUSE_NO_VERIFY.format(cmd='git ' + sub)
        handler = self.HANDLERS.get(sub)
        return handler(self, sub, rest, d) if handler else None

    # Rule 1 ------------------------------------------------------------------

    def protect(self, d, cmd, hint=''):
        branch = self.repos.branch(d)
        if branch in PROTECTED:
            return REFUSE_MAIN.format(cmd=cmd, branch=branch, prefixes=PREFIXES, hint=hint)
        return None

    def git_commit(self, sub, rest, d):
        messages, no_verify = _commit_flags(rest)
        if no_verify:
            return REFUSE_NO_VERIFY.format(cmd='git commit')
        st = self.repos.state(d)
        if not isinstance(st, tuple):
            return None
        branch, unborn = st
        if branch in PROTECTED and not (unborn and messages == [INIT_MESSAGE]):
            return REFUSE_MAIN.format(cmd='git commit', branch=branch, prefixes=PREFIXES, hint='')
        self.repos.set(d, (branch, False))
        return None

    def git_pick(self, sub, rest, d):
        if _has(rest, '--abort', '--quit', '--skip', '-n', '--no-commit'):
            return None
        return self.protect(d, 'git ' + sub)

    def git_merge(self, sub, rest, d):
        if _has(rest, '--abort', '--quit', '--ff-only', '--squash', '--no-commit'):
            return None
        return self.protect(d, 'git merge', ' To update it from the remote, use `git merge --ff-only` or `git pull --ff-only`.')

    def git_am(self, sub, rest, d):
        if _has(rest, '--abort', '--quit', '--show-current-patch'):
            return None
        return self.protect(d, 'git am')

    def git_rebase(self, sub, rest, d):
        return self.protect(d, 'git rebase --continue') if '--continue' in rest else None

    # Rule 2, and where HEAD moves ------------------------------------------------

    def validate(self, name, cmd, hint=''):
        if name is None or BRANCH_RE.match(name):
            return None
        return REFUSE_NAME.format(name=name, cmd=cmd, regex=BRANCH_RE.pattern, prefixes=PREFIXES, hint=hint)

    def move(self, d, target, unborn=False):
        """Record where `git checkout/switch <target>` leaves HEAD in d."""
        if d is None:
            return
        if target is None or target == '-':
            self.repos.set(d, UNKNOWN)
        elif self.repos.has_branch(d, target) or target in PROTECTED or unborn or \
                _git(d, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + target):
            self.repos.set(d, (target, unborn))
        elif _git(d, 'rev-parse', '--verify', '--quiet', target + '^{commit}'):
            self.repos.set(d, (None, False))

    def git_checkout(self, sub, rest, d):
        created, new, orphan, detach, positional, paths, i = False, None, False, False, [], False, 0
        while i < len(rest):
            a = rest[i]
            if a == '--':
                paths = True
                break
            if a in ('-b', '-B', '--orphan'):
                created, new, orphan = True, _value_after(rest, i), orphan or a == '--orphan'
                i += 2
                continue
            if a is not None and len(a) > 2 and a[0] == '-' and a[1] in 'bB':
                created, new = True, a[2:]
            elif a == '--detach':
                detach = True
            elif a is None or not a.startswith('-'):
                positional.append(a)
            i += 1
        if created:
            reason = self.validate(new, 'git checkout')
            if reason:
                return reason
            if new is None:
                self.repos.set(d, UNKNOWN)
            else:
                self.repos.set(d, (new, orphan))
        elif detach:
            self.repos.set(d, (None, False))
        elif len(positional) == 1 and not paths:
            self.move(d, positional[0])
        return None

    def git_switch(self, sub, rest, d):
        created, new, orphan, detach, positional, i = False, None, False, False, [], 0
        while i < len(rest):
            a = rest[i]
            if a in ('-c', '-C', '--create', '--force-create', '--orphan'):
                created, new, orphan = True, _value_after(rest, i), orphan or a == '--orphan'
                i += 2
                continue
            if a is not None and a.startswith(('--create=', '--force-create=')):
                created, new = True, a.split('=', 1)[1]
            elif a is not None and len(a) > 2 and a[0] == '-' and a[1] in 'cC':
                created, new = True, a[2:]
            elif a in ('-d', '--detach'):
                detach = True
            elif a is None or not a.startswith('-'):
                positional.append(a)
            i += 1
        if created:
            reason = self.validate(new, 'git switch')
            if reason:
                return reason
            self.repos.set(d, UNKNOWN if new is None else (new, orphan))
        elif detach:
            self.repos.set(d, (None, False))
        elif positional:
            self.move(d, positional[0])
        return None

    def git_branch(self, sub, rest, d):
        flags, positional, i = set(), [], 0
        while i < len(rest):
            a = rest[i]
            if a == '--':
                positional += rest[i + 1:]
                break
            if a is None or not a.startswith('-'):
                positional.append(a)
            elif a.startswith('--'):
                flags.add(a.split('=', 1)[0])
            else:
                flags.update('-' + ch for ch in a[1:])
            i += 1
        if flags & BRANCH_NOT_CREATING or not positional:
            return None
        if flags & {'-m', '-M', '--move'}:
            old, new = (positional[0], positional[1]) if len(positional) > 1 else (self.repos.branch(d), positional[0])
            if old in PROTECTED and new is not None and new not in PROTECTED:
                return REFUSE_RENAME.format(old=old, new=new)
            return None
        if flags & {'-c', '-C', '--copy'}:
            return self.validate(positional[-1], 'git branch --copy')
        return self.validate(positional[0], 'git branch')

    def git_worktree(self, sub, rest, d):
        if not rest or rest[0] != 'add':
            return None
        created, new, detach, positional, rest, i = False, None, False, [], rest[1:], 0
        while i < len(rest):
            a = rest[i]
            if a in ('-b', '-B'):
                created, new = True, _value_after(rest, i)
                i += 2
                continue
            if a == '--reason':
                i += 2
                continue
            if a == '--':
                positional += rest[i + 1:]
                break
            if a is not None and len(a) > 2 and a[0] == '-' and a[1] in 'bB':
                created, new = True, a[2:]
            elif a in ('-d', '--detach'):
                detach = True
            elif a is None or not a.startswith('-'):
                positional.append(a)
            i += 1
        if created:
            return self.validate(new, 'git worktree add -b')
        if detach or len(positional) != 1 or positional[0] is None or d is None:
            return None
        # With no branch argument, git names a new branch after the folder.
        name = os.path.basename(positional[0].rstrip('/'))
        if not name or self.repos.has_branch(d, name):
            return None
        return self.validate(name, 'git worktree add ' + positional[0],
                             ' Without -b, git names the new branch after the folder; pass -b <branch>.')

    # Rule 3 ------------------------------------------------------------------

    def git_push(self, sub, rest, d):
        positional, repo_given, i = [], False, 0
        while i < len(rest):
            a = rest[i]
            if a == '--':
                positional += rest[i + 1:]
                break
            if a in ('--repo', '-o', '--push-option', '--receive-pack', '--exec'):
                repo_given = repo_given or a == '--repo'
                i += 2
                continue
            if a is not None and a.startswith('--repo='):
                repo_given = True
            elif a is None or not a.startswith('-'):
                positional.append(a)
            i += 1
        for spec in positional if repo_given else positional[1:]:
            if spec is None or ':' not in spec:
                continue
            src, dst = spec.split(':', 1)
            if _short(dst) in PROTECTED and _short(src) != _short(dst):
                return REFUSE_PUSH.format(spec=' '.join(a or '…' for a in positional), dst=_short(dst))
        return None

    def git_config(self, sub, rest, d):
        """Refuse a persistent write to core.hooksPath; reads and unsets are fine."""
        flags, positional, i = set(), [], 0
        while i < len(rest):
            a = rest[i]
            if a == '--':
                positional += rest[i + 1:]
                break
            if a in CONFIG_VALUE_OPTIONS:
                i += 2
                continue
            if a is None or not a.startswith('-'):
                positional.append(a)
            else:
                flags.add(a)
            i += 1
        # `git config set <name> <value>` is the only subcommand that writes. The
        # others (get, unset, list, ...) leave the subcommand as the first word,
        # which is never core.hooksPath, so they fall through as allowed.
        if positional[:1] == ['set']:
            positional = positional[1:]
        if flags & CONFIG_NOT_WRITING or len(positional) < 2 or positional[0] is None:
            return None
        return REFUSE_HOOKS_PATH if positional[0].lower() == 'core.hookspath' else None

    # Repository creation, for /repo:init's first commit ---------------------------

    def git_init(self, sub, rest, d):
        branch, given, bare, positional, i = None, False, False, [], 0
        while i < len(rest):
            a = rest[i]
            if a in ('-b', '--initial-branch'):
                branch, given = _value_after(rest, i), True
                i += 2
                continue
            if a in ('--template', '--separate-git-dir', '--object-format', '--ref-format'):
                i += 2
                continue
            if a is not None and a.startswith('--initial-branch='):
                branch, given = a.split('=', 1)[1], True
            elif a == '--bare':
                bare = True
            elif a is None or not a.startswith('-'):
                positional.append(a)
            i += 1
        target = self.path(d, positional[0]) if positional else d
        if target is None or bare or self.repos.state(target) != NOREPO:
            return None
        if not given:
            branch = _git(self.env.get('HOME') or '/', 'config', '--get', 'init.defaultBranch') or 'master'
        self.repos.set(target, UNKNOWN if branch is None else (branch, True))
        return None

    HANDLERS = {
        'commit': git_commit,
        'cherry-pick': git_pick,
        'revert': git_pick,
        'merge': git_merge,
        'am': git_am,
        'rebase': git_rebase,
        'checkout': git_checkout,
        'switch': git_switch,
        'branch': git_branch,
        'worktree': git_worktree,
        'push': git_push,
        'config': git_config,
        'init': git_init,
    }


def check(command, cwd):
    """The reason to block `command` run from `cwd`, or None to let it run."""
    return Shell(cwd).run(command)


def _command(tool_input):
    command = tool_input.get('command') if isinstance(tool_input, dict) else None
    if isinstance(command, list):
        if len(command) >= 3 and command[-2] in ('-c', '-lc'):
            return command[-1]
        return ' '.join(shlex.quote(str(a)) for a in command)
    return command if isinstance(command, str) else None


def main():
    try:
        event = json.load(sys.stdin)
        command = _command(event.get('tool_input'))
        if not command or 'git' not in command:
            return 0
        reason = check(command, event.get('cwd') or os.getcwd())
    except Exception:  # noqa: BLE001 - fail open; see the module docstring
        return 0
    if not reason:
        return 0
    sys.stderr.write('repo plugin, branch policy (/repo:branch): ' + reason + '\n')
    return 2


if __name__ == '__main__':
    sys.exit(main())
