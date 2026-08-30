import type { GameState } from "./state";
import { MAX_LANE_SPEED } from "./physics";
import {
  PLAYER_SCREEN_X_RATIO,
  pxPerUnitX,
  groundScreenX,
  groundScreenY,
  PLAYER_RADIUS_RATIO,
  OBSTACLE_RADIUS_RATIO,
} from "./slope";

// Hand-drawn cartoon snowscape. Every decorative shape below (mountains,
// trees, snow texture, clouds, the player's spray trail) is placed by a pure
// function of world-x/distanceTraveled — never Math.random() or wall-clock
// time — so the "sketchy" look is reproducible frame to frame and the whole
// scene scrolls as one consistent world instead of independently-animated
// layers. The slope's own geometry (fill boundary, obstacle/player position)
// still comes straight from slope.ts: everything drawn on top of it is a
// cosmetic ink line or mound, never the collision surface itself.

const SKY_TOP = "#544674";
const SKY_HORIZON = "#f3d9e8";
const LINE = "#201c29";
const SNOW_LIGHT = "#ffffff";
const SNOW_SHADOW = "#d7ddf5";
const MOUNTAIN_FAR = "#a998c9";
const MOUNTAIN_NEAR = "#6d5f8f";
const MOUNTAIN_FOOTHILL = "#8c7fac";
const ROCK_FILL = "#767b87";
const ROCK_DARK = "#4c4f59";
const TREE_GREEN = "#3f6b52";
const TREE_GREEN_DARK = "#2c4d3a";
const TRUNK = "#5c4632";

// The skier's costume — a small, fixed palette (never randomized) so the
// figure reads as one consistent character every frame.
const SKIER_FACE = "#fbf5ee";
const SKIER_HAIR = "#211b26";
const SKIER_JACKET = "#232838";
const SKIER_JACKET_SHADE = "#171a24";
const SKIER_PANTS = "#e0932f";
const SKIER_PANTS_SHADE = "#b5721c";
const SKIER_SCARF = "#d94f3c";
const SKIER_GLOVE = "#171a24";
const SKIER_LEG = "#2c2f3a";
const SKIER_LEG_SHADE = "#1c1e26";
const SKI_COLOR = "#181b24";
const SKI_STRIPE = "#e0932f";

const MAX_TILT_ANGLE = 0.3;
const DOWNHILL_LEAN_ANGLE = 0.22;
// Legs stay in a fixed, bent ski stance while grounded (see drawLeg) — this
// only drives a slow, whole-body weight-shift bob, never an alternating
// stride, so the figure never looks like it's running on its skis.
const WEIGHT_SHIFT_FREQ = 0.05;
// Arms still swing for a natural balance/poling motion while grounded —
// independent of the (now static) leg stance.
const ARM_SWING_FREQ = 0.14;

// The visible width of the piste, in lane-offset units, beyond the reachable
// ±0.6 lane range — purely a decorative margin, never reachable.
const TOP_EDGE_LANE = -0.85;
const BOTTOM_EDGE_LANE = 0.85;
// A fixed world-x lattice (not a fixed sample *count* spread across the
// dynamic visible window) — see LAYER_SAMPLE_STEP above for why: the same
// absolute worldX values must be reused every frame so the piste's wobble
// line only translates, never reshapes.
const GROUND_SAMPLE_STEP = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Deterministic pseudo-random in [0, 1) from any number — gives every hand-
// drawn wobble, tree, and snow fleck a fixed shape/position tied to world-x
// or a stable id, so nothing flickers or reshuffles between frames.
function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

// Continuous terrain detail: interpolates between hash() values pinned to a
// fixed world-x lattice, instead of jumping between them at a lattice
// boundary. A raw `hash(Math.floor(worldX * freq))` is a step function — fine
// if you always sample the exact same worldX, but every curve below is
// resampled at a slightly different worldX each frame (the visible window
// slides continuously with distanceTraveled, not in lattice-sized jumps), so
// a step function there means a sample can land on either side of a step
// boundary from one frame to the next, redrawing the silhouette instead of
// sliding it. Interpolating removes the discontinuity a drifting sample phase
// could ever catch.
function smoothNoise1D(worldX: number, lattice: number, seed: number): number {
  const t = worldX / lattice;
  const i0 = Math.floor(t);
  const frac = t - i0;
  const a = hash(i0 + seed);
  const b = hash(i0 + 1 + seed);
  const eased = frac * frac * (3 - 2 * frac);
  return a + (b - a) * eased;
}

// Snaps down to the nearest multiple of `step` at or below `value` — used so
// a sampled curve always lands on the same fixed world-x grid regardless of
// where the currently-visible window happens to start, so scrolling only
// ever translates the drawn points rather than resampling new ones.
function gridFloor(value: number, step: number): number {
  return Math.floor(value / step) * step;
}

// The world-x span currently on screen, so the ground and obstacles are only
// built/drawn across what a viewer could actually see this frame.
function visibleWorldRange(
  distanceTraveled: number,
  width: number,
  height: number,
): [number, number] {
  const spanWorld = width / pxPerUnitX(height);
  const start = distanceTraveled - PLAYER_SCREEN_X_RATIO * spanWorld;
  const end = distanceTraveled + (1 - PLAYER_SCREEN_X_RATIO) * spanWorld;
  return [start, end];
}

// A short, slightly-bowed stroke instead of a perfectly straight line — the
// "drawn by hand" imperfection on every limb, ski and rock edge. The bow is
// keyed to `seed`, not time, so a given edge always bows the same way.
function sketchyLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = (hash(seed) - 0.5) * len * 0.12;
  const mx = (x1 + x2) / 2 + nx * bow;
  const my = (y1 + y2) / 2 + ny * bow;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.stroke();
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_HORIZON);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  drawClouds(ctx, width, height, state.distanceTraveled);

  drawMountainLayer(ctx, width, height, state.distanceTraveled, FAR_LAYER);
  ctx.save();
  ctx.globalAlpha = 0.55;
  drawLayerTrees(ctx, width, height, state.distanceTraveled, FAR_LAYER, 150, 0.032, 71);
  ctx.restore();

  drawMountainLayer(ctx, width, height, state.distanceTraveled, NEAR_LAYER);
  drawLayerTrees(ctx, width, height, state.distanceTraveled, NEAR_LAYER, 80, 0.05, 17);

  drawMountainLayer(ctx, width, height, state.distanceTraveled, FOOTHILL_LAYER);

  drawGround(ctx, width, height, state.distanceTraveled);
  drawSkiTracks(ctx, width, height, state.distanceTraveled, state.player.lane);
  drawEdgeDecor(ctx, width, height, state.distanceTraveled);

  const [worldStart, worldEnd] = visibleWorldRange(state.distanceTraveled, width, height);
  for (const obstacle of state.obstacles) {
    if (obstacle.distance < worldStart || obstacle.distance > worldEnd) continue;
    const x = groundScreenX(obstacle.distance, state.distanceTraveled, width, height);
    const y = groundScreenY(obstacle.distance, obstacle.lane, state.distanceTraveled, height);
    const radius = OBSTACLE_RADIUS_RATIO * height;
    drawShadow(ctx, x, y, radius);
    drawRock(ctx, x, y, radius, obstacle.id);
  }

  // The player is always drawn at the same fixed screen anchor — it's the
  // world that scrolls past them, not the other way round.
  const playerX = groundScreenX(state.distanceTraveled, state.distanceTraveled, width, height);
  const playerGroundY = groundScreenY(state.distanceTraveled, state.player.lane, state.distanceTraveled, height);
  // Tall enough that the whole figure (including the skis, see drawSkis)
  // clears a rock's drawn peak (~0.07 * height, see drawRock's h) with room
  // to spare, instead of a hop barely taller than the rock it's meant to
  // clear.
  const hop = state.player.jumpProgress * height * 0.16;
  const playerRadius = PLAYER_RADIUS_RATIO * height;

  drawSnowSpray(
    ctx,
    width,
    height,
    state.distanceTraveled,
    state.player.lane,
    playerRadius,
    state.player.jumpProgress,
  );
  drawShadow(ctx, playerX, playerGroundY, playerRadius * (1 - state.player.jumpProgress * 0.3));
  drawMotionLines(ctx, playerX, playerGroundY - hop, playerRadius, state.distanceTraveled);
  drawSkier(
    ctx,
    playerX,
    playerGroundY - hop,
    playerGroundY,
    playerRadius,
    state.player,
    state.distanceTraveled,
  );

  drawAmbientSnow(ctx, width, height, state.distanceTraveled);

  if (state.status === "lost") {
    ctx.fillStyle = "rgba(200, 40, 40, 0.28)";
    ctx.fillRect(0, 0, width, height);
  } else if (state.status === "won") {
    ctx.fillStyle = "rgba(255, 205, 60, 0.28)";
    ctx.fillRect(0, 0, width, height);
  }
}

// --- sky dressing ----------------------------------------------------------

function drawPuffCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  const blobs: [number, number, number, number][] = [
    [0, 0, 1.3, 0.6],
    [-0.9, 0.15, 0.8, 0.45],
    [0.9, 0.1, 0.9, 0.5],
  ];
  for (const [dx, dy, rx, ry] of blobs) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.3, y);
  ctx.quadraticCurveTo(x, y - s * 0.5, x + s * 0.4, y - s * 0.1);
  ctx.quadraticCurveTo(x + s * 0.1, y + s * 0.3, x - s * 0.2, y + s * 0.05);
  ctx.stroke();
}

// A thin, brush-stroke swoosh of cloud (three stacked curved strokes)
// alongside the puffier cumulus shapes — the mix of the two reads closer to
// hand-painted sky than one repeated cloud silhouette.
function drawWispyCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, s * 0.14);
  for (let i = 0; i < 3; i += 1) {
    const yOff = (i - 1) * s * 0.22;
    ctx.beginPath();
    ctx.moveTo(x - s * (1.1 - i * 0.15), y + yOff);
    ctx.quadraticCurveTo(x, y + yOff - s * 0.25, x + s * (1.1 - i * 0.15), y + yOff + s * 0.05);
    ctx.stroke();
  }
}

function drawClouds(ctx: CanvasRenderingContext2D, width: number, height: number, distanceTraveled: number): void {
  const span = width * 1.6;
  const drift = distanceTraveled * 0.4;
  const positions: [number, number, number, "puff" | "wisp"][] = [
    [0.15, 0.16, 1, "puff"],
    [0.62, 0.1, 0.7, "wisp"],
    [0.85, 0.24, 0.55, "puff"],
    [0.38, 0.07, 0.5, "wisp"],
  ];
  for (const [xFrac, yFrac, scale, kind] of positions) {
    const raw = ((xFrac * span - drift) % span + span) % span;
    const x = raw - span * 0.3;
    if (kind === "puff") drawPuffCloud(ctx, x, height * yFrac, height * 0.09 * scale);
    else drawWispyCloud(ctx, x, height * yFrac, height * 0.09 * scale);
  }
}

// --- layered background mountains ---------------------------------------
// Each layer is a continuous ridge-height function plus a fixed parallax
// speed and a fixed world-to-screen span. Trees anchor to a layer's own
// ridgeYRatioAt at the exact same worldX used to draw that layer's silhouette
// (see drawLayerTrees), so a tree's base can never land anywhere but on the
// ridge line that is actually on screen — the fix for trees that used to
// float free of the drawn terrain.

interface MountainLayer {
  ridgeYRatioAt: (worldX: number) => number;
  parallax: number;
  snowlineRatio: number;
  fill: string;
}

const LAYER_WORLD_SPAN = 900;

function farRidgeYRatioAt(worldX: number): number {
  const t = worldX * 0.01;
  const jag = (smoothNoise1D(worldX, 1 / 0.12, 11) - 0.5) * 0.015;
  // A rare, tall, narrow spike (high-exponent pow of a low-frequency sine)
  // in addition to the rolling ridge — one dramatic peak silhouette per
  // stretch, like the reference's single jagged summit, rather than a
  // uniformly wavy skyline. Purely a function of worldX, so it's fixed
  // world geometry that only ever scrolls, never reshapes.
  const spike = Math.pow(Math.max(0, Math.sin(worldX * 0.0027 + 0.6)), 10) * 0.16;
  return 0.4 + Math.sin(t) * 0.05 + Math.sin(t * 2.3 + 1.7) * 0.02 + jag - spike;
}

function nearRidgeYRatioAt(worldX: number): number {
  const t = worldX * 0.025;
  const jag = (smoothNoise1D(worldX, 1 / 0.3, 37) - 0.5) * 0.05;
  const spike = Math.pow(Math.max(0, Math.sin(worldX * 0.0041 + 2.1)), 12) * 0.1;
  return 0.55 + Math.sin(t) * 0.06 + jag - spike;
}

function foothillRidgeYRatioAt(worldX: number): number {
  const t = worldX * 0.018;
  const jag = (smoothNoise1D(worldX, 1 / 0.5, 53) - 0.5) * 0.02;
  return 0.72 + Math.sin(t) * 0.03 + jag;
}

const FAR_LAYER: MountainLayer = { ridgeYRatioAt: farRidgeYRatioAt, parallax: 0.15, snowlineRatio: 0.55, fill: MOUNTAIN_FAR };
const NEAR_LAYER: MountainLayer = { ridgeYRatioAt: nearRidgeYRatioAt, parallax: 0.35, snowlineRatio: 0.68, fill: MOUNTAIN_NEAR };
const FOOTHILL_LAYER: MountainLayer = {
  ridgeYRatioAt: foothillRidgeYRatioAt,
  parallax: 0.6,
  snowlineRatio: 0.94,
  fill: MOUNTAIN_FOOTHILL,
};

// One fixed world-x lattice per layer (roughly 40 points across a span), so
// the same absolute worldX values get sampled every frame — only their
// screen-x (via the offset below) slides. Previously this sampled 40 *fixed
// screen fractions* and derived worldX from them, which meant the offset
// (distanceTraveled * parallax) shifted the sampled worldX continuously
// every frame — a screen-space sampling grid on top of world-space terrain,
// which is exactly what let the ridge line's silhouette visibly reshape
// instead of just scroll.
const LAYER_SAMPLE_STEP = LAYER_WORLD_SPAN / 40;

function drawMountainLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
  layer: MountainLayer,
): void {
  const offset = distanceTraveled * layer.parallax;
  const worldEnd = offset + LAYER_WORLD_SPAN;
  const pts: [number, number][] = [];
  for (
    let worldX = gridFloor(offset, LAYER_SAMPLE_STEP);
    worldX <= worldEnd + LAYER_SAMPLE_STEP;
    worldX += LAYER_SAMPLE_STEP
  ) {
    const x = (width * (worldX - offset)) / LAYER_WORLD_SPAN;
    const y = height * layer.ridgeYRatioAt(worldX);
    pts.push([x, y]);
  }

  ctx.fillStyle = layer.fill;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], height);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.lineTo(pts[pts.length - 1][0], height);
  ctx.closePath();
  ctx.fill();

  // Snow caps: a lighter fill above each ridge's local snowline.
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], height * layer.snowlineRatio);
  for (const [x, y] of pts) ctx.lineTo(x, Math.min(y, height * layer.snowlineRatio));
  ctx.lineTo(pts[pts.length - 1][0], height * layer.snowlineRatio);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// --- pine trees, grounded to a specific mountain layer's own ridge line --

function drawPineTree(ctx: CanvasRenderingContext2D, x: number, groundY: number, size: number): void {
  const trunkH = size * 0.35;
  ctx.fillStyle = TRUNK;
  ctx.fillRect(x - size * 0.06, groundY - trunkH, size * 0.12, trunkH);

  for (let tier = 0; tier < 3; tier += 1) {
    const w = size * (0.9 - tier * 0.22);
    const topY = groundY - trunkH - size * 0.35 - tier * size * 0.32;
    const botY = topY + size * 0.42;
    ctx.fillStyle = tier === 2 ? TREE_GREEN : TREE_GREEN_DARK;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x - w / 2, botY);
    ctx.lineTo(x + w / 2, botY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  ctx.fillStyle = SNOW_LIGHT;
  const capTopY = groundY - trunkH - size * 0.35;
  const capW = size * 0.9 * 0.32;
  ctx.beginPath();
  ctx.moveTo(x, capTopY);
  ctx.lineTo(x - capW / 2, capTopY + size * 0.16);
  ctx.lineTo(x + capW / 2, capTopY + size * 0.16);
  ctx.closePath();
  ctx.fill();

  // A small drift of snow at the base ties the trunk to the ground it stands
  // on instead of leaving it touching the ridge line at a single point.
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.ellipse(x, groundY, size * 0.22, size * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Places trees along ONE mountain layer's own ridge curve, at the exact
// worldX/parallax that layer is drawn with — so a tree's base always lands
// exactly on that layer's visible silhouette, never in the sky above or
// below it. `salt` keeps each layer's tree placement independent of the
// others despite sharing the same hash() function.
function drawLayerTrees(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
  layer: MountainLayer,
  slotSize: number,
  sizeRatio: number,
  salt: number,
): void {
  const offset = distanceTraveled * layer.parallax;
  const startSlot = Math.floor(offset / slotSize) - 1;
  const endSlot = Math.ceil((offset + LAYER_WORLD_SPAN) / slotSize) + 1;
  for (let slot = startSlot; slot <= endSlot; slot += 1) {
    if (hash(slot * 3.1 + salt) < 0.35) continue;
    const worldX = slot * slotSize + hash(slot * 7.7 + salt) * slotSize * 0.7;
    const screenXFrac = (worldX - offset) / LAYER_WORLD_SPAN;
    if (screenXFrac < -0.05 || screenXFrac > 1.05) continue;
    const x = screenXFrac * width;
    const y = height * layer.ridgeYRatioAt(worldX);
    const scale = 0.7 + hash(slot * 4.3 + salt) * 0.7;
    drawPineTree(ctx, x, y, height * sizeRatio * scale);
  }
}

// --- the slope itself -----------------------------------------------------
// A continuous descending curve, sampled across the visible world-x span and
// drawn as a filled ribbon (the piste) on top of a solid mountain body that
// runs down to the bottom of the canvas — a real cross-section, not a
// trapezoid narrowing toward a vanishing point. The exact fill boundary comes
// straight from slope.ts; everything drawn over it (wobble line, contours,
// hatching, highlight) is cosmetic only, keyed to worldX so it stays put as
// the world scrolls. Because this is drawn after the background layers, its
// fill naturally occludes the lower portion of any tree/mountain shape that
// falls within its silhouette — the "partially occluded by terrain" look.
function drawGround(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
): void {
  const [worldStart, worldEnd] = visibleWorldRange(distanceTraveled, width, height);
  const topPts: [number, number][] = [];
  const bottomPts: [number, number][] = [];
  const wobbledTopPts: [number, number][] = [];
  for (
    let worldX = gridFloor(worldStart, GROUND_SAMPLE_STEP);
    worldX <= worldEnd + GROUND_SAMPLE_STEP;
    worldX += GROUND_SAMPLE_STEP
  ) {
    const x = groundScreenX(worldX, distanceTraveled, width, height);
    const topY = groundScreenY(worldX, TOP_EDGE_LANE, distanceTraveled, height);
    topPts.push([x, topY]);
    bottomPts.push([x, groundScreenY(worldX, BOTTOM_EDGE_LANE, distanceTraveled, height)]);
    const wobble = (smoothNoise1D(worldX, 1 / 3, 5) - 0.5) * height * 0.01;
    wobbledTopPts.push([x, topY + wobble]);
  }

  ctx.fillStyle = MOUNTAIN_NEAR;
  ctx.beginPath();
  ctx.moveTo(bottomPts[0][0], bottomPts[0][1]);
  for (const [x, y] of bottomPts) ctx.lineTo(x, y);
  ctx.lineTo(bottomPts[bottomPts.length - 1][0], height);
  ctx.lineTo(bottomPts[0][0], height);
  ctx.closePath();
  ctx.fill();

  const snow = ctx.createLinearGradient(0, topPts[0][1], 0, bottomPts[bottomPts.length - 1][1]);
  snow.addColorStop(0, SNOW_LIGHT);
  snow.addColorStop(1, SNOW_SHADOW);
  ctx.fillStyle = snow;
  ctx.beginPath();
  ctx.moveTo(topPts[0][0], topPts[0][1]);
  for (const [x, y] of topPts) ctx.lineTo(x, y);
  for (let i = bottomPts.length - 1; i >= 0; i -= 1) ctx.lineTo(bottomPts[i][0], bottomPts[i][1]);
  ctx.closePath();
  ctx.fill();

  drawSnowContours(ctx, width, height, distanceTraveled, worldStart, worldEnd);
  drawSnowTexture(ctx, width, height, distanceTraveled);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(2.5, height * 0.006);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(wobbledTopPts[0][0], wobbledTopPts[0][1]);
  for (const [x, y] of wobbledTopPts) ctx.lineTo(x, y);
  ctx.stroke();

  // A thin bright highlight just under the ink line reads as the sunlit
  // edge of the snow instead of a flat single-tone ribbon.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1, height * 0.0025);
  ctx.beginPath();
  ctx.moveTo(wobbledTopPts[0][0], wobbledTopPts[0][1] + height * 0.008);
  for (const [x, y] of wobbledTopPts) ctx.lineTo(x, y + height * 0.008);
  ctx.stroke();
}

// Gentle rolling undulation, independent of the actual (monotonic) slope
// geometry, drawn as a few soft contour lines within the ribbon — small
// terrain bumps and drifts rather than one flat plane of snow.
function bumpOffsetRatio(worldX: number, phase: number): number {
  return Math.sin(worldX * 0.05 + phase) * 0.012 + Math.sin(worldX * 0.13 + phase * 1.7) * 0.006;
}

function drawSnowContours(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
  worldStart: number,
  worldEnd: number,
): void {
  const lanes = [-0.35, 0.1, 0.5];
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = Math.max(1, height * 0.003);
  lanes.forEach((lane, idx) => {
    ctx.beginPath();
    let started = false;
    for (
      let worldX = gridFloor(worldStart, GROUND_SAMPLE_STEP);
      worldX <= worldEnd + GROUND_SAMPLE_STEP;
      worldX += GROUND_SAMPLE_STEP
    ) {
      const bump = bumpOffsetRatio(worldX, idx * 2.1);
      const x = groundScreenX(worldX, distanceTraveled, width, height);
      const y = groundScreenY(worldX, lane, distanceTraveled, height) + bump * height;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  });
}

// Sparse hand-drawn hatch marks scattered across the piste — sketchy/painted
// shading instead of a flat fill, without costing more than a handful of
// short strokes per frame.
const HATCH_SLOT = 22;

function drawSnowTexture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
): void {
  const [worldStart, worldEnd] = visibleWorldRange(distanceTraveled, width, height);
  const startSlot = Math.floor(worldStart / HATCH_SLOT) - 1;
  const endSlot = Math.ceil(worldEnd / HATCH_SLOT) + 1;
  ctx.strokeStyle = "rgba(120, 130, 175, 0.4)";
  ctx.lineWidth = Math.max(1, height * 0.0025);
  for (let slot = startSlot; slot <= endSlot; slot += 1) {
    if (hash(slot * 5.3) < 0.45) continue;
    const worldX = slot * HATCH_SLOT + hash(slot * 1.7) * HATCH_SLOT;
    const lane = -0.55 + hash(slot * 2.9) * 1.1;
    const x = groundScreenX(worldX, distanceTraveled, width, height);
    const y = groundScreenY(worldX, lane, distanceTraveled, height);
    const len = height * 0.018;
    ctx.beginPath();
    ctx.moveTo(x - len * 0.3, y - len * 0.5);
    ctx.lineTo(x + len * 0.3, y + len * 0.5);
    ctx.stroke();
  }
}

// Two carved lines trailing behind the player at their current lane — a
// visible ski track pressed into the snow, not just a particle trail. Drawn
// straight onto the ground (before obstacles/player), so rocks and the
// player naturally paint over it where their paths cross.
const SKI_TRACK_WORLD_LENGTH = 60;
const SKI_TRACK_SAMPLES = 24;

function drawSkiTracks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
  playerLane: number,
): void {
  ctx.strokeStyle = "rgba(110, 120, 165, 0.55)";
  ctx.lineWidth = Math.max(1, height * 0.0032);
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= SKI_TRACK_SAMPLES; i += 1) {
      const worldX = distanceTraveled - (SKI_TRACK_WORLD_LENGTH * i) / SKI_TRACK_SAMPLES;
      if (worldX < 0) break;
      const wobble = (smoothNoise1D(worldX, 0.5, side * 13 + 3) - 0.5) * 0.015;
      const lane = playerLane + side * 0.045 + wobble;
      const x = groundScreenX(worldX, distanceTraveled, width, height);
      const y = groundScreenY(worldX, lane, distanceTraveled, height);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

// --- foreground edge dressing --------------------------------------------
// Trees, rocks and snow banks planted directly on the piste's own edge lanes
// (0.68-0.85, just past the reachable ±0.6 range) using the same
// groundScreenX/groundScreenY as the real slope geometry — so unlike the
// background mountain layers' trees, these sit literally grounded on the
// slope the player is skiing down, never in a lane an obstacle can occupy.

const EDGE_BANK_SLOT = 18;
const EDGE_ROCK_SLOT = 51;
const EDGE_TREE_SLOT = 34;

function drawSnowBank(ctx: CanvasRenderingContext2D, x: number, groundY: number, size: number): void {
  ctx.fillStyle = SNOW_LIGHT;
  ctx.beginPath();
  ctx.moveTo(x - size * 1.3, groundY);
  ctx.quadraticCurveTo(x - size * 0.6, groundY - size * 1.3, x, groundY - size * 1.1);
  ctx.quadraticCurveTo(x + size * 0.7, groundY - size * 0.9, x + size * 1.3, groundY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.2, size * 0.12);
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.strokeStyle = "rgba(150, 160, 200, 0.45)";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(x - size * 0.8, groundY - size * 0.35);
  ctx.quadraticCurveTo(x, groundY - size * 0.75, x + size * 0.75, groundY - size * 0.3);
  ctx.stroke();
}

function drawEdgeDecor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
): void {
  const [worldStart, worldEnd] = visibleWorldRange(distanceTraveled, width, height);

  const bankStart = Math.floor(worldStart / EDGE_BANK_SLOT) - 1;
  const bankEnd = Math.ceil(worldEnd / EDGE_BANK_SLOT) + 1;
  for (let slot = bankStart; slot <= bankEnd; slot += 1) {
    if (hash(slot * 6.1 + 201) < 0.3) continue;
    const worldX = slot * EDGE_BANK_SLOT + hash(slot * 2.4 + 201) * EDGE_BANK_SLOT;
    const side = hash(slot * 3.7 + 201) < 0.5 ? -1 : 1;
    const lane = side * (0.68 + hash(slot * 5.2 + 201) * 0.14);
    const x = groundScreenX(worldX, distanceTraveled, width, height);
    const y = groundScreenY(worldX, lane, distanceTraveled, height);
    const size = height * (0.022 + hash(slot * 8.8 + 201) * 0.018);
    drawSnowBank(ctx, x, y, size);
  }

  const rockStart = Math.floor(worldStart / EDGE_ROCK_SLOT) - 1;
  const rockEnd = Math.ceil(worldEnd / EDGE_ROCK_SLOT) + 1;
  for (let slot = rockStart; slot <= rockEnd; slot += 1) {
    if (hash(slot * 4.4 + 303) < 0.55) continue;
    const worldX = slot * EDGE_ROCK_SLOT + hash(slot * 1.9 + 303) * EDGE_ROCK_SLOT;
    const side = hash(slot * 2.6 + 303) < 0.5 ? -1 : 1;
    const lane = side * (0.7 + hash(slot * 7.1 + 303) * 0.1);
    const x = groundScreenX(worldX, distanceTraveled, width, height);
    const y = groundScreenY(worldX, lane, distanceTraveled, height);
    const radius = height * (0.018 + hash(slot * 3.3 + 303) * 0.012);
    drawRock(ctx, x, y, radius, slot * 9.9 + 303);
  }

  const treeStart = Math.floor(worldStart / EDGE_TREE_SLOT) - 1;
  const treeEnd = Math.ceil(worldEnd / EDGE_TREE_SLOT) + 1;
  for (let slot = treeStart; slot <= treeEnd; slot += 1) {
    if (hash(slot * 2.9 + 501) < 0.25) continue;
    const worldX = slot * EDGE_TREE_SLOT + hash(slot * 6.6 + 501) * EDGE_TREE_SLOT;
    const side = hash(slot * 4.1 + 501) < 0.5 ? -1 : 1;
    const lane = side * (0.72 + hash(slot * 5.9 + 501) * 0.12);
    const x = groundScreenX(worldX, distanceTraveled, width, height);
    const y = groundScreenY(worldX, lane, distanceTraveled, height);
    const scale = 0.6 + hash(slot * 8.2 + 501) * 0.9;
    drawPineTree(ctx, x, y, height * 0.075 * scale);
  }
}

// --- ambient particles ------------------------------------------------

function drawShadow(ctx: CanvasRenderingContext2D, x: number, groundY: number, radius: number): void {
  ctx.fillStyle = "rgba(20, 20, 20, 0.2)";
  ctx.beginPath();
  ctx.ellipse(x, groundY, radius, radius * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
}

// A spray of snow flecks trailing right behind the player's skis (using the
// same lane the player is in right now), hugging the ground so it reads as
// kicked-up snow rather than decoration floating near the figure. It fades
// out while airborne — skis clear of the snow can't kick any up — and comes
// back as the player settles onto the slope again.
function drawSnowSpray(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
  playerLane: number,
  playerRadius: number,
  jumpProgress: number,
): void {
  const groundedness = 1 - clamp(jumpProgress / 0.3, 0, 1);
  if (groundedness <= 0) return;
  const count = 9;
  for (let k = 1; k <= count; k += 1) {
    const worldX = distanceTraveled - k * 2.6;
    const jitterLane = (hash(Math.floor(worldX * 2)) - 0.5) * 0.16;
    const x = groundScreenX(worldX, distanceTraveled, width, height);
    const y =
      groundScreenY(worldX, playerLane + jitterLane, distanceTraveled, height) -
      hash(k * 9.1) * playerRadius * 0.3;
    const r = playerRadius * 0.24 * (1 - k / count);
    const alpha = 0.6 * (1 - k / count) * groundedness;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A few short streaks trailing the player to sell speed without needing the
// figure itself to change shape.
function drawMotionLines(
  ctx: CanvasRenderingContext2D,
  playerX: number,
  playerY: number,
  radius: number,
  distanceTraveled: number,
): void {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
  ctx.lineWidth = Math.max(1.5, radius * 0.12);
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i += 1) {
    const seed = i * 3.3 + Math.floor(distanceTraveled * 0.5);
    const len = radius * (0.9 + hash(seed) * 0.7);
    const yOff = radius * (-0.6 + i * 0.55);
    const x1 = playerX - radius * 1.3 - i * radius * 0.45;
    const y1 = playerY + yOff - radius * 0.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - len, y1 + len * 0.35);
    ctx.stroke();
  }
}

// A fixed set of screen-space flakes, each with a stable phase/speed picked
// once from hash() rather than Math.random(), drifting down and slightly
// sideways using distanceTraveled as the clock (it only advances while the
// run is live, same as everything else on screen).
const AMBIENT_FLAKE_COUNT = 22;
const AMBIENT_FLAKES = Array.from({ length: AMBIENT_FLAKE_COUNT }, (_, i) => ({
  xFrac: hash(i * 3.7),
  phase: hash(i * 9.2) * 2000,
  size: 1.4 + hash(i * 5.5) * 2.2,
  speed: 16 + hash(i * 2.3) * 14,
}));

function drawAmbientSnow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  distanceTraveled: number,
): void {
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  for (const flake of AMBIENT_FLAKES) {
    const y = (((flake.phase + distanceTraveled * flake.speed) % (height + 20)) + height + 20) % (height + 20) - 10;
    const sway = Math.sin((distanceTraveled + flake.phase) * 0.03) * width * 0.015;
    const x = flake.xFrac * width + sway;
    ctx.beginPath();
    ctx.arc(x, y, flake.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- obstacles --------------------------------------------------------

// A jagged, slightly irregular silhouette instead of a clean triangle, plus a
// crack line and a two-tone fill — sketchy/painted shading rather than a flat
// geometric shape. The shape is stable per obstacle (keyed to its id), not
// regenerated each frame.
function drawRock(ctx: CanvasRenderingContext2D, x: number, groundY: number, radius: number, seed: number): void {
  const w = radius * 2;
  const h = radius * 1.6;
  const points: [number, number][] = [
    [x - w / 2, groundY],
    [x - w * 0.32, groundY - h * (0.75 + hash(seed * 1.1) * 0.2)],
    [x - w * 0.05, groundY - h * (0.95 + hash(seed * 2.2) * 0.15)],
    [x + w * 0.28, groundY - h * (0.7 + hash(seed * 3.3) * 0.2)],
    [x + w / 2, groundY],
  ];

  ctx.fillStyle = ROCK_FILL;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (const [px, py] of points.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fill();

  // A darker shaded wedge on the downhill side reads as one hand-painted
  // light source rather than a flat fill.
  ctx.fillStyle = ROCK_DARK;
  ctx.beginPath();
  ctx.moveTo(points[2][0], points[2][1]);
  ctx.lineTo(points[3][0], points[3][1]);
  ctx.lineTo(points[4][0], points[4][1]);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(2, radius * 0.14);
  ctx.lineJoin = "round";
  for (let i = 0; i < points.length - 1; i += 1) {
    sketchyLine(ctx, points[i][0], points[i][1], points[i + 1][0], points[i + 1][1], seed * 11 + i);
  }

  // A single crack line for texture.
  ctx.lineWidth = Math.max(1, radius * 0.06);
  sketchyLine(ctx, points[1][0], points[1][1], x, groundY - h * 0.2, seed * 5.5);

  // Snow drifted up against the base on both sides — the rock reads as
  // embedded in the slope rather than an icon placed on top of it.
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.beginPath();
  ctx.ellipse(x - w * 0.28, groundY, w * 0.26, radius * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + w * 0.3, groundY, w * 0.24, radius * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

// --- the player: a hand-drawn downhill skier ----------------------------
// Built from filled, outlined shapes (jacket, pants, skis, hair, scarf)
// rather than bare stroked lines, so the figure has a real silhouette
// instead of a stick-figure skeleton. All pose math (lean, stride, jump
// tuck) is unchanged from before — only how each limb/segment is *drawn* has
// changed — and everything still scales off the same `radius` the hitbox
// uses, without ever touching the hitbox itself (that lives in
// collision.ts/slope.ts).

// Strokes a sketchy line twice — a wider dark pass underneath, a narrower
// colored pass on top, both tracing the identical bowed curve (same seed) —
// for a bold, slightly rough cartoon outline on every limb.
function boldStroke(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  width: number,
  seed: number,
): void {
  ctx.lineCap = "round";
  ctx.strokeStyle = LINE;
  ctx.lineWidth = width + Math.max(1.6, width * 0.55);
  sketchyLine(ctx, x1, y1, x2, y2, seed);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  sketchyLine(ctx, x1, y1, x2, y2, seed);
}

function drawSkier(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  groundY: number,
  radius: number,
  player: { jumpProgress: number; laneVelocity: number },
  distanceTraveled: number,
): void {
  const airborne = player.jumpProgress > 0.05;
  const laneLean = clamp(player.laneVelocity / MAX_LANE_SPEED, -1, 1);

  // A whole-figure tilt: a baseline crouch-into-the-descent lean that eases
  // out as the player leaves the ground, plus a lane-velocity sway for
  // steering toward either edge of the piste. Drawn as a rotation about the
  // player's own ground-contact point, so it never moves the figure off its
  // fixed screen anchor.
  const groundedLean = DOWNHILL_LEAN_ANGLE * (1 - player.jumpProgress);
  ctx.save();
  ctx.translate(x, groundY);
  ctx.rotate(groundedLean + laneLean * MAX_TILT_ANGLE);
  ctx.translate(-x, -groundY);

  // Every length below scales off the same radius used for the hitbox, so
  // the drawn figure and the collision footprint grow and shrink together
  // across viewports.
  const unit = radius * 1.45;
  const torsoLen = unit * 1.0;
  const headR = unit * 0.46;
  const forwardTuck = unit * 0.42;

  const shiftPhase = distanceTraveled * WEIGHT_SHIFT_FREQ;
  const armPhase = distanceTraveled * ARM_SWING_FREQ;
  const bob = airborne ? 0 : Math.sin(shiftPhase) * unit * 0.045;
  const flingUp = airborne ? Math.sin(clamp(player.jumpProgress, 0, 1) * Math.PI) : 0;

  const hipX = x;
  const hipY = y - unit - bob;
  const shoulderX = x + forwardTuck + (airborne ? unit * 0.06 : 0);
  const shoulderY = hipY - torsoLen - (airborne ? flingUp * unit * 0.08 : 0);
  const neckX = shoulderX - unit * 0.02;
  const neckY = shoulderY - unit * 0.1;
  const headX = neckX + unit * 0.12;
  const headY = neckY - headR * 0.85;

  // Wind/speed direction is always "backward" relative to the forward lean
  // (screen-left, opposite the direction the figure faces) — hair and scarf
  // trail that way, streaming further out the faster/higher the player is.
  const windDir = -1;
  const windAmount = 0.55 + flingUp * 0.6 + Math.abs(laneLean) * 0.15;

  ctx.lineJoin = "round";

  // Back leg + back ski + back arm first, then the torso, then the front
  // limbs and head — gives the silhouette real depth instead of every part
  // drawn flat in an arbitrary order.
  drawLeg(ctx, hipX, hipY, groundY, unit, -1, airborne, player.jumpProgress, shiftPhase, true);
  drawSki(ctx, hipX, groundY, unit, -1, airborne, player.jumpProgress, groundY - y, true);
  drawArm(ctx, shoulderX, shoulderY, unit, -1, airborne, flingUp, armPhase, laneLean, true);

  drawTorso(ctx, hipX, hipY, shoulderX, shoulderY, unit);
  drawScarf(ctx, neckX, neckY, unit, windDir, windAmount, distanceTraveled);

  drawLeg(ctx, hipX, hipY, groundY, unit, 1, airborne, player.jumpProgress, shiftPhase, false);
  drawSki(ctx, hipX, groundY, unit, 1, airborne, player.jumpProgress, groundY - y, false);
  drawArm(ctx, shoulderX, shoulderY, unit, 1, airborne, flingUp, armPhase, laneLean, false);

  drawHead(ctx, headX, headY, headR, windDir, windAmount, airborne, distanceTraveled);

  ctx.restore();
}

// One leg: bent-tuck silhouette while airborne, a fixed bent ski stance
// while grounded. Skiing legs never alternate a running stride — both boots
// stay planted on their own ski (matching drawSki's groundY/side placement
// exactly) at all times; the only grounded motion is a small, synchronized
// weight-shift bob shared by both legs, driven by shiftPhase. The thigh is a
// loose, baggy-shorts silhouette (wide at the hip, still wide at the knee
// hem — never tapering to a thin stick) and the shin is a single chunky
// filled capsule instead of two thin stroked segments, so the leg reads as
// a solid cartoon limb rather than an insect-thin line.
function drawLeg(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  groundY: number,
  unit: number,
  side: number,
  airborne: boolean,
  jumpProgress: number,
  shiftPhase: number,
  isBack: boolean,
): void {
  const shortsColor = isBack ? SKIER_PANTS_SHADE : SKIER_PANTS;
  const legColor = isBack ? SKIER_LEG_SHADE : SKIER_LEG;
  let kneeX: number, kneeY: number, footX: number, footY: number;
  if (airborne) {
    const tuck = Math.sin(clamp(jumpProgress, 0, 1) * Math.PI);
    kneeX = hipX + side * unit * (0.28 - tuck * 0.1);
    kneeY = hipY + unit * (0.3 - tuck * 0.08);
    footX = hipX + side * unit * 0.1 - unit * (0.12 + tuck * 0.14);
    footY = hipY + unit * (0.48 - tuck * 0.16);
  } else {
    const settle = Math.sin(shiftPhase);
    kneeX = hipX + side * unit * 0.2;
    kneeY = hipY + unit * 0.52 + settle * unit * 0.015;
    // footX matches drawSki's grounded skiX (hipX + side * unit * 0.3)
    // exactly, and footY sits on the same groundY the ski is drawn at, so
    // the boot never detaches from its ski.
    footX = hipX + side * unit * 0.3;
    footY = groundY - Math.max(0, settle) * unit * 0.015;
  }
  drawBaggyShorts(ctx, hipX, hipY, kneeX, kneeY, unit, shortsColor);
  drawChunkyLimb(ctx, kneeX, kneeY, footX, footY, unit * 0.32, legColor);
  drawBoot(ctx, footX, footY, unit);
}

// A loose, poofy shorts silhouette from hip to knee — wide at the waist,
// bulging outward at mid-thigh, and still wide (not tapered to a point) at
// the knee hem, with a stitched hem line for "distinctive baggy silhouette".
function drawBaggyShorts(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  kneeX: number,
  kneeY: number,
  unit: number,
  color: string,
): void {
  const dx = kneeX - hipX;
  const dy = kneeY - hipY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const hipHalf = unit * 0.34;
  const hemHalf = unit * 0.3;
  const bulge = unit * 0.14;
  const midX = (hipX + kneeX) / 2 + nx * bulge;
  const midY = (hipY + kneeY) / 2 + ny * bulge;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(hipX - nx * hipHalf, hipY - ny * hipHalf);
  ctx.quadraticCurveTo(midX - nx * hipHalf, midY - ny * hipHalf, kneeX - nx * hemHalf, kneeY - ny * hemHalf);
  ctx.lineTo(kneeX + nx * hemHalf, kneeY + ny * hemHalf);
  ctx.quadraticCurveTo(midX + nx * hipHalf, midY + ny * hipHalf, hipX + nx * hipHalf, hipY + ny * hipHalf);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(2, unit * 0.09);
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.3, unit * 0.05);
  ctx.beginPath();
  ctx.moveTo(kneeX - nx * hemHalf * 0.9, kneeY - ny * hemHalf * 0.9);
  ctx.lineTo(kneeX + nx * hemHalf * 0.9, kneeY + ny * hemHalf * 0.9);
  ctx.stroke();
}

// A solid, chunky filled capsule between two joints — used for the visible
// calf below the shorts hem, so the leg reads as a thick cartoon limb rather
// than a bare stroked line.
function drawChunkyLimb(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  color: string,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const halfW = width / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 - nx * halfW, y1 - ny * halfW);
  ctx.lineTo(x2 - nx * halfW * 0.85, y2 - ny * halfW * 0.85);
  ctx.quadraticCurveTo(x2, y2, x2 + nx * halfW * 0.85, y2 + ny * halfW * 0.85);
  ctx.lineTo(x1 + nx * halfW, y1 + ny * halfW);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.8, width * 0.22);
  ctx.lineJoin = "round";
  ctx.stroke();
}

function drawBoot(ctx: CanvasRenderingContext2D, footX: number, footY: number, unit: number): void {
  ctx.fillStyle = SKIER_GLOVE;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, unit * 0.07);
  ctx.beginPath();
  ctx.ellipse(footX, footY, unit * 0.19, unit * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// A single ski pole trailing from a hand — a dark sketchy shaft, a short
// grip stub just past the hand, and a small basket ring near the tip.
// Everything is computed relative to the hand position/angle it's given, so
// the pole always stays attached and lifts/moves exactly with the arm that
// holds it.
function drawPole(
  ctx: CanvasRenderingContext2D,
  handX: number,
  handY: number,
  angle: number,
  length: number,
  unit: number,
  seed: number,
): void {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const tipX = handX + dirX * length;
  const tipY = handY + dirY * length;
  const gripX = handX - dirX * unit * 0.14;
  const gripY = handY - dirY * unit * 0.14;
  const basketX = tipX - dirX * unit * 0.1;
  const basketY = tipY - dirY * unit * 0.1;

  ctx.strokeStyle = LINE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Grip/handle: a short, slightly thicker stub poking out past the hand.
  ctx.lineWidth = Math.max(2.4, unit * 0.075);
  sketchyLine(ctx, gripX, gripY, handX, handY, seed + 4.4);

  // Main shaft, from the hand down/back to the tip.
  ctx.lineWidth = Math.max(1.6, unit * 0.04);
  sketchyLine(ctx, handX, handY, tipX, tipY, seed);

  // Basket ring near the tip — the classic small ski-pole detail.
  ctx.lineWidth = Math.max(1.2, unit * 0.03);
  ctx.beginPath();
  ctx.ellipse(basketX, basketY, unit * 0.07, unit * 0.045, angle, 0, Math.PI * 2);
  ctx.stroke();
}

// Arms: a fixed, bent-elbow skiing stance, each arm holding its own ski
// pole. The two arms are deliberately asymmetric — the back arm reaches
// down and behind the body (a trailing pole plant), the front arm reaches
// down and ahead (a forward pole plant) — so both stay clearly separated
// and readable instead of overlapping into one visible arm. Only a small
// shared sway (armPhase) and a slight shift toward the lean direction
// during a turn move them; neither arm ever alternates like a runner's
// pump, and both stay clear of the torso. Airborne, both arms — and their
// poles — extend outward and slightly up together for a clear, symmetric
// balanced flying pose, one hand offset a touch further out than the other
// so the two poles never overlap.
function drawArm(
  ctx: CanvasRenderingContext2D,
  shoulderX: number,
  shoulderY: number,
  unit: number,
  side: number,
  airborne: boolean,
  flingUp: number,
  armPhase: number,
  laneLean: number,
  isBack: boolean,
): void {
  const width = unit * 0.2;
  const color = isBack ? SKIER_JACKET_SHADE : SKIER_JACKET;
  let elbowX: number, elbowY: number, handX: number, handY: number;
  if (airborne) {
    // The back arm is drawn before both the torso and the windswept hair, so
    // anything that lands inside the torso quad OR the head/hair region gets
    // painted over and disappears. Raising it near the head (like the front
    // arm) puts it right where the hair sweeps back, so instead it trails
    // low and behind near the hip — clearing the torso silhouette (see the
    // grounded trailing-arm fix above) while staying in totally different
    // screen space from the head, so it reads as a separate, trailing
    // pole-arm rather than blending into the hair.
    if (isBack) {
      elbowX = shoulderX - unit * 0.34;
      elbowY = shoulderY + unit * (0.34 + flingUp * 0.1);
      handX = shoulderX - unit * (0.68 + flingUp * 0.15);
      handY = shoulderY + unit * (0.55 + flingUp * 0.2);
    } else {
      elbowX = shoulderX + unit * 0.4;
      elbowY = shoulderY - unit * (0.05 + flingUp * 0.1);
      handX = shoulderX + unit * 0.64;
      handY = shoulderY - unit * (0.22 + flingUp * 0.32);
    }
  } else {
    const sway = Math.sin(armPhase + (isBack ? 0 : 0.6)) * unit * 0.03;
    const leanShift = laneLean * unit * 0.1;
    if (isBack) {
      // Trailing arm: swings back and out from the shoulder, clearing the
      // torso silhouette (this arm is drawn before drawTorso, so anything
      // that stays inside the torso's fill would otherwise be painted over
      // and disappear). Kept at shoulder/mid-back height rather than dropped
      // to hip level — the back leg and ski already occupy that lower band,
      // and the near-black jacket-shade there reads as one merged shape with
      // them at gameplay scale; holding the hand higher keeps the arm in its
      // own clear stretch of screen so it reads as a distinct limb.
      elbowX = shoulderX - unit * 0.34;
      elbowY = shoulderY + unit * 0.32 + sway * 0.6;
      handX = shoulderX - unit * 0.95 + leanShift;
      handY = shoulderY + unit * 0.5 + sway;
    } else {
      // Leading arm: reaches down and ahead of the body.
      elbowX = shoulderX + unit * 0.3;
      elbowY = shoulderY + unit * 0.42 + sway * 0.6;
      handX = shoulderX + unit * 0.5 + leanShift;
      handY = shoulderY + unit * 0.72 + sway;
    }
  }
  boldStroke(ctx, shoulderX, shoulderY + unit * 0.1, elbowX, elbowY, color, width, armPhase * 3 + side);
  boldStroke(ctx, elbowX, elbowY, handX, handY, color, width * 0.85, armPhase * 3 + side + 0.5);
  ctx.fillStyle = SKIER_GLOVE;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, unit * 0.06);
  ctx.beginPath();
  ctx.arc(handX, handY, unit * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // The pole trails backward/downward from the hand, matching the downhill
  // motion — nearly vertical (planted toward the snow) while grounded,
  // swept back toward horizontal while airborne (trailing through the air
  // rather than pointing at ground that's no longer close by).
  const poleWobble = Math.sin(armPhase + (isBack ? 0 : 1.1)) * 0.05;
  const poleAngle = (airborne ? Math.PI * (0.92 - flingUp * 0.1) : Math.PI * 0.64) + poleWobble;
  const poleLength = unit * (airborne ? 0.85 : 0.95);
  drawPole(ctx, handX, handY, poleAngle, poleLength, unit, side * 7 + (isBack ? 1 : 2));
}

// A filled, tapered jacket silhouette (wider at the shoulders, narrower at
// the hips) instead of a single stroked spine — the "stronger silhouette"
// the plain stickman never had — with a simple zip line and waistband for
// "simple clothing" detail.
function drawTorso(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  hipY: number,
  shoulderX: number,
  shoulderY: number,
  unit: number,
): void {
  const hipHalf = unit * 0.22;
  const shoulderHalf = unit * 0.34;
  const dx = shoulderX - hipX;
  const dy = shoulderY - hipY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;

  ctx.fillStyle = SKIER_JACKET;
  ctx.beginPath();
  ctx.moveTo(hipX - nx * hipHalf, hipY - ny * hipHalf);
  ctx.lineTo(shoulderX - nx * shoulderHalf, shoulderY - ny * shoulderHalf);
  ctx.lineTo(shoulderX + nx * shoulderHalf, shoulderY + ny * shoulderHalf);
  ctx.lineTo(hipX + nx * hipHalf, hipY + ny * hipHalf);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(2, unit * 0.09);
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.strokeStyle = SKIER_JACKET_SHADE;
  ctx.lineWidth = Math.max(1.2, unit * 0.045);
  sketchyLine(ctx, (hipX + shoulderX) / 2, (hipY + shoulderY) / 2, shoulderX, shoulderY + unit * 0.12, 91);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, unit * 0.05);
  ctx.beginPath();
  ctx.moveTo(hipX - nx * hipHalf * 1.05, hipY - ny * hipHalf * 1.05);
  ctx.lineTo(hipX + nx * hipHalf * 1.05, hipY + ny * hipHalf * 1.05);
  ctx.stroke();
}

// A trailing ribbon of fabric flowing from the neck backward, fluttering
// with a sine wave keyed to distanceTraveled (not wall-clock time) — the
// scarf/accessory moving with the character, called for explicitly.
function drawScarf(
  ctx: CanvasRenderingContext2D,
  neckX: number,
  neckY: number,
  unit: number,
  windDir: number,
  windAmount: number,
  distanceTraveled: number,
): void {
  const len = unit * (1.1 + windAmount * 0.5);
  const segments = 5;
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const wavePhase = distanceTraveled * 0.12;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const px = neckX + windDir * len * t;
    const wave = Math.sin(t * Math.PI * 1.6 + wavePhase) * unit * 0.16 * windAmount * t;
    const py = neckY + unit * 0.05 * t + wave;
    const halfWidth = unit * 0.16 * (1 - t * 0.55);
    top.push([px, py - halfWidth]);
    bottom.push([px, py + halfWidth]);
  }
  ctx.fillStyle = SKIER_SCARF;
  ctx.beginPath();
  ctx.moveTo(top[0][0], top[0][1]);
  for (const [px, py] of top.slice(1)) ctx.lineTo(px, py);
  for (let i = bottom.length - 1; i >= 0; i -= 1) ctx.lineTo(bottom[i][0], bottom[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.5, unit * 0.05);
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.fillStyle = SKIER_SCARF;
  ctx.beginPath();
  ctx.ellipse(neckX, neckY, unit * 0.16, unit * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// A tapered, pointed "lock" shape — wide at the root, curving to a point at
// the tip via a control point offset to the side — used for both the messy
// hair mass and its longer flowing wisps.
function drawTaperedLock(
  ctx: CanvasRenderingContext2D,
  rootX: number,
  rootY: number,
  midX: number,
  midY: number,
  tipX: number,
  tipY: number,
  width: number,
): void {
  const dx = midX - rootX;
  const dy = midY - rootY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const halfW = width / 2;
  ctx.beginPath();
  ctx.moveTo(rootX - nx * halfW, rootY - ny * halfW);
  ctx.quadraticCurveTo(midX - nx * halfW * 0.5, midY - ny * halfW * 0.5, tipX, tipY);
  ctx.quadraticCurveTo(midX + nx * halfW * 0.5, midY + ny * halfW * 0.5, rootX + nx * halfW, rootY + ny * halfW);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Several irregular, sharp spikes covering the back/top of the head (drawn
// before the face circle, which paints over their roots and the front half)
// — a jagged, spiky cartoon hairstyle rather than one smooth rounded cap.
// Each spike is a drawTaperedLock (wide root, pointed tip), anchored on the
// head circle and pointing generally backward/upward (windDir), never
// bulging outward as a rounded lump. Short spikes alternate with a few
// longer, windswept ones so the silhouette reads as an irregular mass of
// points with no bald gaps, and the whole thing streams further back the
// faster/higher the player is (windAmount), same reactivity as before.
const HAIR_SPIKE_COUNT = 8;

function drawSpikyHair(
  ctx: CanvasRenderingContext2D,
  headX: number,
  headY: number,
  headR: number,
  windDir: number,
  windAmount: number,
  distanceTraveled: number,
): void {
  ctx.fillStyle = SKIER_HAIR;
  ctx.strokeStyle = LINE;
  ctx.lineJoin = "round";
  for (let i = 0; i < HAIR_SPIKE_COUNT; i += 1) {
    const t = i / (HAIR_SPIKE_COUNT - 1);
    const rootAngle = Math.PI * (0.82 + t * 0.85);
    const rootX = headX + Math.cos(rootAngle) * headR * 0.88;
    const rootY = headY + Math.sin(rootAngle) * headR * 0.88;
    const outX = Math.cos(rootAngle);
    const outY = Math.sin(rootAngle);
    const sway = Math.sin(distanceTraveled * 0.2 + i * 1.7) * headR * 0.08;
    const isLong = i % 3 === 1;
    const lenBase = isLong ? 1.15 : 0.6;
    const reach = headR * (lenBase + windAmount * (isLong ? 0.9 : 0.35) + hash(i * 4.1 + 601) * 0.3);
    const tipX = rootX + outX * headR * 0.25 + windDir * reach;
    const tipY = rootY + outY * headR * 0.35 - headR * 0.1 + sway;
    const midX = rootX + outX * headR * 0.35 + windDir * reach * 0.45;
    const midY = rootY + outY * headR * 0.45;
    const width = headR * (isLong ? 0.24 : 0.34) + hash(i * 6.6 + 601) * headR * 0.08;
    ctx.lineWidth = Math.max(1.4, width * 0.3);
    drawTaperedLock(ctx, rootX, rootY, midX, midY, tipX, tipY, width);
  }
}

// Two clear, separate goggle lenses on a connecting strap — replaces the old
// single giant eye so the face reads as a cartoon skier's goggles rather
// than a cyclops.
function drawGoggles(ctx: CanvasRenderingContext2D, headX: number, headY: number, headR: number): void {
  const strapY = headY - headR * 0.03;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.4, headR * 0.08);
  ctx.beginPath();
  ctx.moveTo(headX - headR * 0.7, strapY - headR * 0.14);
  ctx.lineTo(headX + headR * 0.82, strapY - headR * 0.04);
  ctx.stroke();

  const lenses = [
    { x: headX, y: headY - headR * 0.05, r: headR * 0.22 },
    { x: headX + headR * 0.4, y: headY - headR * 0.02, r: headR * 0.25 },
  ];
  for (const lens of lenses) {
    ctx.fillStyle = LINE;
    ctx.beginPath();
    ctx.ellipse(lens.x, lens.y, lens.r, lens.r * 0.88, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = Math.max(1.3, headR * 0.06);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(lens.x + lens.r * 0.3, lens.y - lens.r * 0.32, lens.r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Head: spiky hair (drawn first so the face overlaps the spikes' roots), two
// clear goggle lenses, and a mouth that opens wide in the air and curls into
// a small smile on the ground.
function drawHead(
  ctx: CanvasRenderingContext2D,
  headX: number,
  headY: number,
  headR: number,
  windDir: number,
  windAmount: number,
  airborne: boolean,
  distanceTraveled: number,
): void {
  drawSpikyHair(ctx, headX, headY, headR, windDir, windAmount, distanceTraveled);

  ctx.fillStyle = SKIER_FACE;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(2, headR * 0.14);
  ctx.stroke();

  drawGoggles(ctx, headX, headY, headR);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.3, headR * 0.09);
  if (airborne) {
    ctx.fillStyle = LINE;
    ctx.beginPath();
    ctx.ellipse(headX + headR * 0.1, headY + headR * 0.55, headR * 0.14, headR * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(headX - headR * 0.05, headY + headR * 0.5);
    ctx.quadraticCurveTo(headX + headR * 0.25, headY + headR * 0.68, headX + headR * 0.45, headY + headR * 0.48);
    ctx.stroke();
  }
}

// A proper ski shape — a flat filled board with an upturned tip — instead of
// a single sketchy line, with a bright accent stripe down the centre. Drawn
// per side so the back ski can sit fractionally behind the front one.
function drawSki(
  ctx: CanvasRenderingContext2D,
  hipX: number,
  groundY: number,
  unit: number,
  side: number,
  airborne: boolean,
  jumpProgress: number,
  hop: number,
  isBack: boolean,
): void {
  const tuck = airborne ? Math.sin(clamp(jumpProgress, 0, 1) * Math.PI) : 0;
  const tipLift = airborne ? unit * (0.35 + tuck * 0.25) : unit * 0.15;
  const skiX = hipX + side * unit * (airborne ? 0.2 : 0.3);
  // Base lift matches the hop the rest of the figure already got, plus a
  // small extra flourish from the tuck pose.
  const skiY = (airborne ? groundY - hop - unit * 0.18 * tuck : groundY) + (isBack ? unit * 0.03 : 0);
  const len = unit * 1.2;
  const half = unit * 0.07;
  const backX = skiX - len * 0.5;
  const frontFlatX = skiX + len * 0.35;
  const frontTipX = skiX + len * 0.5;

  ctx.fillStyle = SKI_COLOR;
  ctx.beginPath();
  ctx.moveTo(backX, skiY - half);
  ctx.lineTo(frontFlatX, skiY - half);
  ctx.quadraticCurveTo(frontTipX, skiY - half, frontTipX, skiY - half - tipLift);
  ctx.lineTo(frontTipX - unit * 0.06, skiY - half - tipLift * 0.85);
  ctx.quadraticCurveTo(frontFlatX, skiY + half * 0.3, frontFlatX, skiY + half);
  ctx.lineTo(backX, skiY + half);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = Math.max(1.8, unit * 0.07);
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.strokeStyle = SKI_STRIPE;
  ctx.lineWidth = Math.max(1.2, unit * 0.035);
  ctx.beginPath();
  ctx.moveTo(backX + len * 0.1, skiY);
  ctx.lineTo(frontFlatX - unit * 0.05, skiY);
  ctx.stroke();
}
