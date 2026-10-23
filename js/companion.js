import { SESSION_STATES, STORAGE_KEY } from "./core.js";
import { PRACTICE_KEY, activityState } from "./practice.js";

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const emitTo = window.__TAURI__?.event?.emitTo;
const cat = document.querySelector("#cat");
const image = document.querySelector("#catImage");
const sessionControl = document.querySelector("#sessionControl");
const restoreMain = document.querySelector("#restoreMain");

const assets = {
  right: { idle: "./assets/images/companion/cat-idle-v12.png", blink: "./assets/images/companion/cat-blink-v12.png", paused: "./assets/images/companion/cat-right-rest-v15.png" },
  left: { idle: "./assets/images/companion/cat-idle-v12.png", blink: "./assets/images/companion/cat-blink-v12.png", paused: "./assets/images/companion/cat-right-rest-v15.png" },
  top: { idle: "./assets/images/companion/cat-top-idle-v15.png", paused: "./assets/images/companion/cat-top-rest-v15.png" },
  bottom: { idle: "./assets/images/companion/cat-bottom-idle-v15.png", paused: "./assets/images/companion/cat-bottom-rest-v15.png" },
};
Object.values(assets).flatMap((group) => Object.values(group)).forEach((src) => { const preload = new Image(); preload.src = src; });

let edge = "right";
let state = SESSION_STATES.IDLE;
let stateTimer;
let singleTimer;
let press = null;
let suppressClickUntil = 0;

function storedState() {
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  return activityState(read(STORAGE_KEY), read(PRACTICE_KEY));
}

function render() {
  clearTimeout(stateTimer);
  document.body.dataset.edge = edge;
  document.body.dataset.session = state;
  const paused = state === SESSION_STATES.PAUSED;
  image.src = paused ? assets[edge].paused : assets[edge].idle;
  sessionControl.hidden = state === SESSION_STATES.IDLE;
  sessionControl.textContent = paused ? "▶" : "⏸";
  sessionControl.setAttribute("aria-label", paused ? "继续学习" : "暂停学习");
}

function blink() {
  if (state === SESSION_STATES.PAUSED || (edge !== "left" && edge !== "right")) return;
  image.src = assets[edge].blink;
  stateTimer = setTimeout(render, 170);
}

async function updateEdge(nextEdge) {
  if (["left", "right", "top", "bottom"].includes(nextEdge)) edge = nextEdge;
  render();
}

async function updateState(nextState) {
  state = [SESSION_STATES.STUDYING, SESSION_STATES.PAUSED].includes(nextState) ? nextState : SESSION_STATES.IDLE;
  render();
}

cat.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  press = { id: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
});

cat.addEventListener("pointermove", async (event) => {
  if (!press || press.id !== event.pointerId || press.dragging) return;
  if (Math.hypot(event.screenX - press.x, event.screenY - press.y) < 6) return;
  press.dragging = true;
  cat.classList.add("dragging");
  try {
    if (invoke) {
      await invoke("drag_companion");
    }
  } finally {
    suppressClickUntil = performance.now() + 350;
    cat.classList.remove("dragging");
    press = null;
  }
});

cat.addEventListener("pointerup", (event) => { if (press?.id === event.pointerId && !press.dragging) press = null; });
cat.addEventListener("pointercancel", () => { press = null; cat.classList.remove("dragging"); });
cat.addEventListener("click", () => {
  if (performance.now() < suppressClickUntil) return;
  clearTimeout(singleTimer);
  singleTimer = setTimeout(blink, 230);
});
cat.addEventListener("dblclick", async (event) => {
  event.preventDefault(); clearTimeout(singleTimer); render();
  if (invoke) await invoke("restore_main");
});

sessionControl.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (emitTo) await emitTo("main", "session-control-request", "toggle");
});
restoreMain.addEventListener("click", async (event) => {
  event.stopPropagation();
  if (invoke) await invoke("restore_main");
});

async function init() {
  state = storedState();
  if (invoke) await updateEdge(await invoke("get_companion_edge")); else render();
  if (typeof listen === "function") {
    await listen("companion-placement-changed", (event) => updateEdge(event.payload));
    await listen("session-state-changed", (event) => updateState(event.payload));
  }
  setInterval(() => { const next = storedState(); if (next !== state) updateState(next); }, 1000);
}
init();
