# Canvas Loop Engine Test Plan

_Last updated: 2026-06-27._

## Test lab storage

Assume the owner has a 4TB external drive dedicated to repeatable media testing.

```text
CanvasLoopLab/
  inputs/
  frames/
  previews/
  exports/
  ai-outputs/
  reports/
  failures/
  benchmarks/
```

## Test categories

- Dancing clips
- Smoke/mist clips
- Lightning/storm clips
- AI-generated clips
- Abstract motion clips
- Performance clips
- Fast motion clips
- Slow motion clips

## Tracking fields

Each test run should write a report row containing:

| Field | Purpose |
| --- | --- |
| Input file | Source clip path or fixture ID. |
| Selected anchor time | Creator-selected loop return timestamp. |
| Selected end time | Candidate end timestamp chosen by the engine or tester. |
| Loop duration | End time minus anchor time, excluding any ping-pong reverse segment. |
| Loop score | Composite score plus component scores when available. |
| Processing time | Import, analysis, preview, and final export timings. |
| Export file size | Final MP4 size. |
| Method used | Direct cut, crossfade, ping-pong, local repair, AI repair. |
| API cost if applicable | Provider, model ID, generated seconds, and cost estimate. |
| Human rating | 1-5 rating for loop smoothness and post-worthiness. |
| Failure mode | Cut, jump, drift, crop issue, FFmpeg failure, provider block, cost, timeout, artifact. |

## Manual evaluation rubric

- 5: feels intentionally seamless and ready to post.
- 4: minor seam visible only when watching repeatedly.
- 3: usable draft; seam noticeable but acceptable for some content.
- 2: obvious jump or awkward motion reversal.
- 1: broken export, wrong crop, or unusable visual artifact.

## Benchmark plan

- Run the same fixture set on at least two ordinary non-GPU desktop/laptop environments.
- Record CPU model, RAM, OS, source resolution, source FPS, and FFmpeg source.
- Keep low-resolution preview benchmarks separate from final export benchmarks.
- Compare local-only methods before enabling any AI-provider path.

## Failure archive

Save failures with:

- source fixture ID;
- generated preview/export;
- anchor frame image;
- selected end frame image;
- report JSON/CSV row;
- short human note explaining why the result failed.

Failures are product assets: they should drive scoring improvements and provider prompts.
