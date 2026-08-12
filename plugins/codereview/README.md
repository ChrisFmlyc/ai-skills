# codereview — personal CodeRabbit helpers

Three skills for working CodeRabbit findings on a PR:

- `/codereview:single` — exactly **one** CodeRabbit finding. Verify it, fix it or write a paste-ready GitHub comment, commit. Never push.
- `/codereview:multi` — a **batched** CodeRabbit emission (multiple `-`-prefixed findings under one `In \`@path\`:` line). Parses the block, fans out parallel worktree-isolated subagents, cherry-picks their commits back onto the PR branch in finding order, prints a summary table, then asks before pushing.
- `/codereview:loop` — the hands-off wrapper, designed to run under `/goal`. Its first action sets the outcome with the `/goal` command, then it loops against that goal: wait for CodeRabbit's review, pull unresolved findings via `gh`, dispatch them to `/codereview:single` or `/codereview:multi`, post rebuttal replies and resolve threads for won't-fix findings, push the round's fixes, and repeat until the PR has zero outstanding CodeRabbit threads. Invoking it is your standing authorization to push fix commits to that PR branch — unlike the other two skills, which never push.

`/codereview:single` and `/codereview:multi` auto-trigger when their header sentence appears in a paste, or you can invoke them by typing the slash command.

`/codereview:loop` pushes and posts on your behalf, so it starts only two ways: you type `/codereview:loop`, or a driving skill **you** invoked delegates to it as one of its steps (`/spades:loop` Stage 7 is the reference case — your invocation of the driver is what carries the authorization down). It never fires on its own initiative just because a PR happens to have CodeRabbit comments on it. Before v0.2.0 this was enforced with `disable-model-invocation: true`, which also blocked the delegation path; the rule now lives in the skill body instead.

Both skills run a one-shot **gitignore hygiene** check before any other work — if the repo's `.gitignore` is missing `.claude/worktrees/`, the snippet from `resources/gitignore-snippet.txt` is appended and committed in a single `chore: ignore .claude/worktrees/` commit. This keeps Claude Code's subagent worktrees out of the PR. If the line is already present, nothing happens.

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
