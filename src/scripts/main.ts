import { createInput } from "./game/input";
import { stepPlayer } from "./game/physics";
import { findCollision, hasReachedEnd } from "./game/collision";
import {
  createGameState,
  updateScore,
  totalScore,
  BASE_SPEED,
  TOTAL_DISTANCE,
  type GameState,
} from "./game/state";
import { render } from "./game/render";
import { loadScores, saveScore, type ScoreEntry } from "./leaderboard";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const ctx = canvas?.getContext("2d");
const scoreHud = document.querySelector<HTMLElement>("#score-hud");
const endPanel = document.querySelector<HTMLElement>("#end-panel");
const endMessage = document.querySelector<HTMLElement>("#end-message");
const endScore = document.querySelector<HTMLElement>("#end-score");
const leaderboardList = document.querySelector<HTMLOListElement>("#leaderboard-list");

function renderLeaderboard(scores: ScoreEntry[], justAchieved: number): void {
  if (!leaderboardList) return;
  leaderboardList.replaceChildren();
  if (scores.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No runs yet";
    leaderboardList.appendChild(li);
    return;
  }
  scores.forEach((entry, i) => {
    const li = document.createElement("li");
    if (entry.score === justAchieved) li.style.fontWeight = "700";
    const rank = document.createElement("span");
    rank.textContent = `${i + 1}.`;
    const value = document.createElement("span");
    value.textContent = `${entry.score}`;
    li.append(rank, value);
    leaderboardList.appendChild(li);
  });
}

if (canvas && ctx) {
  const input = createInput(canvas);
  let state: GameState = createGameState();
  let restartAfter = 0;
  let lastTime = 0;
  let previousStatus: GameState["status"] = "playing";

  if (scoreHud) scoreHud.hidden = false;
  if (endPanel) endPanel.hidden = true;
  renderLeaderboard(loadScores(), NaN);

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas!.width = canvas!.clientWidth * ratio;
    canvas!.height = canvas!.clientHeight * ratio;
    ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function tick(time: number) {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
    lastTime = time;

    if (state.status === "playing") {
      state.player = stepPlayer(state.player, input.state, dt);
      state.distanceTraveled += BASE_SPEED * dt;

      const hit = findCollision(state.player, state.obstacles, state.distanceTraveled);
      if (hit) {
        state.status = "lost";
        state.hitObstacleId = hit.id;
        restartAfter = input.getInteractionCount();
      } else if (hasReachedEnd(state.distanceTraveled, TOTAL_DISTANCE)) {
        state.status = "won";
        restartAfter = input.getInteractionCount();
      }
      updateScore(state);
      if (scoreHud) scoreHud.textContent = `${totalScore(state)}`;
    } else if (input.getInteractionCount() > restartAfter) {
      state = createGameState();
    }

    if (state.status !== previousStatus) {
      if (state.status === "playing") {
        if (endPanel) endPanel.hidden = true;
        if (scoreHud) scoreHud.hidden = false;
      } else {
        const score = totalScore(state);
        if (scoreHud) scoreHud.hidden = true;
        if (endMessage) endMessage.textContent = state.status === "won" ? "You made it down." : "Wiped out.";
        if (endScore) endScore.textContent = `Score: ${score}`;
        const scores = saveScore({ score, distance: Math.floor(state.distanceTraveled) });
        renderLeaderboard(scores, score);
        if (endPanel) endPanel.hidden = false;
      }
      previousStatus = state.status;
    }

    render(ctx!, state, canvas!.clientWidth, canvas!.clientHeight);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}
