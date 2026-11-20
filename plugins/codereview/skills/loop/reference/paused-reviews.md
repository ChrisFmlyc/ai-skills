# Paused, skipped, failed and rate-limited reviews

A bot that has not reviewed your latest commit is usually still working.
Three other cases look the same from step 1, and the loop handles them itself:

- **Paused, skipped or failed.** The bot did not review this push. CodeRabbit,
  for one, pauses automatic reviews on a branch that is taking many new
  commits, and says so.
- **Rate-limited.** The bot refused for now, usually saying how long to wait.
- **Silent.** The bot has said nothing about the push at all.

In each, wait out any stated limit, then ask that bot once for one review of
the latest commit with its one-off review command, which a paused bot still
answers.

The request is always incremental. `@coderabbitai review` reviews only the
commits pushed since CodeRabbit's last review, keeping what the earlier
reviews found. A full review of the whole PR is the user's to start, by hand
or by telling you to.

## Adapters

On GitHub a bot is known by its login; on GitLab by its `kind` in the bot list
([`gitlab-bots.md`](gitlab-bots.md)). A bot that matches no row uses the last
one.

| Bot | GitHub login / GitLab `kind` | Paused, skipped or failed | Rate-limited | One-off review |
|---|---|---|---|---|
| CodeRabbit | `coderabbitai[bot]` / `coderabbit` | Its report or notice says so, as [Reading a bot's signals](#reading-a-bots-signals) sets out. | Its report or notice says so, as for a pause. | `@coderabbitai review` |
| Greptile | `greptile-apps[bot]` / `greptile` | None: it skips drafts and filtered PRs without a word, and on GitLab reviews only the opening of an MR unless the project's `greptile.json` adds pushes, so silence is the signal. | None documented. | `@greptileai review` |
| GitLab Duo | none / `duo` | None known. | None known. | `/assign_reviewer @GitLabDuo` |
| Wiz Code | `wiz-<tenant id>[bot]` / `generic` | None: its check runs appear only once a scan has finished, and a scan that times out reports passed. | None documented. | None: it has no re-scan command. |
| any other bot | any / `generic` | None known. | None known. | None. |

A bot with no one-off review gets nothing posted, and step 1's deadline
decides. Wiz Code posts check runs and a summary comment rather than a review,
so on GitHub it reaches step 1's list only when it posts review comments.

## Reading a bot's signals

A bot's report, notice, comment or note counts only when it is about your
latest commit.

On GitHub:

- **The commit reached the PR** at the first check in step 1 that showed it
  at the PR's head, or showed it again after a different head: write down
  `date +%s` at that check, since GitHub records no time at which a commit
  became the PR's head. For the head the PR has when the loop starts, that is
  the loop's first check; for a commit you push, it is the check straight
  after the push.
- **A comment** is about your latest commit when the bot posted or edited it
  after the commit reached the PR.
- **A report**, CodeRabbit's check run or commit status, belongs to the
  commit, not to the push, so every report on the commit is about it,
  whichever push of the commit it came from, as after a force-push back to
  it. A finished one covered this same code, and CodeRabbit does not review a
  commit twice, so waiting for a newer one would only run to the deadline. One
  from the earlier push that says CodeRabbit paused, skipped, failed or hit a
  rate limit costs at most one incremental review.
- **A notice** is about your latest commit when its `noted` is after the
  commit's committer date, `git log -1 --format=%ct <sha>`. A bot can write
  one before the check that first shows the commit, as on a head the PR
  already had when the loop started, and a commit cannot reach the PR before
  it was made. A notice about the previous head written after that date holds
  for this push too: a pause lasts until someone resumes the bot, and a rate
  limit's wait runs from the notice.

On GitLab, the commit reached the MR at the push time
[`gitlab-bots.md`](gitlab-bots.md) reads from the MR's diff versions. A
report, the `coderabbit-status` query's status, is about your latest commit
when its `set_at` is no earlier than the push time; a notice when its `noted`
is no earlier than the push time; and a note when it starts a discussion
after the push, as that file's `generic` query reads it. Until the push-time
query prints a time, no report or notice is about your latest commit.

CodeRabbit gives two signals. Its **report** is its newest check run or commit
status on the commit: the [`coderabbit-check` query](#the-coderabbit-check-query)
on GitHub, the `coderabbit-status` query in [`gitlab-bots.md`](gitlab-bots.md)
on GitLab. Its **notice** is the comment or note in which it says it paused or
hit a rate limit: the [`notice` query](#the-notice-query). Read a status's
description as you read a run's title, matching the phrases below ignoring
case, and go by them before the conclusion or state: a rate-limited review
and, by default, a failed one both conclude `neutral`, and a commit status has
no state for a paused or skipped review, so on GitLab CodeRabbit can report
one as `success`. The phrases follow CodeRabbit's status-check documentation;
their wording on GitLab is unverified.

With only the report and notice about your latest commit, take the first case
that holds:

1. **Finished.** The report is a run reading "Finished" or "No files to
   review", or a `success` status reading "Review completed", "No reviewable
   changes" or "carried forward", as in "Prior review carried forward". It is
   CodeRabbit's review of the commit: CodeRabbit can finish a commit without
   posting a review when it has nothing new to say.
2. **Working.** The report is a run `queued` or `in_progress`, or a `pending`
   status such as "Review queued" or "Review in progress", and no notice was
   written at or after the time it was set. A notice written since means
   CodeRabbit stopped after it started. A queued run the query prints with an
   empty time has not started, so every notice comes after it.
3. **Rate-limited.** The report reads "Review rate limited", or the notice's
   kind is `rate-limited`.
4. **Paused, skipped or failed.** The report reads "Review paused", "Review
   skipped", "Incremental review skipped", "Review failed" or "Review
   cancelled", or the notice's kind is `paused`.
5. **Not worth asking.** The report names an outcome in
   [Not worth asking](#not-worth-asking), such as "Too many files to review".
6. **Failed without a reason.** The report is a run concluded `failure`,
   `cancelled` or `timed_out`, a GitHub status in state `failure` or `error`,
   or a GitLab status `failed` or `canceled`. CodeRabbit stopped before it
   reviewed the commit, so it counts as failed.
7. **No report and no notice.** It is silent or still working, like any other
   bot ([What the loop does](#what-the-loop-does)).
8. **Any other report.** It is still pending.

## Not worth asking

Some outcomes are a bot's answer, not a stall, and get no request:

- **A draft.** The bots skip drafts by design. Marking the PR or MR ready is
  the user's call: STOP and raise an ERROR saying it is a draft.
- **Too much to review, or ignored paths.** CodeRabbit's "Too many files to
  review", and paths or branches a bot is configured to ignore. A one-off
  review sees the same limit. Step 1's deadline decides.
- **A plan, seat or credit limit.** A bot that says its plan, seats, spend cap
  or credits have run out, such as a Greptile review asking you to reactivate
  it, reviews nothing until a person deals with it. Step 1's deadline decides,
  and its WARNING or ERROR quotes the bot.

## What the loop does

At each check in step 1, find the case of every bot that has not reviewed your
latest commit, and post its one-off review when its case says:

| Case | Post the one-off review |
|---|---|
| Paused, skipped or failed | Now. |
| Rate-limited, with a wait that ends 60 minutes or less after the bot said so | At the first check after the wait ends, plus one minute. Keep checking the other bots meanwhile. |
| Rate-limited, with no wait stated | At the first check 60 minutes after the bot said so, CodeRabbit's own advice when it gives no time. |
| Rate-limited, with a wait that ends more than 60 minutes after the bot said so | Never: the limit outlasts the loop's wait. Step 1's deadline decides, and its WARNING or ERROR names the limit and when it ends. |
| Silent: no report, notice, comment or note from the bot about your latest commit | At the first check 15 minutes after the commit reached the PR. |
| Working, not worth asking, or any other | Never: step 1's deadline decides. |

A rate-limited bot is asked only once its limit is over, because a request
posted during the limit is refused and spends the bot's one request for that
commit. The bot said so at its notice's `noted` when it has a notice about
your latest commit, and otherwise when its report was set: the time the
`coderabbit-check` query prints on GitHub, the status's `set_at` on GitLab.
Its wait ends at the notice's `until`.

Each bot gets one request for each commit you push, whichever case it is in.
A bot whose case has a time to post is due its request until it goes out, and
step 1 times its deadline from the request. If the bot pauses, fails or hits a
rate limit again after its request, send nothing more: when its deadline
passes, step 1's WARNING or ERROR names the pause or limit so a person sees
why.

Post the request as a new top-level comment holding exactly the text in the
bot's row, here CodeRabbit's:

```bash
gh api --method POST "repos/{owner}/{repo}/issues/<n>/comments" -f body='@coderabbitai review'
glab api --hostname <host> --method POST "projects/<target_project_id>/merge_requests/<iid>/notes" -f body='@coderabbitai review'
```

The first is GitHub, the second GitLab. Say in your one-line progress which
bot you asked and why: `asked coderabbitai[bot] for a review: paused`.

## What the loop never sends a bot

Every bot has commands that silence it, approve the PR or MR, or commit to
the branch. The loop wants a clean review, not a quiet reviewer, and it owns
the branch, so on GitHub and GitLab alike it never sends:

- a command that resolves, approves, pauses, resumes or ignores:
  `@coderabbitai resolve`, `approve`, `pause`, `resume`, an `ignore` line in
  the PR or MR description, GitLab's `/approve` quick action. `resume` turns
  automatic reviews back on for every later push, and that setting belongs to
  the user.
- a command that writes code: `@coderabbitai fix`, autofix, "fix comments",
  GitLab Duo's "resolve with Duo", Wiz Code's `#wiz remediate`
- `@coderabbitai full review`, or re-requesting a bot as a reviewer, which on
  GitHub starts a full CodeRabbit review: a full review is the user's call,
  and every review the loop asks for is incremental
- a request that raises a bot's review tier or cost, such as Greptile's
  `review this at apex` or `effort: plus`
- an emoji reaction on a bot's note: Greptile, among others, learns from them
- any quick action other than a one-off review in the [Adapters](#adapters)
  table

The replies in steps 3 and 5 start with `(ai-skills:loop)` or
`(ai-skills:fix)` and mention nobody.

## The `coderabbit-check` query

On GitHub, CodeRabbit reports on a commit through a `CodeRabbit` check run,
or through a `CodeRabbit` commit status when the repository sets
`reviews.review_progress` to `false`. The query prints one line for
CodeRabbit's newest report on a commit: its newest check run's status,
conclusion, title and time, or, when the commit has no CodeRabbit check run,
its newest commit status's state, an empty field, its description and time.
It prints nothing when the commit has neither. The time is when CodeRabbit
last set the report, in seconds since the epoch: a run's `completed_at`, or
its `started_at` until it completes, and a status's `updated_at`. A run
CodeRabbit has queued but not yet started has neither, and the query prints
its time empty.

<!-- snippet-test: coderabbit-check -->
```bash
set -o pipefail
epoch='def epoch: capture("^(?<t>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})$")
  | (.t + "Z" | fromdateiso8601)
    - (if .z == "Z" then 0
       else (.z[0:1] + "1" | tonumber) * ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60) end);'
run=$(gh api "repos/{owner}/{repo}/commits/<sha>/check-runs?check_name=CodeRabbit" \
  | jq -r "$epoch"'
      [.check_runs[] | select(.app.slug == "coderabbitai")] | max_by(.id) // empty
      | [.status, (.conclusion // ""), .output.title, (.completed_at // .started_at | if . then epoch else "" end)] | @tsv') || exit
if [ -n "$run" ]; then
  printf '%s\n' "$run"
else
  gh api --paginate "repos/{owner}/{repo}/commits/<sha>/statuses?per_page=100" \
    | jq -rs "$epoch"'
        (if length == 0 then error("no response from gh") else add end)
        | [.[] | select(.context == "CodeRabbit" and .creator.login == "coderabbitai[bot]")]
        | max_by(.id) // empty
        | [.state, "", .description, (.updated_at | epoch)] | @tsv'
fi
```

A check run counts only from the `coderabbitai` app, and a commit status only
from CodeRabbit's own account, `coderabbitai[bot]`: anyone who can write to
the repository can set a status named `CodeRabbit`.

## The `notice` query

CodeRabbit also says it has paused or hit a rate limit in a comment or note,
and keeps editing that one comment rather than posting a new one. The query
prints the bot's newest such notice as its `kind`, `paused` or
`rate-limited`, and two times in seconds since the epoch: when the bot last
wrote it (`noted`) and when its wait ends (`until`). It prints nothing when
the bot has posted none. On GitHub, with the bot's login:

<!-- snippet-test: github-notice -->
```bash
set -o pipefail
gh api --paginate "repos/{owner}/{repo}/issues/<n>/comments" \
  | jq -cs --arg login '<login>' '
      def epoch: capture("^(?<t>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})$")
        | (.t + "Z" | fromdateiso8601)
          - (if .z == "Z" then 0
             else (.z[0:1] + "1" | tonumber) * ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60) end);
      def wait: (capture("(?i)(wait|available in:?)\\s+\\**(?<w>[0-9][^*\\n.]*)").w // "")
        | ((capture("(?<h>[0-9]+) hour").h // "0" | tonumber) * 3600
           + (capture("(?<m>[0-9]+) minute").m // "0" | tonumber) * 60
           + (capture("(?<s>[0-9]+) second").s // "0" | tonumber));
      (if length == 0 then error("no response from gh") else add end)
      | [.[] | select(.user.login == $login)
          | (.body // "") as $b
          | (if ($b | test("rate limit exceeded|review limit reached|review rate limited"; "i")) then "rate-limited"
             elif ($b | test("reviews? paused"; "i")) then "paused" else empty end) as $kind
          | ((.updated_at // .created_at) | epoch) as $at
          | {kind: $kind, id, noted: $at, until: (if $kind == "rate-limited" then $at + ($b | wait) else $at end)}]
      | max_by([.noted, .id]) // empty
      | {kind, noted, until}'
```

On GitLab, with the bot's pinned ID:

<!-- snippet-test: gitlab-notice -->
```bash
set -o pipefail
glab api --paginate --hostname <host> "projects/<target_project_id>/merge_requests/<iid>/notes" \
  | jq -cs --argjson bot <id> '
      def epoch: capture("^(?<t>[0-9-]+T[0-9:]+)(\\.[0-9]+)?(?<z>Z|[+-][0-9]{2}:?[0-9]{2})$")
        | (.t + "Z" | fromdateiso8601)
          - (if .z == "Z" then 0
             else (.z[0:1] + "1" | tonumber) * ((.z[1:3] | tonumber) * 3600 + (.z[-2:] | tonumber) * 60) end);
      def wait: (capture("(?i)(wait|available in:?)\\s+\\**(?<w>[0-9][^*\\n.]*)").w // "")
        | ((capture("(?<h>[0-9]+) hour").h // "0" | tonumber) * 3600
           + (capture("(?<m>[0-9]+) minute").m // "0" | tonumber) * 60
           + (capture("(?<s>[0-9]+) second").s // "0" | tonumber));
      (if length == 0 then error("no response from glab") else add end)
      | [.[] | select(.author.id == $bot and (.system | not))
          | (.body // "") as $b
          | (if ($b | test("rate limit exceeded|review limit reached|review rate limited"; "i")) then "rate-limited"
             elif ($b | test("reviews? paused"; "i")) then "paused" else empty end) as $kind
          | ((.updated_at // .created_at) | epoch) as $at
          | {kind: $kind, id, noted: $at, until: (if $kind == "rate-limited" then $at + ($b | wait) else $at end)}]
      | max_by([.noted, .id]) // empty
      | {kind, noted, until}'
```

`noted` says whether the notice is about your latest commit, as
[Reading a bot's signals](#reading-a-bots-signals) sets out. For a
`rate-limited` notice, `until` equal to `noted` means it gave no wait. The
wait is read from the phrase after "wait" or "available in", as CodeRabbit
words it in "Next included review available in 35 minutes" and, in older
notices, "Please wait **8 minutes and 33 seconds**".
