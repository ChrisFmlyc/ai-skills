# codereview — personal CodeRabbit helpers

Two skills for working code review findings on a Pull Request (PR):

- `/codereview:fix` — give it a block of findings from CodeRabbit, Greptile, or any other coding agent. It splits the block into separate findings, runs one subagent per finding, and each finding ends up either fixed in code and committed, or answered on GitHub with a comment and the thread closed. It never pushes.
- `/codereview:loop` — the hands-off wrapper. It waits for the coding agent's review, collects the open findings, hands them to `/codereview:fix`, closes out any thread the agent left open, pushes, and cycles until the PR has no open findings left. It does no fixing itself.

`/codereview:fix` can be invoked by you, by an agent, or by `/codereview:loop`. It does not go looking for findings — something hands it the text.

`/codereview:loop` pushes and posts on your behalf, so it starts only two ways: you type `/codereview:loop`, or a driving skill **you** invoked delegates to it as one of its steps (`/spades:loop` Stage 7 is the reference case — your invocation of the driver is what carries the authorization down). It never fires on its own initiative just because a PR happens to have review comments on it.

## Why there is no worktree isolation

`/codereview:fix` used to give each subagent its own git worktree so their edits could not collide. That was removed in 1.3.0, because a worktree is cut from the repository's **default branch**, not from the branch you are reviewing. On a PR that is the worst possible base: files the branch added are missing entirely, and files it changed appear in their pre-change form — so a subagent either cannot find its file, or quietly reviews the finding against the one version of the code the finding is definitely not about. Both look like a confident answer.

Subagents now edit the ordinary checkout and commit nothing; the supervisor commits, one commit per finding. Findings that share a file are dispatched in separate waves so two subagents never write the same file at once.

For the same reason, `/codereview:fix` refuses to dispatch when the branch is **behind its base**. A stale branch makes a subagent judge a finding against superseded code and "correct" something that was already right. `/codereview:loop` clears that by merging the base in and re-running.

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
