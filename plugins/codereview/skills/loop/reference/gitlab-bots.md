# Review bots on GitLab

A GitLab note carries no bot flag, and a review bot posts as whatever account
its installer chose: a dedicated user such as `CodeRabbit`, a
`project_<id>_bot_<hash>` or `group_<id>_bot_<hash>` token user, a service
account, or GitLab Duo's built-in `GitLabDuo`. A `[bot]` suffix, the user API's
`bot` field and the token-user name pattern each miss some review bots and
match some automations that are not review bots. So on GitLab the loop works
only with the accounts the caller names, and every other author is a person.

## The bot list

The caller names the review bots, one entry per account, as
`<username>[:<kind>]`:

- `/codereview:loop <MR link> --bots acme-coderabbit:coderabbit,GitLabDuo:duo`
- otherwise `.codereview.yml` at the repository root:

  ```yaml
  gitlab:
    review_bots:
      - username: acme-coderabbit
        kind: coderabbit
      - username: GitLabDuo
        kind: duo
  ```

`kind` picks the adapter below and defaults to `generic`. A `--bots` argument
replaces the file's list. With no list from either source, STOP and raise an
ERROR: every thread would count as a person's, so there is nothing the loop
may touch. Tell the user to pass `--bots` or add `.codereview.yml`.

Check each username against `^[A-Za-z0-9._-]+$` and each kind against the
adapter names; STOP and raise an ERROR quoting any that fails. Then pin each
account's numeric ID:

<!-- snippet-test: gitlab-bot-pin -->
```bash
set -o pipefail
glab api --hostname <host> "users?username=<username>" | jq -c '[.[] | {id, username, bot, state}]'
```

It must return exactly one user. None means the username is wrong or this
login cannot see that user (GitLab answers 404 or an empty list rather than
403 for what a credential cannot see): STOP and raise an ERROR naming it.
Every later step matches a note's `author.id` against these IDs, never its
username or display name. The `bot` field is for the report only: a dedicated
review user reads `bot: false` and is still a listed bot.

## Adapters

Each adapter answers three questions for step 1 and step 3: when has the bot
finished reviewing the latest push, does it resolve its own threads, and is
there a re-trigger the loop may post. The other steps are the same for every
bot.

| `kind` | Review finished when | Resolves its own threads | Re-trigger |
|---|---|---|---|
| `coderabbit` | Its `CodeRabbit` commit status on the head commit (query below) is `success`. `pending` ("Review queued", "Review in progress") is still working. A paused or skipped review ("Review paused", "Review skipped") is a STOP: report it, because only a person resumes it. With no `CodeRabbit` status on the head commit at all, use the `generic` rule. | Yes, on its next review. | None — it reviews every push. |
| `greptile` | Its summary note names the head commit as the last one reviewed: the head commit's full SHA starts with what the `greptile` query below prints. When the query prints nothing, use the `generic` rule. | Usually, on its next review. | `@greptileai` as a new MR note, when its review has not arrived 15 minutes after the push ([Re-triggers](#re-triggers)): Greptile reviews only the opening of an MR unless the project's `greptile.json` adds pushes. |
| `duo` | The `generic` rule, with its re-trigger posted before silence can finish it; GitLab Duo's Code Review Flow also sets its reviewer state to `approved` (nothing found) or `requested_changes`. | Never — step 3 closes its fixed threads. | `/assign_reviewer @GitLabDuo` as a new MR note, when its review has not arrived 15 minutes after the push ([Re-triggers](#re-triggers)). |
| `generic` | Its newest note that starts a discussion is newer than the push and stays the same across two checks in a row — a review arrives as several notes over a minute or two. Silence also finishes it, since a bot with nothing new to say may post nothing: nothing newer 15 minutes after the push, or, for a bot whose adapter has a re-trigger, nothing newer 15 minutes after that re-trigger or at step 1's deadline if sooner ([Re-triggers](#re-triggers)). | Unknown — step 3 handles it. | None. |

The push is when the head commit reached the MR, by GitLab's clock: the
`created_at` of the MR diff version whose `head_commit_sha` is that commit.
GitLab adds a version each time the MR's head changes. A commit's own date
records when it was committed, which can be long before the push, so a review
of the previous head would look newer than it. With the head commit's full SHA:

<!-- snippet-test: gitlab-head-push-time -->
```bash
set -o pipefail
glab api --paginate --hostname <host> "projects/<target_project_id>/merge_requests/<iid>/versions" \
  | jq -rs --arg head '<head-sha>' '
      def epoch: capture("^(?<t>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})$")
        | (.t + "Z" | fromdateiso8601)
          - (if .z == "Z" then 0
             else (.z[0:1] + "1" | tonumber) * ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60) end);
      (if length == 0 then error("no response from glab") else add end)
      | [.[] | select(.head_commit_sha == $head) | .created_at | epoch] | max // empty'
```

It prints seconds since the epoch. When the head is in more than one version,
as after a force-push back to an earlier commit, the newest counts. It prints nothing until
GitLab has recorded the head on the MR; read it again on the next check. Read
it again whenever the MR's `sha` changes. Every "15 minutes after the push"
counts from it, and it is when the commit reached the MR for step 1's deadline.

The `coderabbit` status, with the head commit's full SHA:

<!-- snippet-test: coderabbit-status -->
```bash
set -o pipefail
glab api --paginate --hostname <host> "projects/<target_project_id>/repository/commits/<head-sha>/statuses" \
  | jq -sc '(if length == 0 then error("no response from glab") else add end)
            | [.[] | select(.name == "CodeRabbit") | {status, description}] | first'
```

The `greptile` query, with the bot's pinned ID:

<!-- snippet-test: greptile-summary-commit -->
```bash
set -o pipefail
glab api --paginate --hostname <host> "projects/<target_project_id>/merge_requests/<iid>/notes" \
  | jq -rs --argjson bot <id> '
      (if length == 0 then error("no response from glab") else add end)
      | [.[] | select(.author.id == $bot and (.system | not)
                      and ((.body // "") | test("greptile summary|last reviewed commit"; "i")))]
      | max_by(.id) // empty
      | .body
      | (capture("(?i)last reviewed commit[^\\n]*?/commit/(?<sha>[0-9a-f]{7,40})")
         // capture("(?i)last reviewed commit[^\\n]*?\\b(?<sha>[0-9a-f]{7,40})\\b"))
      | .sha | ascii_downcase'
```

It reads Greptile's summary note: the bot's newest note, by note ID, that
mentions "Greptile Summary" or "Last reviewed commit". It prints the commit
that note's footer gives as last reviewed, from the commit link on the "Last
reviewed commit" line, or else the first hex word of 7 to 40 characters on
that line. It prints nothing when the bot has no summary note or the footer
names no commit. Greptile documents this footer, with "Reviews (N)" and the
last reviewed commit, for its summaries; its exact wording on GitLab is
unverified, so the match is loose and a footer it cannot read counts as no
summary.

The `generic` query, with the bot's pinned ID:

<!-- snippet-test: gitlab-bot-review-time -->
```bash
set -o pipefail
glab api --paginate --hostname <host> "projects/<target_project_id>/merge_requests/<iid>/discussions" \
  | jq -rs --argjson bot <id> '
      def epoch: capture("^(?<t>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})$")
        | (.t + "Z" | fromdateiso8601)
          - (if .z == "Z" then 0
             else (.z[0:1] + "1" | tonumber) * ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60) end);
      (if length == 0 then error("no response from glab") else add end)
      | [.[] | .notes[0] | select(.author.id == $bot and (.system | not)) | .created_at | epoch] | max // empty'
```

It prints seconds since the epoch, to compare with the push time above. A self-managed instance can report times in its own zone (`…+01:00`); `epoch`, in this query and the push-time one, reads either form. Depending on its version, `glab --paginate` prints one array or one per page; `jq -s` reads either.

## Re-triggers

Greptile's and GitLab Duo's adapters have a re-trigger, and it goes out before
silence can finish the bot. At the first check 15 minutes or more after the
push, post a bot's re-trigger when all of these hold:

- its adapter has one, and the bot has not had it this cycle
- it has not finished by its adapter's rule
- it has started no discussion since the push: the `generic` query prints
  nothing newer than the push

Post exactly the text in its table row as a new MR note, here Greptile's:

```bash
glab api --hostname <host> --method POST "projects/<target_project_id>/merge_requests/<iid>/notes" -f body='@greptileai'
```

Then keep checking the bot by its adapter's rule, as step 1 does for every
bot. Silence finishes a bot on the `generic` rule only once it has had its
re-trigger or has none:

- with no re-trigger, when nothing newer than the push has come from it 15
  minutes after the push
- once re-triggered, when nothing newer than the push has come from it 15
  minutes after the re-trigger, or at step 1's 30-minute deadline if that comes
  first

A Greptile summary note that names an older commit keeps Greptile off the
`generic` rule, so silence never finishes it and step 1's deadline decides.
Each bot gets at most one re-trigger per cycle, and the loop posts nothing else
to a bot.

## What the loop never sends a bot

Every bot has commands that silence it, approve the MR, or commit to the
branch. The loop wants a clean review, not a quiet reviewer, and it owns the
branch, so it never sends:

- a command that resolves, approves, pauses, resumes or ignores:
  `@coderabbitai resolve`, `approve`, `pause`, `resume`, an `ignore` line in
  the MR description, GitLab's `/approve` quick action
- a command that writes code: `@coderabbitai fix`, autofix, "fix comments",
  GitLab Duo's "resolve with Duo"
- `@coderabbitai full review`, which drops what the earlier reviews found
- an emoji reaction on a bot's note: Greptile, among others, learns from them
- any quick action other than a re-trigger in the table

The replies in steps 3 and 5 start with `(ai-skills:loop)` or
`(ai-skills:fix)` and mention nobody.

## Draft MRs

CodeRabbit, Greptile and GitLab Duo all skip a draft MR by default, so a draft
never gets the review step 1 waits for. Marking it ready changes the MR, which
is the user's call: STOP and raise an ERROR saying the MR is a draft.
