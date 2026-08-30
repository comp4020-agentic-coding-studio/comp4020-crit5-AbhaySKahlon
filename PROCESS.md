# Process overview

## What I built

A hand-drawn downhill skiing game rendered on `<canvas>` with deterministic,
seed-based obstacle placement (no `Math.random()`, so a run is reproducible).
The skier steers left/right across three lanes, jumps with a debounced
edge-triggered key press, and has to clear single rocks, two-lane gates, and
full three-lane rock walls that can only be passed by jumping. A run ends in a
win or a wipeout, awards a distance-plus-clearance score, and keeps a local
top-5 leaderboard in `localStorage` across reloads.

## The moments that mattered

1. **Terrain/world consistency correction.** Early obstacle and slope math
   didn't agree with the parallax mountain layers, so lane positions drifted
   against the background at higher speeds. I reworked `slope.ts`'s
   world-to-screen conversion and the `state.ts` lane constants so obstacles,
   player, and terrain share one coordinate system. Checked by scrubbing a full
   run in the browser at multiple speeds and confirming lanes track straight
   against the mountain silhouette instead of sliding sideways.

2. **Obstacle difficulty progression and the three-rock wall.** I grouped
   obstacle entries at the same `distance` value into singles, two-lane gates,
   and full three-lane walls, spaced with increasing density down the course,
   so difficulty ramps rather than staying flat. The wall specifically requires
   a jump — `checkCollision` only clears an obstacle once
   `jumpProgress >= JUMP_CLEARS_AT`, regardless of lane, which is what makes
   jumping a wall's only valid response. Verified with a real-browser test that
   scripted a no-jump run into the wall (wipeout) against a timed-jump run
   through the same wall (survives), and cross-checked the obstacle course
   itself by importing `createGameState()` directly in Node to confirm wall
   positions in the generated course.

3. **Jump feel.** The first jump implementation let a held key repeatedly
   restart the jump arc, which made wall-clearing trivial and looked wrong.
   I made the jump edge-triggered (`jumpKeyWasDown` debounce in `physics.ts`)
   so a jump only starts on a fresh key press, with a fixed `JUMP_DURATION`
   and a sine-based `jumpProgress` arc. Confirmed by holding the jump key down
   during a run and watching the skier land and require a fresh press to jump
   again, then re-running the wall test above to confirm timing still clears.

4. **Score and local leaderboard.** Added `leaderboard.ts` (`saveScore`/
   `loadScores`, top-5, `localStorage` key `downhill.local-scores.v1`) and
   wired `main.ts` to save on win/loss and re-render the list. Verified two
   ways: a Node script that shims `globalThis.localStorage` and calls the real
   `saveScore` with seven scores to confirm correct top-5 truncation, and a
   browser test that seeds six scores, reloads the page, and confirms the UI
   and storage both show only the top five, descending.

5. **Visual/character iterations.** The skier went through several passes on
   the sketched art style (skis, jacket, scarf, arm/pole geometry) in
   `render.ts` to read clearly as a skier rather than a stick figure at
   gameplay scale, not just in close-up.

6. **A change that came directly from playing the finished game.** Playing a
   full run at real gameplay scale (not a zoomed-in screenshot) during final
   verification, the trailing arm and ski pole were legible in close-up crops
   but visually merged into the trailing leg/ski at actual size — the
   back-limb "shade" colors are all near-identical dark tones, and the old
   hand position landed almost exactly at hip height, in the same screen
   region as the back leg. I repositioned the grounded back arm's elbow/hand
   target higher and further back, into the shoulder/mid-back band, clear of
   the leg cluster — a contrast/positioning-only fix, no new poses or
   mechanics. Verified with `pnpm check` staying green and fresh screenshots
   at gameplay scale (not cropped) confirming both arms and poles read as
   distinct limbs, facing both directions and mid-air.

7. **Finishing touches from the finalization pass.** The link-preview card
   (`public/card.png`) and meta description were still the template's
   placeholders through most of development. Replaced the card with a real
   screenshot of the finished game and rewrote the description to describe
   the actual skiing/jumping/leaderboard game instead of a "stickman."

Commits: [`abeef32`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-AbhaySKahlon/commit/abeef32) (initial template), [`e1e9c7e`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-AbhaySKahlon/commit/e1e9c7e) (Astro conversion), [`b3be195`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-AbhaySKahlon/commit/b3be195) (harness carried forward from crit4), and the final commit completing the game (see the repo's commit history for its hash).

## Before you ship

`pnpm check` is green (typecheck, build, `oxlint`, `stylelint`, all vitest
specs) and `pnpm check:evidence` passes.
