// Pure game-rule functions: no DOM, no canvas, no timers. This is the module
// spec/crit-5.test.ts exercises directly, so the loss/win rule stays a
// testable contract even as rendering and input change around it. The
// world-x/lane math below is imported from slope.ts — the exact constants
// render.ts uses to place this same obstacle on screen — so a collision can
// only fire where the rock is actually drawn touching the stickman.

import { HIT_X_RADIUS, HIT_LANE_RADIUS } from "./slope";

export interface CollisionPlayer {
  lane: number;
  jumpProgress: number;
}

export interface Obstacle {
  id: number;
  distance: number;
  lane: number;
}

export const JUMP_CLEARS_AT = 0.45;

export function isAtObstacleX(distanceTraveled: number, obstacle: Obstacle): boolean {
  return Math.abs(obstacle.distance - distanceTraveled) < HIT_X_RADIUS;
}

export function lanesOverlap(playerLane: number, obstacleLane: number): boolean {
  return Math.abs(playerLane - obstacleLane) < HIT_LANE_RADIUS;
}

export function checkCollision(
  player: CollisionPlayer,
  obstacle: Obstacle,
  distanceTraveled: number,
): boolean {
  if (player.jumpProgress >= JUMP_CLEARS_AT) return false;
  if (!isAtObstacleX(distanceTraveled, obstacle)) return false;
  return lanesOverlap(player.lane, obstacle.lane);
}

export function findCollision(
  player: CollisionPlayer,
  obstacles: Obstacle[],
  distanceTraveled: number,
): Obstacle | undefined {
  return obstacles.find((obstacle) => checkCollision(player, obstacle, distanceTraveled));
}

export function hasReachedEnd(distanceTraveled: number, totalDistance: number): boolean {
  return distanceTraveled >= totalDistance;
}
