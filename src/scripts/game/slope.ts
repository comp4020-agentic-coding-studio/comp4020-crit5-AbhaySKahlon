// Shared side-view slope geometry. render.ts (what gets drawn) and
// collision.ts (what counts as a hit) both derive position from these same
// functions/constants, so a hit can only fire where a rock is actually drawn
// touching the stickman. Everything here is plain math — no canvas, no DOM —
// so collision.ts can stay pure and testable.
//
// The world is one continuous curve, groundYRatioAt(worldX), that always
// descends as worldX increases: a real downhill slope, not a flat road and
// not a perspective vanishing point. The camera rides along it — the player
// is always drawn at a fixed screen anchor, and everything else's screen
// position is its own position *relative* to the player's — which is why the
// whole mountainside visibly slides past, down and to the left, as the
// player moves forward, instead of the player moving across a static scene.

export const PLAYER_SCREEN_X_RATIO = 0.26;
export const PLAYER_SCREEN_Y_RATIO = 0.48;

// Horizontal scroll speed, expressed as a multiple of canvas *height* (not
// width) so it cancels cleanly against the height-based hit radii below at
// any aspect ratio — see HIT_X_RADIUS.
export const PX_PER_UNIT_RATIO = 0.009;

export function pxPerUnitX(canvasHeight: number): number {
  return canvasHeight * PX_PER_UNIT_RATIO;
}

// The slope's shape: a steady descent, plus a gentle roll that never
// outweighs the descent (rippleAmplitude * rippleFrequency < dropPerUnit
// below), so the ground is always heading downhill — never flat, never
// uphill — while still looking like a real mountainside rather than a ramp.
const DROP_PER_UNIT_RATIO = 0.0018;
const RIPPLE_AMPLITUDE_RATIO = 0.01;
const RIPPLE_FREQUENCY = (Math.PI * 2) / 90;

export function groundYRatioAt(worldX: number): number {
  return worldX * DROP_PER_UNIT_RATIO + Math.sin(worldX * RIPPLE_FREQUENCY) * RIPPLE_AMPLITUDE_RATIO;
}

// Lanes are a perpendicular offset across the *width* of the slope — steering
// toward the uphill or downhill edge of the piste — not a separate road.
// Every lane is a point on the same descending ground curve above.
export const LANE_GAP_RATIO = 0.16;

export function groundScreenX(
  worldX: number,
  distanceTraveled: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  return canvasWidth * PLAYER_SCREEN_X_RATIO + (worldX - distanceTraveled) * pxPerUnitX(canvasHeight);
}

export function groundScreenY(
  worldX: number,
  lane: number,
  distanceTraveled: number,
  canvasHeight: number,
): number {
  const relative = groundYRatioAt(worldX) - groundYRatioAt(distanceTraveled);
  return canvasHeight * (PLAYER_SCREEN_Y_RATIO + relative + lane * LANE_GAP_RATIO);
}

// Both the stickman and the rock are drawn with a radius equal to their ratio
// times canvasHeight, so a hit can only fire where the drawn shapes actually
// overlap on screen, at any resolution: canvasHeight cancels out of both the
// screen-pixel touch distance and these ratios, leaving the two world-space
// constants below with no per-frame canvas dependency at all.
export const PLAYER_RADIUS_RATIO = 0.035;
export const OBSTACLE_RADIUS_RATIO = 0.04;
const RADIUS_RATIO_SUM = PLAYER_RADIUS_RATIO + OBSTACLE_RADIUS_RATIO;

// RADIUS_RATIO_SUM / PX_PER_UNIT_RATIO: the world-x distance whose on-screen
// extent (radius_ratio_sum * canvasHeight) equals the drawn combined radius,
// at any canvasHeight (it cancels). Likewise for lane distance below.
export const HIT_X_RADIUS = RADIUS_RATIO_SUM / PX_PER_UNIT_RATIO;
export const HIT_LANE_RADIUS = RADIUS_RATIO_SUM / LANE_GAP_RATIO;
