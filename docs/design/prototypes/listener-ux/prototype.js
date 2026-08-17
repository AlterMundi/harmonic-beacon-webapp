const states = ["visitor", "free", "founder", "listening", "paused", "profile", "checkout"];

const params = new URLSearchParams(window.location.search);
if (params.get("capture") === "1") {
  document.documentElement.dataset.capture = "true";
}

function isVisibleFor(element, state) {
  return (element.dataset.show ?? "").split(/\s+/).includes(state);
}

function applyState(nextState, updateUrl = true) {
  const state = states.includes(nextState) ? nextState : "listening";
  document.body.dataset.state = state;

  document.querySelectorAll("[data-show]").forEach((element) => {
    element.hidden = !isVisibleFor(element, state);
  });

  document.querySelectorAll("[data-state-button]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.stateButton === state));
  });

  const label = document.querySelector("[data-current-state]");
  if (label) label.textContent = state;

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("state", state);
    history.replaceState({}, "", url);
  }
}

document.querySelectorAll("[data-state-button]").forEach((button) => {
  button.addEventListener("click", () => applyState(button.dataset.stateButton));
});

document.querySelectorAll("[data-open-state]").forEach((button) => {
  button.addEventListener("click", () => applyState(button.dataset.openState));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ["profile", "checkout"].includes(document.body.dataset.state)) {
    applyState("free");
  }
});

applyState(params.get("state") ?? "listening", false);
