"""Tests for branch_policy.py. Run: python3 -m unittest discover -s plugins/repo/hooks"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import branch_policy  # noqa: E402

GIT_ENV = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@example.com',
               GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@example.com', GIT_CONFIG_NOSYSTEM='1')


def git(cwd, *args):
    subprocess.run(['git', '-C', cwd] + list(args), check=True, env=GIT_ENV,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Repos(unittest.TestCase):
    """A repo on main with one commit, a linked worktree on fix/thing, an unborn
    repo on main, and a folder that is not a repo."""

    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.mkdtemp()
        cls.main = os.path.join(cls.root, 'repo')
        os.makedirs(cls.main)
        git(cls.main, 'init', '-q', '-b', 'main')
        git(cls.main, 'commit', '-q', '--allow-empty', '-m', 'first')
        git(cls.main, 'branch', 'feat/existing')
        cls.feature = os.path.join(cls.root, 'repo-worktrees', 'fix-thing')
        git(cls.main, 'worktree', 'add', '-q', '-b', 'fix/thing', cls.feature)
        cls.unborn = os.path.join(cls.root, 'unborn')
        os.makedirs(cls.unborn)
        git(cls.unborn, 'init', '-q', '-b', 'main')
        cls.plain = os.path.join(cls.root, 'plain')
        os.makedirs(cls.plain)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.root)

    def blocked(self, command, cwd=None):
        reason = branch_policy.check(command, cwd or self.main)
        self.assertIsNotNone(reason, 'expected a block: ' + command)
        return reason

    def allowed(self, command, cwd=None):
        reason = branch_policy.check(command, cwd or self.main)
        self.assertIsNone(reason, 'expected no block: ' + command)


class Rule1NoCommitsOnMain(Repos):
    def test_commit_on_main(self):
        self.assertIn('on `main`', self.blocked('git commit -m "x"'))

    def test_commit_producing_verbs_on_main(self):
        for cmd in ('git commit --amend --no-edit', 'git commit -am x', 'git merge feat/existing',
                    'git cherry-pick abc123', 'git revert HEAD', 'git am x.patch',
                    'git rebase --continue', 'git merge --continue'):
            self.blocked(cmd)

    def test_non_committing_forms_on_main(self):
        for cmd in ('git status', 'git log --oneline -3', 'git pull --ff-only', 'git merge --ff-only origin/main',
                    'git merge --abort', 'git cherry-pick --abort', 'git cherry-pick -n abc', 'git stash',
                    'git fetch origin --prune', 'git rebase origin/main', 'git diff --cached'):
            self.allowed(cmd)

    def test_commit_on_feature_branch(self):
        self.allowed('git commit -m "fix: x"', self.feature)
        self.allowed('git merge origin/main --no-edit', self.feature)

    def test_branch_change_earlier_in_the_command(self):
        self.allowed('git checkout -b feat/new-thing && git add . && git commit -m x')
        self.allowed('git switch -c fix/other && git commit -m x')
        self.blocked('git checkout main && git commit -m x', self.feature)
        self.blocked('git switch main; git commit -m x', self.feature)
        self.allowed('git checkout feat/existing && git commit -m x')
        self.allowed('git checkout --detach && git commit -m x')
        self.allowed('git checkout -- README.md && git commit -m x', self.feature)

    def test_directory_changes(self):
        self.allowed('cd %s && git commit -m x' % self.feature)
        self.blocked('cd %s && git commit -m x' % self.main, self.feature)
        self.blocked('git -C %s commit -m x' % self.main, self.feature)
        self.blocked('cd .. && cd repo && git commit -m x', self.feature.replace('fix-thing', ''))
        self.blocked('(cd %s) && git commit -m x' % self.feature)
        self.allowed('(cd %s && git commit -m x)' % self.feature)

    def test_variables(self):
        self.blocked('WT=%s && git -C "$WT" commit -m x' % self.main, self.feature)
        self.allowed('WT=%s; git -C "$WT" commit -m x' % self.feature)
        self.allowed('git -C "$UNSET_SOMEWHERE_ELSE" commit -m x', self.feature)
        self.allowed('cd "$(git rev-parse --show-toplevel)" && git commit -m x', self.feature)

    def test_wrappers_and_shells(self):
        self.blocked('env GIT_EDITOR=true git commit -m x')
        self.blocked('command git commit -m x')
        self.blocked('bash -c "git commit -m x"')
        self.blocked('if git commit -m x; then echo ok; fi')
        self.blocked('/usr/bin/git commit -m x')


class Rule1InitException(Repos):
    def test_repo_init_first_commit(self):
        fresh = os.path.join(self.root, 'fresh-a')
        os.makedirs(fresh)
        self.allowed('git init -b main\nprintf "DELETE ME\\n" > README.md\ngit add README.md\n'
                     'git commit -m "New repo initialisation"', fresh)

    def test_other_first_commit_message(self):
        fresh = os.path.join(self.root, 'fresh-b')
        os.makedirs(fresh)
        self.blocked('git init -b main && git add README.md && git commit -m "first"', fresh)

    def test_only_the_first_commit(self):
        fresh = os.path.join(self.root, 'fresh-c')
        os.makedirs(fresh)
        self.blocked('git init -b main && git commit -m "New repo initialisation" && '
                     'git commit -m "New repo initialisation"', fresh)

    def test_repo_init_inside_another_repo(self):
        nested = os.path.join(self.main, 'nested')
        os.makedirs(nested)
        self.allowed('git init -b main\nprintf "DELETE ME\\n" > README.md\ngit add README.md\n'
                     'git commit -m "New repo initialisation"', nested)
        self.allowed('git init -b main nested && cd nested && git commit -m "New repo initialisation"')
        self.blocked('git init -b main nested && git commit -m "New repo initialisation"')
        self.blocked('git init -b main && git commit -m "New repo initialisation"')

    def test_unborn_repo(self):
        self.allowed('git commit -m "New repo initialisation"', self.unborn)
        self.blocked('git commit -m "something else"', self.unborn)

    def test_not_a_repo(self):
        self.allowed('git commit -m x', self.plain)


class Rule2BranchNames(Repos):
    def test_bad_names(self):
        for cmd in ('git checkout -b Bad', 'git checkout -b feature/login', 'git switch -c feat/Login',
                    'git switch --create=feat/login_redesign', 'git branch wip/thing', 'git branch feat/-bad',
                    'git branch feat/login-', 'git checkout -B main origin/main', 'git branch -c fix/thing Copy',
                    'git worktree add -b oops ../x', 'git worktree add ../x -B feat/UPPER',
                    'git checkout --orphan scratch', 'git switch -cbad'):
            reason = self.blocked(cmd)
            self.assertIn('Refusing to create branch', reason)

    def test_good_names_and_non_creating_forms(self):
        for cmd in ('git checkout -b feat/login-redesign', 'git switch -c fix/null-pointer-thing',
                    'git branch rnd/spike-1', 'git branch hotfix/csrf-token', 'git branch',
                    'git branch -a', 'git branch --show-current', 'git branch -d whatever',
                    'git branch -D old_branch', 'git branch --merged main', 'git branch -u origin/x',
                    'git worktree add --no-track -b fix/a-b ../a abc123', 'git worktree list',
                    'git worktree add ../y feat/existing', 'git worktree add --detach ../z',
                    'git checkout feat/existing', 'git checkout -- file.txt'):
            self.allowed(cmd)

    def test_worktree_folder_name_becomes_the_branch(self):
        self.assertIn('names the new branch after the folder', self.blocked('git worktree add ../new-folder'))

    def test_names_in_variables(self):
        self.blocked('B=Bad; git checkout -b "$B"')
        self.allowed('B=feat/ok; git checkout -b "$B"')
        self.allowed('git checkout -b "$NOT_SET_HERE"')
        self.allowed('git checkout -b "$(echo whatever)"')

    def test_length_limit(self):
        self.allowed('git branch feat/' + 'a' * 50)
        self.blocked('git branch feat/' + 'a' * 51)


class Rule3Bypasses(Repos):
    def test_no_verify(self):
        for cmd in ('git commit --no-verify -m x', 'git commit -nm x', 'git commit -an -m x',
                    'git push --no-verify', 'git merge --no-verify feat/x'):
            self.assertIn('--no-verify', self.blocked(cmd, self.feature))

    def test_n_inside_a_message_is_not_no_verify(self):
        self.allowed('git commit -m "-n is a flag" ', self.feature)
        self.allowed('git commit -am "use -n"', self.feature)
        self.allowed('git push -n origin fix/thing', self.feature)

    def test_hooks_path(self):
        self.blocked('git -c core.hooksPath=/dev/null commit -m x', self.feature)
        self.blocked('git -c core.hookspath=x push', self.feature)
        self.allowed('git -c user.name=x commit -m x', self.feature)

    def test_hooks_path_in_config(self):
        for cmd in ('git config core.hooksPath /dev/null', 'git config --global core.hookspath x',
                    'git config --file .git/config Core.HooksPath x', 'git config --add core.hooksPath x',
                    'git config --replace-all core.hooksPath x', 'git config -t path core.hooksPath x',
                    'git config set core.hooksPath x', 'git config set --global --comment y core.hooksPath x',
                    'git -C %s config core.hooksPath "$UNSET_VALUE"' % self.feature):
            self.assertIn('core.hooksPath', self.blocked(cmd, self.feature))
        for cmd in ('git config core.hooksPath', 'git config --get core.hooksPath', 'git config get core.hooksPath',
                    'git config --unset core.hooksPath', 'git config unset core.hooksPath',
                    'git config --unset-all core.hooksPath x', 'git config --list', 'git config user.name x',
                    'git config set user.name x', 'git config core.hooksPathX x', 'git config "$K" /dev/null'):
            self.allowed(cmd, self.feature)

    def test_push_to_main_from_another_ref(self):
        for cmd in ('git push origin HEAD:main', 'git push origin fix/thing:refs/heads/master',
                    'git push origin +HEAD:main', 'git push origin :main', 'git push --repo=origin HEAD:main'):
            self.assertIn('Refusing `git push', self.blocked(cmd, self.feature))

    def test_ordinary_pushes(self):
        for cmd in ('git push -u origin main', 'git push origin main:main', 'git push origin fix/thing',
                    'git push -u origin HEAD:refs/heads/fix/thing', 'git push git@github.com:o/r.git fix/thing',
                    'git push'):
            self.allowed(cmd, self.feature)

    def test_renaming_main(self):
        self.blocked('git branch -m feat/x')
        self.blocked('git branch -m main feat/x', self.feature)
        self.allowed('git branch -m master main')
        self.allowed('git branch -m feat/a feat/b', self.feature)
        self.allowed('git branch -m feat/x', self.feature)
        self.allowed('git branch -m main master')

    def test_renaming_onto_main(self):
        for cmd in ('git branch -M main', 'git branch -m master', 'git branch -m fix/thing main',
                    'git branch -M feat/existing master'):
            self.assertIn('without a Pull Request', self.blocked(cmd, self.feature))
        self.allowed('git branch -m "$NOT_SET_HERE" main', self.feature)

    def test_rename_target_must_match_the_regex(self):
        for cmd in ('git branch -m fix/thing wip_stuff', 'git branch -m Bad', 'git branch --move feat/x feature/y'):
            self.assertIn('Refusing to create branch', self.blocked(cmd, self.feature))
        self.allowed('git branch -m old_branch feat/good', self.feature)
        self.allowed('git branch -m feat/x "$NOT_SET_HERE"', self.feature)


class QuotedTextIsNotACommand(Repos):
    def test_messages_and_bodies(self):
        self.allowed('echo "git checkout -b Bad && git push origin HEAD:main"')
        self.allowed("grep -rn 'git commit' .")
        self.allowed('gh pr create --title "fix: x" --body "never run git push origin HEAD:main"')
        self.allowed('# git checkout -b Bad\ngit status')

    def test_heredoc_commit_message(self):
        message = ('git commit -m "$(cat <<\'EOF\'\nfix: don\'t run git checkout -b Bad (or git push origin HEAD:main)\n'
                   '\nCo-Authored-By: someone\nEOF\n)"')
        self.allowed(message, self.feature)
        self.blocked(message)

    def test_top_level_heredoc(self):
        self.allowed("cat > notes.md <<'EOF'\ngit checkout -b Bad\nEOF\ngit status")
        self.blocked("cat > notes.md <<EOF\ntext\nEOF\ngit checkout -b Bad")

    def test_redirections(self):
        self.blocked('git checkout -b Bad 2>&1 | tail -1')
        self.allowed('git checkout -b feat/ok >/dev/null 2>&1')


class HookCommand(Repos):
    """The command string in hooks.json, run through sh the way Claude Code runs it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(os.path.join(HERE, 'hooks.json')) as f:
            cls.command = json.load(f)['hooks']['PreToolUse'][0]['hooks'][0]['command']

    def run_hook(self, command, env_root=os.path.dirname(HERE), var='CLAUDE_PLUGIN_ROOT', payload=None):
        env = {k: v for k, v in os.environ.items() if k not in ('CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT')}
        if env_root is not None:
            env[var] = env_root
        stdin = payload if payload is not None else json.dumps(
            {'hook_event_name': 'PreToolUse', 'tool_name': 'Bash', 'cwd': self.main,
             'tool_input': {'command': command}})
        return subprocess.run(['sh', '-c', self.command], input=stdin, env=env, universal_newlines=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def test_blocks_with_exit_2_and_reason(self):
        r = self.run_hook('git commit -m x')
        self.assertEqual(r.returncode, 2)
        self.assertIn('Refusing `git commit` on `main`', r.stderr)

    def test_allows_with_exit_0(self):
        self.assertEqual(self.run_hook('git status').returncode, 0)
        self.assertEqual(self.run_hook('ls -la').returncode, 0)

    def test_codex_plugin_root(self):
        self.assertEqual(self.run_hook('git commit -m x', var='PLUGIN_ROOT').returncode, 2)

    def test_fails_open(self):
        self.assertEqual(self.run_hook('git commit -m x', env_root=None).returncode, 0)
        self.assertEqual(self.run_hook('git commit -m x', env_root='/nonexistent').returncode, 0)
        self.assertEqual(self.run_hook('', payload='not json').returncode, 0)
        self.assertEqual(self.run_hook('', payload='{}').returncode, 0)

    def test_codex_argv_command(self):
        payload = json.dumps({'cwd': self.main, 'tool_input': {'command': ['bash', '-lc', 'git commit -m x']}})
        self.assertEqual(self.run_hook('', payload=payload).returncode, 2)


if __name__ == '__main__':
    unittest.main()
