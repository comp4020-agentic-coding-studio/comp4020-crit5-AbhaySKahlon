// Deterministic player movement: given the same input state and dt every
// frame, the output is the same every run. No randomness, no wall-clock reads.

export const STEER_ACCEL = 3;
export const STEER_FRICTION = 4;
export const MAX_LANE_SPEED = 2.2;
export const LANE_LIMIT = 1;
// Longer than a snappy hop — paired with a taller arc in render.ts — so the
// player clearly leaves the ground and clears the three-lane wall instead of
// a quick, barely-there flick.
export const JUMP_DURATION = 0.7;

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface PlayerPhysicsState {
  lane: number;
  laneVelocity: number;
  jumpTimer: number;
  jumpProgress: number;
  // Tracks whether the jump input was already down last step, so a jump
  // starts only on a fresh press. Without this, holding the key would chain
  // jumps almost back-to-back (collision clears regardless of lane while
  // airborne — see collision.ts), which would trivialize every gate and wall
  // instead of just the one the player timed a jump for.
  jumpKeyWasDown: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createPlayerState(): PlayerPhysicsState {
  return { lane: 0, laneVelocity: 0, jumpTimer: 0, jumpProgress: 0, jumpKeyWasDown: false };
}

export function stepPlayer(
  player: PlayerPhysicsState,
  input: InputState,
  dt: number,
): PlayerPhysicsState {
  let laneVelocity = player.laneVelocity;
  if (input.left) laneVelocity -= STEER_ACCEL * dt;
  if (input.right) laneVelocity += STEER_ACCEL * dt;
  if (!input.left && !input.right && laneVelocity !== 0) {
    const drop = Math.min(Math.abs(laneVelocity), STEER_FRICTION * dt);
    laneVelocity -= Math.sign(laneVelocity) * drop;
  }
  laneVelocity = clamp(laneVelocity, -MAX_LANE_SPEED, MAX_LANE_SPEED);

  let lane = clamp(player.lane + laneVelocity * dt, -LANE_LIMIT, LANE_LIMIT);
  if (lane <= -LANE_LIMIT || lane >= LANE_LIMIT) laneVelocity = 0;

  let jumpTimer = player.jumpTimer;
  const jumpPressed = input.jump && !player.jumpKeyWasDown;
  if (jumpTimer <= 0 && jumpPressed) {
    jumpTimer = dt;
  } else if (jumpTimer > 0) {
    jumpTimer += dt;
  }
  if (jumpTimer > JUMP_DURATION) jumpTimer = 0;

  const jumpProgress = jumpTimer > 0 ? Math.sin((jumpTimer / JUMP_DURATION) * Math.PI) : 0;

  return { lane, laneVelocity, jumpTimer, jumpProgress, jumpKeyWasDown: input.jump };
}
