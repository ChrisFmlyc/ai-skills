# Paused, skipped, failed and rate-limited reviews

A bot that has not reviewed your latest commit is usually still working.
Three other cases look the same from step 1, and the loop handles them itself:

- **Paused, skipped or failed.** The bot did not review this push. CodeRabbit,
  for one, pauses automatic reviews on a branch that is taking many new
  commits, and says so.
- **Rate-limited.** The bot refused for now, usually saying how long to wait.
- **Silent.** The bot has said nothing about the push at all.

In each, wait out any stated limit, then ask that bot once for one review of
the latest commit with its one-off review command. A paused bot still answers
a one-off request, so the loop never resumes its automatic reviews: that
setting belongs to the user.

The request is always incremental. `@coderabbitai review` reviews only the
commits pushed since CodeRabbit's last review, keeping what the earlier
reviews found. A full review of the whole PR is the user's to start, by hand
or by telling you to: the loop never sends `@coderabbitai full review`, and
never re-requests a bot as a reviewer on GitHub, which starts a full
CodeRabbit review.

## Adapters

On GitHub a bot is known by its login; on GitLab by its `kind` in the bot list
([`gitlab-bots.md`](gitlab-bots.md)). A bot that matches no row uses `generic`.

| Bot | GitHub login / GitLab `kind` | Paused, skipped or failed | Rate-limited | One-off review |
|---|---|---|---|---|
| CodeRabbit | `coderabbitai[bot]` / `coderabbit` | Its `CodeRabbit` check run or commit status on your latest commit (GitHub, the `coderabbit-check` query; GitLab, `gitlab-bots.md`'s `coderabbit-status` query) reads "Review paused", "Review skipped", "Incremental review skipped", "Review failed" or "Review cancelled"; or it failed without giving a reason: a run concluded `failure`, `cancelled` or `timed_out`, a GitHub status `failure` or `error`, or a GitLab status `failed` or `canceled`, whose title or description reads no phrase in this row and no outcome in [Finished, or not worth asking](#finished-or-not-worth-asking); or the `notice` query prints `paused`. | The check run or status reads "Review rate limited", or the `notice` query prints `rate-limited`. A rate limit outweighs the column before it, as [What the loop does](#what-the-loop-does) says. | `@coderabbitai review` |
| Greptile | `greptile-apps[bot]` / `greptile` | None: it skips drafts and filtered PRs without a word, so silence is the signal. | None documented. | `@greptileai review` |
| Wiz Code | `wiz-<tenant id>[bot]` / `generic` | None: its check runs appear only once a scan has finished, and a scan that times out reports passed. | None documented. | None: it has no re-scan command. |
| any other bot | any / `generic` | None known. | None known. | None. |

A bot with no one-off command gets nothing posted, and step 1's deadline
decides. Wiz Code posts check runs and a summary comment rather than a review,
so on GitHub it reaches step 1's list only when it posts review comments.

## Finished, or not worth asking

Some outcomes are a bot's answer, not a stall, and get no request:

- **Finished without a review.** CodeRabbit can finish a commit without
  posting a review, as it does when it has nothing new to say. On GitHub its
  `CodeRabbit` check run on your latest commit reading "Finished" or "No files
  to review", or its `success` commit status reading "Review completed", "No
  reviewable changes" or "carried forward", counts as its review of that
  commit in step 1, from whichever push of the commit it came, as
  [The `coderabbit-check` query](#the-coderabbit-check-query) says. On GitLab
  its adapter in [`gitlab-bots.md`](gitlab-bots.md) says when it has finished.
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

At each check in step 1, for each bot that has not reviewed your latest
commit, read its adapter's signals. A signal counts only when it is about your
latest commit: a comment or note the bot posted or edited after the commit
reached the PR, or a check run or status on that commit. On GitHub that is
every check run or status on the commit, from whichever push of it, as
[The `coderabbit-check` query](#the-coderabbit-check-query) sets out. GitLab
records when each head reached the MR, the push time that
[`gitlab-bots.md`](gitlab-bots.md) reads, and there a status counts only when
it was set no earlier than that.

CodeRabbit's check run or status can say it is still working (a run `queued`
or `in_progress`, a `pending` status) while a notice about your latest commit
says it paused or hit a rate limit. The newer of the two decides: compare
the notice's `noted` with when the run or status was set, the time the
`coderabbit-check` query prints on GitHub and the status's `set_at` on
GitLab. A notice written no earlier than the run or status was set means
CodeRabbit stopped after it started, so the notice's kind decides as the
rules below say; a working run or status set after the notice means it has
started again, so it is still working and gets no request. A queued run the
query prints with an empty time has not started, so a notice about your
latest commit decides over it.

A rate limit outweighs a pause, skip or failure. When one of the bot's
signals about your latest commit says it hit a rate limit and another says it
paused, skipped or failed, with a reason or without one, it counts as
rate-limited, so its request waits for the limit to end: one posted during
the limit is refused, and spends the bot's one request for that commit.

1. **Paused, skipped or failed:** post the bot's one-off command now.
2. **Rate-limited, with a wait of 60 minutes or less:** keep checking the
   other bots, and post the command at the first check after the wait ends
   plus one minute.
3. **Rate-limited, with no wait stated:** post the command at the first check
   60 minutes after the bot said so, CodeRabbit's own advice when it gives no
   time. The bot said so at a rate-limit notice's `noted` when one about your
   latest commit exists, and otherwise when its rate-limited check run or
   status was set: the time the `coderabbit-check` query prints on GitHub, the
   status's `set_at` on GitLab.
4. **Silent:** at the first check 15 minutes after the commit reached the PR,
   a bot that has said nothing about this push gets the command: no check run
   or status that counts as about your latest commit, as above, and no comment
   or note since the commit reached the PR. On GitLab this is the adapter's
   re-trigger in [`gitlab-bots.md`](gitlab-bots.md) § Re-triggers, the same
   request under its other name.

A stated wait that ends more than 60 minutes after the bot said so is longer
than the loop waits: post nothing, and let step 1's deadline decide, with its
WARNING or ERROR naming the limit and when it ends.

Each bot gets one one-off request for each commit you push, and on GitLab it
is that bot's re-trigger for the cycle. A bot due a request under rules 1 to 4
is waited for past step 1's deadline until you post the request, and then for
30 minutes from it; after that, step 1's outcomes apply to it. If it pauses,
fails or hits a rate limit again after the request, send nothing more: when
the 30 minutes are up, step 1's WARNING or ERROR names the pause or limit so a
person sees why. Every other pending bot keeps step 1's deadline, a working
one included: a CodeRabbit run that stays `queued` or `in_progress`, or a
`pending` status, about your latest commit, with no paused or rate-limit
notice about that commit deciding otherwise, gets no request, and the
deadline decides.

Post the command as a new top-level comment holding exactly the text in the
bot's row, here CodeRabbit's:

```bash
gh api --method POST "repos/{owner}/{repo}/issues/<n>/comments" -f body='@coderabbitai review'
glab api --hostname <host> --method POST "projects/<target_project_id>/merge_requests/<iid>/notes" -f body='@coderabbitai review'
```

The first is GitHub, the second GitLab. Say in your one-line progress which
bot you asked and why: `asked coderabbitai[bot] for a review: paused`.

The loop sends nothing else to change a bot's state: not `@coderabbitai
resume`, which turns automatic reviews back on for every later push, not
`full review`, which is the user's call, not `pause` or `ignore`, not a request that raises a bot's review
tier, such as Greptile's `review this at apex`, not Wiz Code's `#wiz
remediate`, and nothing else on the list in [`gitlab-bots.md`](gitlab-bots.md)
§ What the loop never sends a bot, which holds on both hosts.

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

A check run or status belongs to the commit, not to the push. When a commit
reaches the PR again, pushed anew or force-pushed back to, the query can print
CodeRabbit's report from its earlier push, and whatever it prints counts as
about your latest commit. A run reading "Finished" or
"No files to review", or a `success` status reading "Review completed", "No
reviewable changes" or "carried forward", is CodeRabbit's review of the commit
whenever it ran: it covered this same code, and CodeRabbit does not review a
commit twice, so waiting for a newer one would only run to the deadline. Any
other report is read as below and in [What the loop does](#what-the-loop-does),
whichever push it came from. When one from the earlier push says CodeRabbit
paused, skipped, failed or hit a rate limit, the one-off request it gets costs
at most one incremental review, since each bot gets one request for each
commit you push.

A run still `queued` or `in_progress`, or a `pending` status, is working,
unless a paused or rate-limit notice about your latest commit beside it
decides otherwise, as [What the loop does](#what-the-loop-does) says. Read a
status's description as you read a run's title, and go by it before the
conclusion or state: a rate-limited review and, by default, a failed one both
conclude `neutral`, and a commit status has no state for a paused or skipped
review. A failure decides only when the title or description reads none of
the adapter row's phrases and no outcome in
[Finished, or not worth asking](#finished-or-not-worth-asking): a run that
concluded `failure`, `cancelled` or `timed_out`, or a status in state
`failure` or `error`, means CodeRabbit stopped before it reviewed the commit.
It counts as failed, and [What the loop does](#what-the-loop-does) says when
it gets the one-off request.

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

`noted` tells you whether the notice is about your latest commit: it must be
after the commit reached the PR, or at or after the GitLab push time. For a
`rate-limited` notice, `until` equal to `noted` means it gave no wait: use
rule 3. The wait is read from the phrase after "wait" or "available in", as
CodeRabbit words it in "Next included review available in 35 minutes" and,
in older notices, "Please wait **8 minutes and 33 seconds**".
