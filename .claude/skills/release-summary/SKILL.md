---
name: release-summary
description: This skill should be used when the user asks to "summarize the weekly release", "generate release notes", "summarize release candidate PR", "post release summary to Slack", "write marketing release notes", or invokes /release-summary. Takes no arguments — it runs against the team's default repos (`gridverify/domain-model`, `gridverify/orchestrator-ui`, `gridverify/embedded-ui`, `gridverify/api-gateway`), automatically locates each repo's merged Weekly Release Candidate PR for the current week, produces a Marketing/Sales-facing bullet summary by aggregating Shortcut story descriptions and PR titles from the attached "Tuesday Release Candidate" GitHub milestone, then posts the combined summary to `#product-updates`.
allowed-tools: Bash(gh:*), Bash(curl:*), Bash(jq:*), Bash(printenv:*), Bash(date:*), Read
---

# Release Summary

Generate a Marketing/Sales-facing summary of this week's merged Weekly Release Candidate PRs across the team's default repos and post it to Slack. The skill takes **no arguments**. For each default repo it auto-discovers the merged Weekly Release Candidate PR for the current week, aggregates Shortcut story descriptions and PR metadata from the GitHub milestone attached to that RC PR, produces benefit-focused bullets grouped by feature / improvement / fix, and posts the combined result to `#product-updates`.

## Defaults

- **Repos:**
  - `gridverify/domain-model`
  - `gridverify/orchestrator-ui`
  - `gridverify/embedded-ui`
  - `gridverify/api-gateway`
- **Slack channel:** `#product-updates`

The skill does not accept input — ignore any arguments and use the defaults above.

## Step 1 — Determine the current release week

Compute the Monday–Sunday boundaries of the current calendar week with BSD `date` (the platform is macOS/darwin):

```sh
dow=$(date +%u)                       # 1=Mon … 7=Sun
weekStart=$(date -v-$((dow-1))d +%F)  # Monday   (YYYY-MM-DD)
weekEnd=$(date -v+$((7-dow))d +%F)    # Sunday   (YYYY-MM-DD)
```

Save `weekStart` and `weekEnd`; they bound the `mergedAt` filter in Step 2.

## Step 2 — Discover the merged RC PR for each repo

For each repo in **Defaults**, find its merged Weekly Release Candidate PR for the current week:

```sh
gh pr list --repo {owner}/{repo} --state merged \
  --search 'Weekly Release Candidate PR in:title' \
  --json number,title,mergedAt,baseRefName,milestone,body,url --limit 30
```

Then, per repo:

1. Keep only entries whose title matches this regex (case-insensitive, whitespace-tolerant; the date may or may not be wrapped in brackets):

   ```
   ^\s*Weekly Release Candidate PR - \[?(\d{2}-\d{2}-\d{4})\]?\s*$
   ```

2. Keep only entries whose `mergedAt` **date** falls within `[weekStart, weekEnd]` (inclusive). If more than one remains, take the one with the most recent `mergedAt`.

3. Apply per-repo eligibility — if any check fails, **skip this repo silently** (do not fail the whole run):
   - `baseRefName` is `production`.
   - `milestone` is non-null and `milestone.title` starts with `Tuesday Release Candidate`.

Record for each qualifying repo: `owner`, `repo`, `rcPrNumber`, `rcPrTitle`, `mergedAt`, `milestoneNumber`.

If **no** repo qualifies, tell the user: "No merged Weekly Release Candidate PRs found for the current week (`{weekStart}`–`{weekEnd}`)." and stop — post nothing.

## Step 3 — List child PRs in each milestone

For each qualifying repo, GitHub's Issues API lists both issues and PRs under a milestone; filter to PRs only and exclude that repo's RC PR:

```sh
gh api "repos/{owner}/{repo}/issues?milestone={milestoneNumber}&state=closed&per_page=100" \
  --jq '[.[] | select(.pull_request != null) | {number, title, url: .pull_request.html_url, body}]'
```

Drop the entry whose `number` equals that repo's `rcPrNumber`. For each remaining PR, extract the Shortcut story id by matching the title against this regex (case-insensitive, anchored at start, whitespace-tolerant):

```
^\s*\[sc-(\d+)\]
```

Keep, per PR: `owner`, `repo`, `number`, `title`, `url`, `body`, `storyId` (or `null`).

If every qualifying repo's milestone yields no child PRs, tell the user there were no child PRs in this week's release candidates and stop.

## Step 4 — Fetch Shortcut story details

Check for the API token:

```sh
printenv SHORTCUT_API_TOKEN >/dev/null && echo present || echo missing
```

Never print the value. If `missing`, tell the user: "`SHORTCUT_API_TOKEN` is not set — set it in your shell profile (`export SHORTCUT_API_TOKEN=...`) to include story descriptions. Continue with PR titles and diffs only?" Proceed based on their answer.

If `present`, for each PR with a non-null `storyId`:

```sh
curl -sS -w '\n%{http_code}' \
  "https://api.app.shortcut.com/api/v3/stories/{storyId}" \
  -H "Shortcut-Token: $SHORTCUT_API_TOKEN" \
  -H "Content-Type: application/json"
```

Parse the last line as HTTP status:
- `200` → read `name`, `description`, `story_type` (`feature` | `bug` | `chore`) from the JSON body.
- `401` → stop and warn "Shortcut token rejected — skipping story fetches." Fall back to PR-only for the rest.
- `404` → fall back for this PR only (story may have been deleted).
- anything else → fall back for this PR only; log the status code, not the body (may contain sensitive info).

### Fallback content (no story, failed fetch, or no `storyId`)

Use PR title + a truncated diff:

```sh
gh pr diff {number} --repo {owner}/{repo} | head -n 200
```

Use the diff only as context for drafting the bullet — never paste raw diff into the final summary.

## Step 5 — Filter and classify

Pool every child PR from every qualifying repo into a single set. For each PR, decide whether it belongs in a **Marketing/Sales summary**. Exclude:

- Shortcut `story_type == "chore"` with no user-visible surface change
- PRs titled with `chore:`, `refactor:`, `deps:`, `ci:`, `test:`, `build:`, `docs:` prefixes (conventional-commit style)
- Dependency bumps (titles matching `bump`, `update.*to v`, Dependabot/Renovate authorship)
- CI-only, infra-only, or internal-tooling changes evident from title/diff

Classify each kept PR:
- Shortcut `story_type == "feature"` → **New features**
- Shortcut `story_type == "bug"`, or title starts with `fix`/`bug` → **Bug fixes**
- Everything else → **Improvements**

This produces **one combined** set of three buckets spanning all repos — bullets are not grouped or labeled by repo.

If all PRs get filtered out, tell the user: "No customer-facing changes in this release" and stop (post nothing).

## Step 6 — Scan for PII

Before drafting, scan Shortcut descriptions and PR bodies for PII per org policy: names of real people (other than GitHub handles), email addresses, phone numbers, physical addresses, customer identifiers, financial/health data. If any are detected, stop immediately with: "This release data contains PII — please redact it before I can produce the summary." Do not draft, print, or post.

## Step 7 — Draft the summary

Determine `mergeDate` = the latest `mergedAt` across all included RC PRs, formatted `MM-DD-YYYY`.

Use Slack `mrkdwn` (not full Markdown): bold is `*single asterisks*`, `_italic_`, `- ` for bullets. Exact template — omit any empty section:

```
*Today's Release - What Went Live <mergeDate>*

*New features*
- <benefit-focused one-liner> (sc-<id>)
- ...

*Improvements*
- <benefit-focused one-liner> (sc-<id>)
- ...

*Bug fixes*
- <benefit-focused one-liner> (sc-<id>)
- ...
```

Drafting rules:
- **Lead with the customer benefit**, not the mechanism. _"Faster search on large datasets"_ beats _"Added Redis caching to QueryService"_.
- **No internal jargon, no file paths, no class names, no ticket IDs inline** — the `(sc-####)` parenthetical at the end of each line is the only ticket reference, and only when a story exists. For PRs without a story, omit the parenthetical entirely.
- **One bullet per PR** unless a single PR introduces genuinely distinct shipped capabilities.
- Keep each bullet under ~140 characters so it reads cleanly in Slack.
- Never invent functionality that isn't supported by the story description or PR content.

## Step 8 — Post to Slack

Post automatically to `#product-updates` — no approval step.

1. Resolve the channel once: call `mcp__claude_ai_Slack__slack_search_channels` with `query = "product-updates"` and match exactly on `name`. If there's no match, report the miss and stop.
2. Send via:

   ```
   mcp__claude_ai_Slack__slack_send_message
     channel_id: <resolved channel id>
     text:       <drafted summary>
   ```

Report success + permalink (if returned), or failure + reason. Do not retry a failed send automatically — surface the error to the user.

## Step 9 — Wrap up

Summarize to the user in one or two lines: which repos contributed to the release, the `mergeDate` posted in the title, and the destination with a permalink where available (or the failure reason).

## Guardrails

- **Never echo `SHORTCUT_API_TOKEN`** or any value fetched from `printenv` into output, errors, or logs. Redact even on failure.
- **PII stops the run** (Step 6). Do not attempt to auto-redact on the user's behalf — this is the one hard stop before posting.
- **Repos are skipped silently** when they have no current-week merged RC PR or are missing the `Tuesday Release Candidate` milestone. If no repo qualifies, nothing is posted.
- **Read-only until Step 8** — everything before the Slack post is safe to re-run.
- **If `gh` or `jq` is unavailable**, stop and tell the user — do not try to parse JSON by hand.
