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
- otherwise `.codereview.yml` at the root of the target project's default
  branch:

  ```yaml
  gitlab:
    review_bots:
      - username: acme-coderabbit
        kind: coderabbit
      - username: GitLabDuo
        kind: duo
  ```

The list decides whose threads the loop answers and resolves, so it comes
only from a source the MR cannot change: the caller's `--bots`, or the file as
the target project's default branch holds it. The checkout is the MR's own
branch, which whoever opened the MR writes, and a list read from there could
name any account as a bot, a person reviewing the MR included. Read the file
through the API, with the MR's host and `target_project_id`:

```bash
glab api --hostname <host> "projects/<target_project_id>/repository/files/.codereview.yml/raw"
```

With no `ref`, GitLab reads the project's default branch, and the command
prints the file. A 404 means the default branch has no `.codereview.yml`, so
there is no list from the file; any other failure is a STOP with an ERROR
quoting glab's message. A list that an MR adds or changes takes effect once it
is merged into the default branch.

`kind` picks the adapter below and defaults to `generic`. A `--bots` argument
replaces the file's list, and the file is then not read. With no list from
either source, STOP and raise an ERROR: every thread would count as a
person's, so there is nothing the loop may touch. Tell the user to pass
`--bots` or add `.codereview.yml` to the default branch.

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

Each adapter answers two questions for step 1 and step 3: when has the bot
finished reviewing the latest push, and does it resolve its own threads. A
bot's one-off review request, and when the loop posts it, are in
[`paused-reviews.md`](paused-reviews.md). The other steps are the same for
every bot.

| `kind` | Review finished when | Resolves its own threads |
|---|---|---|
| `coderabbit` | Its `CodeRabbit` status about the push reads finished ([`paused-reviews.md`](paused-reviews.md#reading-a-bots-signals), case 1). Or, while the `coderabbit-status` query below prints `null`, the bot has written no paused or rate-limit notice since the push, and the loop has not asked it for a review of this push: its newest note that starts a discussion is newer than the push and stays the same across two checks in a row, as for `generic`. | Yes, on its next review. |
| `greptile` | Its summary note names the head commit as the last one reviewed: the head commit's full SHA starts with what the `greptile` query below prints. When the query prints nothing, the `generic` rule decides. | Usually, on its next review. |
| `duo` | The `generic` rule. Its reviewer state, which GitLab Duo's Code Review Flow sets to `approved` (nothing found) or `requested_changes`, is for the report only: it can be left from an earlier head, and it explains a `requested_changes` merge status. | Never — step 3 closes its fixed threads. |
| `generic` | Its newest note that starts a discussion is newer than the push and stays the same across two checks in a row — a review arrives as several notes over a minute or two. Silence also finishes it, since a bot with nothing new to say may post nothing: nothing newer than the push 15 minutes after it, for a bot with no one-off review, or 30 minutes after its request, for a bot that has one. | Unknown — step 3 handles it. |

CodeRabbit's note rule ends at the loop's request because CodeRabbit answers
`@coderabbitai review` with a note acknowledging it, which it may later edit
to say the review finished. That answer is not a review, whatever it says,
yet it can start a discussion as a review does, and its wording on GitLab is
unverified.

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

The `coderabbit-status` query, with the head commit's full SHA and the bot's
pinned ID:

<!-- snippet-test: coderabbit-status -->
```bash
set -o pipefail
glab api --paginate --hostname <host> "projects/<target_project_id>/repository/commits/<head-sha>/statuses?all=true" \
  | jq -sc --argjson bot <id> '
      def epoch: capture("^(?<t>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})$")
        | (.t + "Z" | fromdateiso8601)
          - (if .z == "Z" then 0
             else (.z[0:1] + "1" | tonumber) * ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60) end);
      (if length == 0 then error("no response from glab") else add end)
      | [.[] | select(.name == "CodeRabbit" and .author.id == $bot)
             | {pipeline_id, id, status, description, set_at: ((.finished_at // .started_at // .created_at) | epoch)}]
      | max_by([.pipeline_id, .id]) | if . then del(.pipeline_id, .id) else . end'
```

It prints the bot's newest `CodeRabbit` status on the head commit, as its
status, its description and `set_at`, when it was set in seconds since the
epoch; or `null` when the head commit has no `CodeRabbit` status from the
bot's account. Anyone who can set commit statuses on the project can set one
named `CodeRabbit`, so a status counts only when its `author.id` is the bot's
pinned ID, as for a note. `all=true` lists every status on the commit,
retried ones included. A new status in a pipeline, from any account, marks
the older ones of the same name in that pipeline as retried, and GitLab's
default list leaves retried statuses out; with `all=true`, the bot's own
status stays in the list when another account sets a `CodeRabbit` status
beside it. A commit can hold several of the bot's `CodeRabbit` statuses,
across its pipelines and within one. The newest is the one on the newest
pipeline, by `pipeline_id`, and within a pipeline the one created last, by
`id`; GitLab numbers both in the order it creates them. When a status was set does not order them: the
review of an earlier push can finish after the review of the latest push has
started, and the latest review, still `pending`, is the one that counts.
`set_at` is the status's `finished_at`, which GitLab stamps when a status
becomes `success`, `failed` or `canceled`; for any other status it is
`started_at`, or else `created_at`.

The statuses belong to the commit, not to the push: a commit that reaches the
MR again, pushed anew or force-pushed back to, still carries the status from
its earlier push, which reviewed an earlier state of the MR. So its `set_at`
says whether it is about the push, as
[`paused-reviews.md`](paused-reviews.md#reading-a-bots-signals) sets out,
where it is read together with CodeRabbit's notice. A review of the same commit that began
before the push and ended after it is about the push: it reviewed the same
code, and CodeRabbit does not review a commit twice.

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

It prints seconds since the epoch, to compare with the push time above. A self-managed instance can report times in its own zone (`…+01:00`); `epoch`, in this query, the push-time one and the `coderabbit-status` one, reads either form. Depending on its version, `glab --paginate` prints one array or one per page; `jq -s` reads either.
