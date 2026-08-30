import { createPlayerState, type PlayerPhysicsState } from "./physics";
import type { Obstacle } from "./collision";
import { HIT_X_RADIUS } from "./slope";

// Fixed distance and speed give every run the same length instead of an
// endless scroll, so the descent has a definite ending.
export const TOTAL_DISTANCE = 2200;
export const BASE_SPEED = 60;

const LANES = [-0.6, 0, 0.6];
// Close enough that the very first obstacle sits inside the side-view
// camera's forward view distance on the opening frame (see slope.ts's
// PX_PER_UNIT_RATIO), not just somewhere out past the horizon.
const OBSTACLE_START = 32;
const OBSTACLE_END = TOTAL_DISTANCE - 180;

// Deterministic pseudo-random in [0, 1) — every run lays out the same course
// (see TOTAL_DISTANCE above), so obstacle variety has to come from this, not
// Math.random(). Same shape as render.ts's hash(), kept local since layout
// and drawing have no reason to share a seed space.
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

// Gap between successive obstacle "moves" shrinks as the run goes on, but
// never below MIN_GAP. A full swing from one outer lane to the other takes
// ~55 world units at BASE_SPEED under physics.ts's steering accel/max speed;
// MIN_GAP leaves that plus a reaction beat, so a harder late-course pattern
// is still always physically clearable, never an unavoidable surprise.
const MAX_GAP = 170;
const MIN_GAP = 100;

function gapAt(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return MAX_GAP - (MAX_GAP - MIN_GAP) * clamped;
}

// One lane, avoiding an immediate repeat of the previous move's lane so
// holding a single direction can't carry a player through the whole run.
function pickLane(moveIndex: number, prevLane: number | null): number {
  const idx = Math.floor(hash(moveIndex * 3.7 + 1.1) * LANES.length) % LANES.length;
  const lane = LANES[idx];
  if (lane !== prevLane) return lane;
  return LANES[(idx + 1) % LANES.length];
}

// Two of the three lanes, leaving exactly one lane open — the player has to
// actually be in that lane, not just off to one side, since the lane gap
// (0.6) is well outside both the open lane's and the blocked lanes' hit
// radius (see slope.ts's HIT_LANE_RADIUS).
function pickGateLanes(moveIndex: number): number[] {
  const openIdx = Math.floor(hash(moveIndex * 5.9 + 2.3) * LANES.length) % LANES.length;
  return LANES.filter((_, i) => i !== openIdx);
}

// One entry per obstacle "move" (a single rock, a gate, or a wall), used only
// for scoring — buildObstacles already expands each move into its individual
// Obstacle records for collision, but scoring wants to award one bonus per
// pattern cleared, not one per rock within it.
export type ObstacleKind = "single" | "gate" | "wall";

export interface ObstacleMove {
  distance: number;
  kind: ObstacleKind;
}

function buildObstacles(): { obstacles: Obstacle[]; moves: ObstacleMove[] } {
  const obstacles: Obstacle[] = [];
  const moves: ObstacleMove[] = [];
  const span = OBSTACLE_END - OBSTACLE_START;
  let id = 0;
  let distance = OBSTACLE_START;
  let moveIndex = 0;
  let prevLane: number | null = null;
  let prevWasWall = false;
  while (distance <= OBSTACLE_END) {
    const progress = (distance - OBSTACLE_START) / span;
    const roll = hash(moveIndex * 17.3 + 4.1);

    let lanes: number[];
    if (progress < 0.15) {
      // Warm-up stretch: single rocks only, so the pattern vocabulary is
      // established before anything harder shows up.
      lanes = [pickLane(moveIndex, prevLane)];
    } else if (progress < 0.45) {
      lanes = roll < 0.65 ? [pickLane(moveIndex, prevLane)] : pickGateLanes(moveIndex);
    } else if (prevWasWall || roll < 0.5) {
      // Never two forced-jump walls back to back.
      lanes = [pickLane(moveIndex, prevLane)];
    } else if (roll < 0.85) {
      lanes = pickGateLanes(moveIndex);
    } else {
      lanes = [...LANES];
    }

    for (const lane of lanes) {
      obstacles.push({ id, distance, lane });
      id += 1;
    }
    const kind: ObstacleKind = lanes.length === 1 ? "single" : lanes.length === 2 ? "gate" : "wall";
    moves.push({ distance, kind });
    prevLane = lanes.length === 1 ? lanes[0] : null;
    prevWasWall = lanes.length === LANES.length;

    distance += gapAt(progress);
    moveIndex += 1;
  }
  return { obstacles, moves };
}

export type GameStatus = "playing" | "lost" | "won";

export interface GameState {
  status: GameStatus;
  distanceTraveled: number;
  player: PlayerPhysicsState;
  obstacles: Obstacle[];
  moves: ObstacleMove[];
  nextMoveIndex: number;
  hitObstacleId: number | null;
  // Points earned for clearing obstacle moves, on top of the distance-based
  // score computed by totalScore() below.
  bonusScore: number;
}

export function createGameState(): GameState {
  const { obstacles, moves } = buildObstacles();
  return {
    status: "playing",
    distanceTraveled: 0,
    player: createPlayerState(),
    obstacles,
    moves,
    nextMoveIndex: 0,
    hitObstacleId: null,
    bonusScore: 0,
  };
}

// One point per world unit travelled — this is also the "survival" part of
// the score: a run that ends early simply stops earning it sooner.
const DISTANCE_POINTS_PER_UNIT = 1;

// Bigger for patterns that demand more than a sidestep, biggest for the
// forced-jump wall — "especially a jump" per the brief.
const CLEAR_BONUS: Record<ObstacleKind, number> = { single: 10, gate: 25, wall: 50 };

export function totalScore(state: GameState): number {
  return Math.floor(state.distanceTraveled * DISTANCE_POINTS_PER_UNIT) + state.bonusScore;
}

// Awards the clear bonus for any move the player has now fully passed without
// colliding with it. Safe to call every tick regardless of outcome: a move
// the player just collided with can never satisfy the "passed its far edge"
// check below, since a collision can only fire strictly inside that same hit
// radius (see collision.ts's isAtObstacleX) and distanceTraveled stops
// advancing the instant the run ends.
export function updateScore(state: GameState): void {
  while (
    state.nextMoveIndex < state.moves.length &&
    state.distanceTraveled > state.moves[state.nextMoveIndex].distance + HIT_X_RADIUS
  ) {
    state.bonusScore += CLEAR_BONUS[state.moves[state.nextMoveIndex].kind];
    state.nextMoveIndex += 1;
  }
}
