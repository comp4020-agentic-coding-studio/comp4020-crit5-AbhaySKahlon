import type { InputState } from "./physics";

// Pointer events cover mouse and touch alike: the play area splits into three
// horizontal zones (steer left / jump / steer right), so the same controller
// drives desktop and phone with no separate touch path.
export interface InputController {
  state: InputState;
  getInteractionCount: () => number;
  destroy: () => void;
}

const LEFT_KEYS = new Set(["ArrowLeft", "a", "A"]);
const RIGHT_KEYS = new Set(["ArrowRight", "d", "D"]);
const JUMP_KEYS = new Set([" ", "Spacebar", "ArrowUp", "w", "W"]);

export function createInput(target: HTMLElement): InputController {
  const state: InputState = { left: false, right: false, jump: false };
  let interactionCount = 0;
  let jumpReleaseTimer: number | undefined;

  function onKeyDown(event: KeyboardEvent) {
    if (LEFT_KEYS.has(event.key)) state.left = true;
    if (RIGHT_KEYS.has(event.key)) state.right = true;
    if (JUMP_KEYS.has(event.key)) {
      state.jump = true;
      event.preventDefault();
    }
    interactionCount += 1;
  }

  function onKeyUp(event: KeyboardEvent) {
    if (LEFT_KEYS.has(event.key)) state.left = false;
    if (RIGHT_KEYS.has(event.key)) state.right = false;
    if (JUMP_KEYS.has(event.key)) state.jump = false;
  }

  function zoneFromX(x: number, width: number): "left" | "jump" | "right" {
    if (x < width / 3) return "left";
    if (x > (2 * width) / 3) return "right";
    return "jump";
  }

  function onPointerDown(event: PointerEvent) {
    const rect = target.getBoundingClientRect();
    const zone = zoneFromX(event.clientX - rect.left, rect.width);
    if (zone === "left") state.left = true;
    else if (zone === "right") state.right = true;
    else {
      state.jump = true;
      window.clearTimeout(jumpReleaseTimer);
      jumpReleaseTimer = window.setTimeout(() => {
        state.jump = false;
      }, 120);
    }
    interactionCount += 1;
  }

  function onPointerUp() {
    state.left = false;
    state.right = false;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  target.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);

  return {
    state,
    getInteractionCount: () => interactionCount,
    destroy() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.clearTimeout(jumpReleaseTimer);
    },
  };
}
