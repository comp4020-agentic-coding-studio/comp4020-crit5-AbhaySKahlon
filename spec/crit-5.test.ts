import { describe, expect, it } from "vitest";
import { checkCollision, hasReachedEnd, type Obstacle } from "../src/scripts/game/collision";

// The one focused rule test the brief asks for: can the player lose, and can
// they reach a definite ending. Exercises the pure rule directly, not the DOM.
const obstacle: Obstacle = { id: 0, distance: 500, lane: 0 };

describe("collision rule", () => {
  it("collides when the player shares the obstacle's lane at its depth and isn't airborne", () => {
    expect(checkCollision({ lane: 0, jumpProgress: 0 }, obstacle, 500)).toBe(true);
  });

  it("does not collide when the player has steered into a different lane", () => {
    expect(checkCollision({ lane: 0.6, jumpProgress: 0 }, obstacle, 500)).toBe(false);
  });

  it("does not collide when the player is jumping high enough to clear it", () => {
    expect(checkCollision({ lane: 0, jumpProgress: 0.9 }, obstacle, 500)).toBe(false);
  });

  it("does not collide before or after the obstacle's depth window", () => {
    expect(checkCollision({ lane: 0, jumpProgress: 0 }, obstacle, 100)).toBe(false);
    expect(checkCollision({ lane: 0, jumpProgress: 0 }, obstacle, 900)).toBe(false);
  });
});

describe("ending the descent", () => {
  it("is reached once distance traveled meets or passes the total", () => {
    expect(hasReachedEnd(999, 1000)).toBe(false);
    expect(hasReachedEnd(1000, 1000)).toBe(true);
    expect(hasReachedEnd(1500, 1000)).toBe(true);
  });
});
