# codereview — personal CodeRabbit helpers

Two skills for working code review findings on a Pull Request (PR):

- `/codereview:fix` — give it a block of findings from CodeRabbit, Greptile, or any other coding agent. It splits the block into separate findings, runs one worktree-isolated subagent per finding, and each finding ends up either fixed in code and committed, or answered on GitHub with a comment and the thread closed. It never pushes.
- `/codereview:loop` — the hands-off wrapper. It waits for the coding agent's review, collects the open findings, hands them to `/codereview:fix`, closes out any thread the agent left open, pushes, and cycles until the PR has no open findings left. It does no fixing itself.

`/codereview:fix` can be invoked by you, by an agent, or by `/codereview:loop`. It does not go looking for findings — something hands it the text.

`/codereview:loop` pushes and posts on your behalf, so it starts only two ways: you type `/codereview:loop`, or a driving skill **you** invoked delegates to it as one of its steps (`/spades:loop` Stage 7 is the reference case — your invocation of the driver is what carries the authorization down). It never fires on its own initiative just because a PR happens to have review comments on it.

`/codereview:fix` runs a one-shot **gitignore hygiene** check before any other work — if the repo's `.gitignore` is missing `.claude/worktrees/`, the snippet from `resources/gitignore-snippet.txt` is appended and committed in a single `chore: ignore .claude/worktrees/` commit. This keeps Claude Code's subagent worktrees out of the PR. If the line is already present, nothing happens.

## Install

From the `ai-skills` marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install codereview@ai-skills
```

Restart Claude Code so the new slash commands register.

## Update

```
/plugin marketplace update ai-skills
/plugin update codereview@ai-skills
```

## Uninstall

```
/plugin uninstall codereview@ai-skills
```
