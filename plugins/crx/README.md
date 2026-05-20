# crx — personal CodeRabbit helpers

Two skills for mid-PR CodeRabbit fix prompts:

- `/crx:single` — exactly **one** CodeRabbit finding. Verify it, fix it or write a paste-ready GitHub comment, commit. Never push.
- `/crx:multi` — a **batched** CodeRabbit emission (multiple `-`-prefixed findings under one `In \`@path\`:` line). Parses the block, fans out parallel worktree-isolated subagents, cherry-picks their commits back onto the PR branch in finding order, prints a summary table, then asks before pushing.

Either skill auto-triggers when its header sentence appears in a paste, or you can invoke it by typing `/crx:single` / `/crx:multi`.

## Install

From the `ai-skills` marketplace:

```
/plugin marketplace add ChrisFmlyc/ai-skills
/plugin install crx@ai-skills
```

Restart Claude Code so the new slash commands register.

## Update

```
/plugin marketplace update ai-skills
/plugin update crx@ai-skills
```

## Uninstall

```
/plugin uninstall crx@ai-skills
```
