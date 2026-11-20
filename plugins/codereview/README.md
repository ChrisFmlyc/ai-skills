# codereview — personal CodeRabbit helpers

Two skills for working code review findings on a GitHub Pull Request (PR) or a GitLab merge request (MR):

- `/codereview:fix` — give it a block of findings from CodeRabbit, Greptile, or any other coding agent. It splits the block into separate findings, runs one subagent per finding, and each finding ends up either fixed in code and committed, or answered on GitHub or GitLab with a comment and the thread closed. It never pushes.
- `/codereview:loop` — the hands-off wrapper. It waits until every review bot on the PR has reviewed the latest push, collects the open findings, hands them to `/codereview:fix`, closes out any thread the agent left open, pushes, and cycles until the PR has no open findings left. It does no fixing itself.

`/codereview:fix` can be invoked by you, by an agent, or by `/codereview:loop`. It does not go looking for findings — something hands it the text.

`/codereview:loop` pushes and posts on your behalf, so it starts only two ways: you type `/codereview:loop`, or a driving skill **you** invoked delegates to it as one of its steps (`/spades:loop` Stage 7 is the reference case — your invocation of the driver is what carries the authorization down). It never fires on its own initiative just because a PR happens to have review comments on it.

## GitHub and GitLab

Both skills work the same way on either host. GitHub goes through `gh`; GitLab goes through `glab`, where review threads are MR discussions and every API call names the MR's host, target project and number. A link with `/-/merge_requests/` in it, or an `origin` whose host contains `gitlab`, selects GitLab; pass the MR link for a GitLab instance on any other host. GitLab nests projects in groups, so the checks that `origin` is the MR's project compare the whole path after the host, not just the last `owner/name`.

GitLab marks no account as a review bot — CodeRabbit, Greptile and others post as whatever account their installer set up — so on GitLab the loop touches only the accounts you list. Pass them with the MR link, or keep them in `.codereview.yml` on the project's default branch (the loop reads it there through the API, never from the MR's own branch):

```
/codereview:loop https://gitlab.example.com/acme/app/-/merge_requests/7 --bots acme-coderabbit:coderabbit,GitLabDuo:duo
```

```yaml
gitlab:
  review_bots:
    - username: acme-coderabbit
      kind: coderabbit   # coderabbit | greptile | duo | generic
```

Each kind has an adapter for how the loop knows that bot has finished reviewing the latest push: CodeRabbit's commit status, Greptile's summary naming the head commit, or, for GitLab Duo and anything else, its newest note settling. Every other author is a person, and their threads are left alone. [`skills/loop/reference/gitlab-bots.md`](skills/loop/reference/gitlab-bots.md) has the details. A draft MR stops the loop, because the bots skip drafts.

A bot that pauses, skips or fails a push, hits a rate limit, or says nothing about it is not left to time out. On GitHub and GitLab alike, the loop waits out any limit the bot states, then asks it once for one review of the latest commit with its one-off command, such as `@coderabbitai review` or `@greptileai review`. The request is always incremental, reviewing only what changed since the bot's last review. A bot with no such command, Wiz Code among them, is left to the loop's 30-minute deadline. The loop never asks for a full review or resumes a bot's automatic reviews, both of which are yours to do, and never sends a bot a command that pauses, resolves, approves or writes code. [`skills/loop/reference/paused-reviews.md`](skills/loop/reference/paused-reviews.md) has the details.

A push the remote rejects — a GitLab push rule, a lapsed SAML SSO session, a protected branch, GitHub push protection — stops the loop with the remote's message; the branch is never rewritten to get past it.

## Tests

`tests/snippets.sh` runs every shell snippet the skills tag `<!-- snippet-test: <name> -->` against recorded `gh`, `glab` and `git` output in `tests/fixtures/`, offline: the review-time and thread queries, the bot lookup and CodeRabbit status, and both hosts' freshness checks, including forks, missing MRs, auth failures and an unencrypted remote. It needs `bash` and `jq`.

## Why subagents share one checkout

A git worktree is cut from the repository's **default branch**, not from the branch you are reviewing. On a PR that is the worst possible base: files the branch added are missing entirely, and files it changed appear in their pre-change form — so a subagent in a worktree of its own either cannot find its file, or quietly reviews the finding against the one version of the code the finding is definitely not about. Both look like a confident answer.

So `/codereview:fix`'s subagents edit the ordinary checkout and commit nothing; the supervisor commits, one commit per finding. Findings that share a file are dispatched in separate waves so two subagents never write the same file at once.

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
