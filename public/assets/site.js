/* zneagle.com/r — progressive enhancement only.
   Every page is complete with this file blocked: the menu is a <details>, the
   selector is a list of links, Copy link falls back to a selectable URL, and
   company context lives in the URL (?c=<slug>), never in storage. Nothing here
   fetches or reports anything. The one thing it may store is the optional TRACE
   on/off flag, in this tab's sessionStorage (011C); it fails safely to OFF. */
(() => {
  "use strict";
  document.documentElement.classList.add("js");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* A cross-page view transition may be skipped (hidden tab, fast navigation, reduced motion).
     That is expected behaviour, not an error worth reporting. */
  const settle = (e) => {
    const vt = e.viewTransition;
    if (!vt) return;
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => { if (p) p.catch(() => {}); });
  };
  window.addEventListener("pageswap", settle);
  window.addEventListener("pagereveal", settle);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let companies = {};
  try {
    companies = JSON.parse(($("#zn-companies") || {}).textContent || "{}");
  } catch (_) {
    companies = {};
  }

  /* Route menu: close on Escape or an outside click. */
  const menu = $(".menu");
  if (menu) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.open) {
        menu.open = false;
        $("summary", menu).focus();
      }
    });
    document.addEventListener("click", (e) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
  }

  /* /r: the section in view decides which part of the substrate is emphasised. */
  const substrate = $(".substrate");
  const zones = $$("[data-zone]").filter((el) => el !== substrate);
  if (substrate && zones.length && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) substrate.dataset.zone = en.target.dataset.zone; }),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    zones.forEach((z) => io.observe(z));
  }

  /* 008K, reading-zone depth reveal: content settles into focus once, as it
     enters the reading zone. Progressive enhancement only — the CSS for
     [data-reveal="pending"] only changes appearance when that attribute is
     actually present, so without JS (or under reduced motion) every one of
     these elements is simply already in its normal, final position; no
     meaning depends on this ever running. Unobserved after its first
     reveal, so scrolling back up never replays it. */
  const revealTargets = $$("h2, .sect-head, .sect-lede, .prose, .doc-lede, .triad, .chain-fig");
  if (revealTargets.length && !reduced.matches && "IntersectionObserver" in window) {
    revealTargets.forEach((el) => { el.dataset.reveal = "pending"; });
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.removeAttribute("data-reveal");
        reveal.unobserve(en.target);
      }),
      { rootMargin: "0px 0px -20% 0px" }
    );
    revealTargets.forEach((el) => reveal.observe(el));
  }

  /* 010E, interactive taxonomy micro-explainer: click a chain stage to
     expand its explanation and briefly energize its real substrate group.
     One explanation panel, one JSON source of truth (#zn-taxonomy) — no
     duplicated copy between desktop/mobile, both just render the same
     string into the same node. Event-driven only: no RAF, no polling. */
  const chainButtons = $$(".chain-btn");
  const chainExplain = $("#chain-explain");
  const chainExplainBody = chainExplain && $(".chain-explain-body", chainExplain);
  let taxonomy = {};
  try {
    taxonomy = JSON.parse(($("#zn-taxonomy") || {}).textContent || "{}");
  } catch (_) {
    taxonomy = {};
  }
  if (chainButtons.length && chainExplain && chainExplainBody) {
    const substrate = $(".substrate");
    let openBtn = null;
    let flashTimer = null;
    const closeCurrent = () => {
      if (!openBtn) return;
      openBtn.setAttribute("aria-expanded", "false");
      openBtn = null;
      chainExplain.dataset.open = "false";
      if (substrate) delete substrate.dataset.stage;
    };
    const flash = (stage) => {
      if (!substrate) return;
      substrate.dataset.flash = stage;
      if (flashTimer) window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        if (substrate.dataset.flash === stage) delete substrate.dataset.flash;
      }, 900);
    };
    chainButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const stage = btn.closest("li").dataset.trace;
        const wasOpen = btn === openBtn;
        flash(stage);
        if (wasOpen) { closeCurrent(); return; }
        closeCurrent();
        btn.setAttribute("aria-expanded", "true");
        openBtn = btn;
        chainExplainBody.textContent = taxonomy[stage] || "";
        chainExplain.dataset.open = "true";
        if (substrate) substrate.dataset.stage = stage;
        if (!reduced.matches) {
          const word = $(".chain-t", btn);
          if (word) {
            word.classList.remove("is-popping");
            void word.offsetWidth;
            word.classList.add("is-popping");
            word.addEventListener("animationend", () => word.classList.remove("is-popping"), { once: true });
          }
        }
      });
    });
  }

  /* 011B4, actuator capsule transfer + PAC authority handoff. The code
     between the ACTUATOR:BEGIN/END markers is pure logic over injected
     effects (pose, capsule, publish, timer), so scripts/test_actuator.js
     runs this exact source without a DOM. Event-driven only: no RAF, at
     most ONE timer alive (the current step's), no queue beyond a single
     pending takeover + a single pending case.
       The machine's job: carry ONE light capsule from a pickup node to a
       drop node. Capsule: ROUTE -> PICKUP -> HELD -> PLACED -> RELEASED.
       MODE 1 AMBIENT_AUTONOMOUS: a real packet arrival at the pickup
         (glare-halo data-actuator-trigger L, or R for the return lane)
         puts the capsule at PICKUP; only then does the arm move.
       MODE 2 PAC_AUTHORITY: entered once, sticky. Ambient arrivals are
         then ignored. PAC is NOT the controller: a case picks up the
         capsule only if PAC = PERMIT AND SAFETY = ALLOW AND
         EXECUTION = EXECUTED; otherwise the capsule waits at PICKUP. */
  /* ACTUATOR:BEGIN */
  /* Cell-local coordinates. Arm: base (830,636), links 104 + 100, gripper anchor 19 past the wrist. */
  const ACT_ST = { P: [716, 500], N: [776, 500], H: [830, 500], R: [890, 500], E: [944, 500] };
  /* [shoulder, elbow, wrist] degrees. Each station pose puts the gripper anchor on the station with the
     gripper pointing straight down (wrist unwrapped so it never spins); READY is the shared waypoint. */
  const ACT_POSE = {
    REST: [0, 0, 0], READY: [-24.41, -40.14, 154.55],
    P: [-55.35, -51.18, 196.53], N: [-54.82, -17.13, 161.94], H: [-39.6, -8.87, 138.48],
    R: [55.81, -160.89, 195.08], E: [55.35, -128.82, 163.47],
  };
  const ACT_SEQ = {
    TRANSFER_LEFT_TO_RIGHT: { lane: "L", pick: "P", drop: "R", carry: 520 },
    TRANSFER_RIGHT_TO_LEFT: { lane: "R", pick: "E", drop: "P", carry: 520 },
    SHORT_TRANSFER: { lane: "L", pick: "P", drop: "N", carry: 380 },
    DEEP_TRANSFER: { lane: "L", pick: "P", drop: "E", carry: 640 },
    INSPECT_AND_PLACE: { lane: "L", pick: "P", drop: "R", carry: 320, inspect: true },
    PICK_AND_RETURN: { lane: "L", pick: "P", drop: "H", carry: 380 },
  };
  /* Which sequence an ambient arrival plays: the left arrival walks a fixed authored cycle, the right
     (return-lane) arrival is the mirror transfer. A candidate equal to the previous sequence is skipped. */
  const ACT_AMBIENT = {
    L: ["TRANSFER_LEFT_TO_RIGHT", "SHORT_TRANSFER", "DEEP_TRANSFER", "INSPECT_AND_PLACE", "PICK_AND_RETURN"],
    R: ["TRANSFER_RIGHT_TO_LEFT"],
  };
  const PAC_CASES = {
    D01: { request: "SIM_VALVE_ACTION", pac: "PERMIT", safety: "ALLOW", execution: "EXECUTED", sequence: "TRANSFER_LEFT_TO_RIGHT" },
    D02: { request: "SIM_VALVE_ACTION", pac: "DENY", safety: "NOT_REPORTED", execution: "NOT_EXECUTED", sequence: "NONE" },
    D03: { request: "SIM_VALVE_ACTION_REPLAY", pac: "NOT_REPORTED", safety: "NOT_REPORTED", execution: "AUTHORITY_CONSUMED", sequence: "NONE" },
    D04: { request: "SIM_VALVE_ACTION", pac: "PERMIT", safety: "DENY", execution: "NOT_EXECUTED", sequence: "NONE" },
    D05: { request: "SIM_VALVE_ACTION", pac: "DEFER", safety: "NOT_REPORTED", execution: "NOT_EXECUTED", sequence: "NONE" },
  };
  /* The only gate between a PAC case and the capsule. */
  const actuationAllowed = (c) => c.pac === "PERMIT" && c.safety === "ALLOW" && c.execution === "EXECUTED";

  /* One sequence as timed steps: [state, pose+jaw (jaw 1 = closed), ms, capsule event]. */
  const actPlan = (name) => {
    const q = ACT_SEQ[name];
    const at = (k, g) => [...ACT_POSE[k], g];
    const steps = [
      { a: "REACHING", pose: at("READY", 0), ms: 200 },
      { a: "REACHING", pose: at(q.pick, 0), ms: 200 },
      { a: "GRIPPING", pose: at(q.pick, 1), ms: 140 },
    ];
    if (q.inspect) {
      const [s, e, w] = ACT_POSE.READY;
      steps.push({ a: "TRANSFERRING", pose: at("READY", 1), ms: 300, cap: "HELD", node: q.pick });
      steps.push({ a: "TRANSFERRING", pose: [s, e, w + 14, 1], ms: 140 }, { a: "TRANSFERRING", pose: [s, e, w - 14, 1], ms: 180 });
      steps.push({ a: "TRANSFERRING", pose: at(q.drop, 1), ms: q.carry });
    } else {
      steps.push({ a: "TRANSFERRING", pose: at(q.drop, 1), ms: q.carry, cap: "HELD", node: q.pick });
    }
    steps.push({ a: "PLACING", pose: at(q.drop, 0), ms: 140, cap: "PLACED", node: q.drop });
    steps.push({ a: "PLACING", pose: at("READY", 0), ms: 160, cap: "RELEASED", dir: q.lane === "L" ? "R" : "L" });
    steps.push({ a: "PLACING", pose: at("REST", 0), ms: 200 });
    return steps;
  };

  const createActuator = ({ pose, capsule, publish, setTimer, clearTimer, reduced }) => {
    const st = {
      mode: "AMBIENT_AUTONOMOUS", state: "IDLE", capsule: "NONE", route: "NONE",
      request: "NONE", pac: "NONE", safety: "NONE", execution: "NONE", sequence: "NONE",
      runs: 0, takeovers: 0, transfers: 0,
    };
    let cursor = 0;
    let lastSeq = "";
    let timer = null;
    let running = false;
    let takeoverPending = false;
    let pendingCase = null;

    const setCap = (s) => {
      st.capsule = s.cap;
      if (s.cap === "ROUTE") { st.route = "INBOUND"; capsule("spawn", { ms: s.ms }); }
      else if (s.cap === "PICKUP") { if (s.lane) st.route = s.lane === "R" ? "OUTBOUND" : "INBOUND"; if (s.appear) capsule("appear", { node: s.node, ms: s.ms }); }
      else if (s.cap === "HELD") { st.route = "NONE"; capsule("attach", { node: s.node }); }
      else if (s.cap === "PLACED") { capsule("detach", { node: s.node }); }
      else if (s.cap === "RELEASED") { st.route = s.dir === "R" ? "OUTBOUND" : "INBOUND"; capsule("release", { dir: s.dir }); }
    };
    const enter = (s) => {
      if (s.a) st.state = s.a;
      if (s.cap) setCap(s);
      if (s.pose && !reduced()) pose(s.pose[0], s.pose[1], s.pose[2], s.pose[3], s.ms);
      publish(st);
    };
    /* Steps run on a single timer slot; under reduced motion they resolve in one synchronous pass. */
    const exec = (steps, after) => {
      running = true;
      let i = 0;
      const next = () => {
        while (i < steps.length) {
          const s = steps[i++];
          enter(s);
          if (s.ms > 0 && !reduced()) { timer = setTimer(next, s.ms); return; }
        }
        timer = null;
        running = false;
        after();
      };
      next();
    };
    function toPacAuthority() {
      if (st.mode === "PAC_AUTHORITY") return;
      st.mode = "PAC_AUTHORITY";
      st.takeovers += 1;
      st.state = "IDLE";
      st.sequence = "NONE";
      st.capsule = "NONE";
      st.route = "NONE";
      st.request = st.pac = st.safety = st.execution = "NONE";
      publish(st);
    }
    const settle = () => {
      if (st.capsule === "RELEASED") st.transfers += 1;
      st.state = "SETTLED";
      if (takeoverPending) {
        takeoverPending = false;
        toPacAuthority();
        const c = pendingCase;
        pendingCase = null;
        if (c) applyCase(c);
        return;
      }
      publish(st);
    };
    function applyCase(c) {
      st.request = c.request;
      st.pac = c.pac;
      st.safety = c.safety;
      st.execution = c.execution;
      /* A capsule already waiting at PICKUP (an earlier refusal) is reused: only one ever exists. */
      const arrive = st.capsule === "PICKUP" ? [] : [
        { a: "IDLE", cap: "ROUTE", ms: 220 },
        { a: "IDLE", cap: "PICKUP", lane: "L", ms: 0 },
      ];
      if (actuationAllowed(c)) {
        st.sequence = c.sequence;
        st.runs += 1;
        exec([...arrive, ...actPlan(c.sequence)], settle);
        return;
      }
      st.sequence = "NONE";
      st.state = "IDLE";
      exec(arrive, () => { st.state = "IDLE"; publish(st); });
    }

    return {
      state: st,
      /* A qualifying packet arrival at a pickup (lane "L" inbound, "R" return lane). */
      ambientArrival(lane) {
        if (st.mode !== "AMBIENT_AUTONOMOUS" || takeoverPending || running) return false;
        if (st.capsule === "PICKUP" || st.capsule === "HELD" || st.capsule === "PLACED") return false;
        const list = ACT_AMBIENT[lane];
        if (!list) return false;
        const name = lane === "L" ? list[cursor % list.length] : list[0];
        if (name === lastSeq) return false;
        if (lane === "L") cursor += 1;
        lastSeq = name;
        st.sequence = name;
        st.request = "AMBIENT_ARRIVAL";
        st.pac = st.safety = st.execution = "INACTIVE";
        st.runs += 1;
        exec([{ a: "IDLE", cap: "PICKUP", appear: true, lane, node: ACT_SEQ[name].pick, ms: 150 }, ...actPlan(name)], settle);
        return true;
      },
      /* The visitor meaningfully entered the PAC section: finish current motion, then switch once. */
      takeover() {
        if (st.mode === "PAC_AUTHORITY" || takeoverPending) return false;
        if (running) { takeoverPending = true; return true; }
        toPacAuthority();
        return true;
      },
      /* Replay one frozen case. Returns false if refused (unknown id, or mid-motion in PAC mode). */
      runCase(id) {
        const c = PAC_CASES[id];
        if (!c) return false;
        if (st.mode === "AMBIENT_AUTONOMOUS") {
          if (running) { takeoverPending = true; pendingCase = c; return true; }
          toPacAuthority();
        } else if (running) {
          return false;
        }
        applyCase(c);
        return true;
      },
      cancel() { if (timer !== null) { clearTimer(timer); timer = null; } },
    };
  };

  /* The single capsule element for one SVG variant. While HELD it is a child of the wrist group, so it
     follows the end effector through the joint hierarchy with no per-frame code; otherwise it lives on
     the cell layer at a station. `instant()` = reduced motion: place it, never animate it. */
  const createCapsuleView = ({ layer, capsule, wrist, instant }) => {
    const num = (v) => Number(v);
    const [ax, ay] = wrist.getAttribute("data-anchor").split(" ").map(num);
    const enterX = num(capsule.getAttribute("data-enter"));
    const exitR = num(capsule.getAttribute("data-exit-r"));
    const exitL = num(capsule.getAttribute("data-exit-l"));
    const ease = "cubic-bezier(.4,0,.2,1)";
    const put = (x, y, rot, ms, op) => {
      capsule.style.transition = ms && !instant() ? `transform ${ms}ms ${ease},opacity ${ms}ms linear` : "none";
      capsule.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg)`;
      capsule.style.opacity = String(op);
    };
    const on = (parent) => { if (capsule.parentNode !== parent) parent.appendChild(capsule); };
    return (kind, info) => {
      if (kind === "spawn") {
        on(layer);
        put(enterX, ACT_ST.P[1], 0, 0, 0);
        capsule.getBoundingClientRect();
        put(ACT_ST.P[0], ACT_ST.P[1], 0, info.ms, 1);
      } else if (kind === "appear") {
        const [x, y] = ACT_ST[info.node];
        on(layer);
        put(x, y, 0, 0, 0);
        capsule.getBoundingClientRect();
        put(x, y, 0, info.ms, 1);
      } else if (kind === "attach") {
        on(wrist);
        put(ax, ay, 90, 0, 1);
      } else if (kind === "detach") {
        const [x, y] = ACT_ST[info.node];
        on(layer);
        put(x, y, 0, 0, 1);
      } else if (kind === "release") {
        put(info.dir === "R" ? exitR : exitL, ACT_ST.P[1], 0, 300, 0);
      }
    };
  };
  /* ACTUATOR:END */

  /* 011C1 PAC presentation. The controller keeps its own values (NOT_EXECUTED, AUTHORITY_CONSUMED, ...)
     and is not touched. These pure functions only WORD what the public replay and the case notes say, so
     the frozen distinctions stay distinct: D01 EXECUTED; D02 and D05 NO EXECUTION (told apart by PAC DENY
     vs DEFER); D03 NO_EXECUTION:AUTHORITY_CONSUMED; D04 NO_EXECUTION:SAFETY_DENY. Values in, string out;
     no state, no decisions about whether anything runs. Unknown values pass through unchanged. */
  /* PACFMT:BEGIN */
  const presentExecution = (c) => {
    if (c.execution === "NOT_EXECUTED") return c.safety === "DENY" ? "NO_EXECUTION:SAFETY_DENY" : "NO EXECUTION";
    if (c.execution === "AUTHORITY_CONSUMED") return "NO_EXECUTION:AUTHORITY_CONSUMED";
    return c.execution;
  };
  const presentChain = (c) => {
    const parts = [];
    if (c.pac === "DEFER") parts.push("evidence UNKNOWN", "DEFER");
    else if (c.pac === "PERMIT" || c.pac === "DENY") parts.push(`PAC ${c.pac}`);
    if (c.safety === "ALLOW" || c.safety === "DENY") parts.push(`SAFETY ${c.safety}`);
    parts.push(presentExecution(c));
    return parts.join(" → ");
  };
  /* PACFMT:END */

  /* 011C TRACE: pure helpers, no DOM, so scripts/test_actuator.js runs this exact source. TRACE is
     "view source for the visual system": it only re-prints values the controller and the taxonomy
     already publish as data-* on .substrate. Every field is [label, dataset key]; nothing is derived
     or measured here, and an unpublished value reads NONE rather than a guess. */
  /* TRACE:BEGIN */
  const TRACE_FIELDS = [
    ["ACTUATOR_MODE", "actuatorMode"], ["ACTUATOR_STATE", "actuatorState"],
    ["CAPSULE_STATE", "capsuleState"], ["CAPSULE_ROUTE", "capsuleRoute"],
    ["SEQUENCE", "sequence"], ["ACTION_REQUEST", "actionRequest"],
    ["PAC", "pac"], ["SAFETY", "safety"], ["EXECUTION", "execution"],
    ["STAGE", "stage"],
  ];
  const TRACE_ATTRS = TRACE_FIELDS.map(([, key]) => `data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
  const traceRows = (data) => TRACE_FIELDS.map(([label, key]) => [label, data[key] ? (key === "stage" ? data[key].toUpperCase() : data[key]) : "NONE"]);
  const traceCaseNote = (c) => presentChain(c);
  /* TRACE:END */

  const actSubstrate = $(".substrate");
  if (actSubstrate) {
    const pacOut = {};
    $$("[data-pac-out]").forEach((n) => { pacOut[n.dataset.pacOut] = n; });
    const pacFlow = $("#pac-flow");
    const runButtons = $$("[data-pac-run]");
    const d = actSubstrate.dataset;
    const views = $$(".act-layer", actSubstrate).map((layer) => createCapsuleView({
      layer, capsule: $(".act-capsule", layer), wrist: $(".act-wrist", layer), instant: () => reduced.matches,
    }));
    const hooks = (st) => {
      /* TRACE hooks: CAPSULE_STATE, CAPSULE_ROUTE, ACTUATOR_MODE, ACTUATOR_STATE, ACTION_REQUEST, PAC, SAFETY, EXECUTION, SEQUENCE. */
      d.capsuleState = st.capsule;
      d.capsuleRoute = st.route;
      d.actuatorMode = st.mode;
      d.actuatorState = st.state;
      d.actionRequest = st.request;
      d.pac = st.pac;
      d.safety = st.safety;
      d.execution = st.execution;
      d.sequence = st.sequence;
      d.actuatorRender = reduced.matches ? "static" : "animated";
    };
    const actuator = createActuator({
      pose: (s, e, w, g, ms) => {
        actSubstrate.style.setProperty("--act-shoulder", `${s}deg`);
        actSubstrate.style.setProperty("--act-elbow", `${e}deg`);
        actSubstrate.style.setProperty("--act-wrist", `${w}deg`);
        actSubstrate.style.setProperty("--act-jaw", g ? "0" : "18");
        actSubstrate.style.setProperty("--act-t", `${ms}ms`);
      },
      capsule: (kind, info) => views.forEach((v) => v(kind, info)),
      publish: (st) => {
        hooks(st);
        if (pacOut.request) {
          pacOut.request.textContent = st.request;
          pacOut.pac.textContent = st.pac;
          pacOut.safety.textContent = st.safety;
          pacOut.execution.textContent = presentExecution(st);
          pacOut.actuator.textContent = st.sequence === "NONE" ? st.state : `${st.state} · ${st.sequence}`;
          pacOut.capsule.textContent = st.route === "NONE" ? st.capsule : `${st.capsule} · ${st.route}`;
        }
        runButtons.forEach((b) => b.setAttribute("aria-disabled", String(st.mode === "PAC_AUTHORITY" && st.state !== "IDLE" && st.state !== "SETTLED")));
      },
      /* +24ms: let the CSS transition for this step finish its last frame before the next step reads the pose. */
      setTimer: (fn, ms) => window.setTimeout(fn, ms + 24),
      clearTimer: (h) => window.clearTimeout(h),
      reduced: () => reduced.matches,
    });
    hooks(actuator.state);

    /* MODE 1 trigger: a packet's arrival glare at the pickup starts an iteration (L = inbound, R = return lane). */
    $$("[data-actuator-trigger]").forEach((halo) => {
      const arrive = (e) => {
        if (e.animationName === "glare-flare" && !document.hidden) actuator.ambientArrival(halo.dataset.actuatorTrigger);
      };
      halo.addEventListener("animationstart", arrive);
      halo.addEventListener("animationiteration", arrive);
    });

    /* MODE 2 trigger: the reading line crosses the PAC section (same band the zone switcher uses). */
    const pacSection = $("#pac");
    if (pacSection && "IntersectionObserver" in window) {
      const pacWatch = new IntersectionObserver((entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        actuator.takeover();
        pacWatch.disconnect();
      }, { rootMargin: "-45% 0px -50% 0px" });
      pacWatch.observe(pacSection);
    }

    runButtons.forEach((b) => {
      b.hidden = false;
      b.addEventListener("click", () => {
        if (b.getAttribute("aria-disabled") === "true") return;
        if (pacFlow) pacFlow.hidden = false;
        actuator.runCase(b.dataset.pacRun);
      });
    });

    /* 011C TRACE control. OFF by default; the readout is a second view of the data-* state above, never
       a second state machine. The observer exists only while TRACE is ON (no work at all when OFF), it
       is event-driven (one callback per batch of attribute changes, no polling, no RAF, no timer), and
       a value is written to the DOM only if it changed. The readout is not a live region: it is not
       announced as it changes. */
    const topEnd = $(".topbar-end");
    if (topEnd) {
      const root = document.documentElement;
      const TRACE_KEY = "zn-trace";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "trace-toggle";
      toggle.setAttribute("aria-pressed", "false");
      const word = document.createElement("span");
      word.textContent = "TRACE";
      const flag = document.createElement("span");
      flag.className = "trace-toggle-state";
      flag.textContent = "OFF";
      toggle.append(word, " ", flag);
      topEnd.prepend(toggle);
      root.dataset.tracemode = "off";

      let strip = null;
      const cells = [];
      const paint = () => traceRows(d).forEach(([, value], i) => {
        if (cells[i].textContent !== value) cells[i].textContent = value;
      });
      const observer = new MutationObserver(paint);
      const buildStrip = () => {
        strip = document.createElement("div");
        strip.className = "trace-strip";
        strip.setAttribute("role", "group");
        strip.setAttribute("aria-label", "Trace readout");
        const lead = document.createElement("p");
        lead.className = "tr-lead";
        const tag = document.createElement("span");
        tag.className = "tr-offline";
        tag.textContent = "OFFLINE — VERIFIED TRACE REPLAY";
        lead.append(tag, " not live PAC · no robot connected · raw controller values");
        const list = document.createElement("p");
        list.className = "tr-fields";
        TRACE_FIELDS.forEach(([label]) => {
          const field = document.createElement("span");
          field.className = "tr-f";
          const key = document.createElement("span");
          key.className = "tr-k";
          key.textContent = label;
          const cell = document.createElement("span");
          cell.className = "tr-v";
          cells.push(cell);
          field.append(key, ":", cell);
          list.append(field);
        });
        strip.append(lead, list);
        document.body.append(strip);
        /* PAC trace: each case row prints its frozen public outcome, worded by presentChain() from the controller's own table. */
        $$("[data-pac-case]").forEach((row) => {
          const c = PAC_CASES[row.dataset.pacCase];
          const holder = $(".ledger-v", row);
          if (!c || !holder) return;
          const note = document.createElement("span");
          note.className = "tr-note";
          note.textContent = traceCaseNote(c);
          holder.append(note);
        });
      };
      const setTrace = (on, remember) => {
        if (on && !strip) buildStrip();
        root.dataset.tracemode = on ? "on" : "off";
        toggle.setAttribute("aria-pressed", String(on));
        flag.textContent = on ? "ON" : "OFF";
        if (strip) strip.hidden = !on;
        if (on) {
          paint();
          observer.observe(actSubstrate, { attributes: true, attributeFilter: TRACE_ATTRS });
        } else {
          observer.disconnect();
        }
        if (!remember) return;
        try {
          if (on) window.sessionStorage.setItem(TRACE_KEY, "1");
          else window.sessionStorage.removeItem(TRACE_KEY);
        } catch (_) { /* storage unavailable: the toggle still works for this page view */ }
      };
      toggle.addEventListener("click", () => setTrace(toggle.getAttribute("aria-pressed") !== "true", true));
      let remembered = false;
      try { remembered = window.sessionStorage.getItem(TRACE_KEY) === "1"; } catch (_) { remembered = false; }
      if (remembered) setTrace(true, false);
    }
  }

  /* Inspection: mark the section being read in "On this page". */
  const tocLinks = $$('.toc a[href^="#"]');
  if (tocLinks.length && "IntersectionObserver" in window) {
    const byId = new Map(tocLinks.map((a) => [a.getAttribute("href").slice(1), a]));
    const spy = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (!en.isIntersecting) return;
        tocLinks.forEach((a) => a.classList.remove("is-active"));
        const link = byId.get(en.target.id);
        if (link) link.classList.add("is-active");
      }),
      { rootMargin: "-18% 0px -70% 0px" }
    );
    byId.forEach((_, id) => { const h = document.getElementById(id); if (h) spy.observe(h); });
  }

  /* Company context: ?c=<slug>, accepted only if the slug is a published company page. */
  const params = new URLSearchParams(window.location.search);
  const ctxSlug = params.get("c");
  const ctx = ctxSlug && Object.prototype.hasOwnProperty.call(companies, ctxSlug) ? ctxSlug : null;
  const ownCompany = document.body.dataset.company || null;
  const GENERAL = ["/r", "/r/thesis", "/r/resume", "/r/open-letter", "/r/research/pac"];
  if (ctx && ctx !== ownCompany) {
    $$("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      const path = href.split("#")[0];
      if (!GENERAL.includes(path)) return;
      const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
      a.setAttribute("href", `${path}?c=${encodeURIComponent(ctx)}${hash}`);
    });
    const chip = document.createElement("p");
    chip.className = "ctx";
    const k = document.createElement("span");
    k.className = "ctx-k";
    k.textContent = "Viewing for";
    const back = document.createElement("a");
    back.href = `/r/companies/${encodeURIComponent(ctx)}`;
    back.textContent = `${companies[ctx].name} — back to its page`;
    chip.append(k, " ", back);
    const anchor = $(".doc-head") || $(".hero");
    if (anchor) anchor.prepend(chip);
    const row = $(`[data-selector] li[data-company="${CSS.escape(ctx)}"]`);
    if (row) row.classList.add("is-context");
  }

  /* Selector: type to narrow the list; Enter opens the first match. */
  $$("[data-selector]").forEach((list, n) => {
    const rows = $$("li", list);
    if (rows.length < 2) return;
    const wrap = document.createElement("p");
    wrap.className = "sel-filter";
    const label = document.createElement("label");
    label.htmlFor = `sel-filter-${n}`;
    label.textContent = "Find";
    const input = document.createElement("input");
    input.type = "search";
    input.id = `sel-filter-${n}`;
    input.placeholder = "Type your company";
    input.autocomplete = "off";
    input.spellcheck = false;
    wrap.append(label, input);
    list.before(wrap);
    const empty = document.createElement("p");
    empty.className = "sel-empty";
    empty.hidden = true;
    empty.append("Not in this list — ");
    const letter = document.createElement("a");
    letter.href = "/r/open-letter";
    letter.textContent = "the open letter is the general version";
    empty.append(letter, ".");
    list.after(empty);
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((r) => {
        const hit = !q || r.textContent.toLowerCase().includes(q);
        r.hidden = !hit;
        if (hit) shown += 1;
      });
      empty.hidden = shown > 0;
    };
    input.addEventListener("input", apply);
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const first = rows.find((r) => !r.hidden);
      if (first) { e.preventDefault(); window.location.href = $("a", first).getAttribute("href"); }
    });
  });

  /* Copy link: the exact URL being viewed, including company context. */
  $$("[data-copy]").forEach((btn) => {
    const status = btn.parentElement.querySelector(".share-status");
    const urlText = btn.parentElement.querySelector(".share-url");
    btn.hidden = false;
    btn.addEventListener("click", async () => {
      const url = window.location.href.split("#")[0];
      try {
        await navigator.clipboard.writeText(url);
        if (status) status.textContent = "Copied";
      } catch (_) {
        if (urlText) {
          urlText.textContent = url;
          const range = document.createRange();
          range.selectNodeContents(urlText);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        if (status) status.textContent = "Selected — copy with your keyboard";
      }
      window.setTimeout(() => { if (status) status.textContent = ""; }, 2400);
    });
  });

  /* Bug / compliment: add the exact page and company context to the message body. */
  const fb = $("[data-feedback]");
  if (fb) {
    const build = ($("[data-build]") || {}).textContent || "";
    const href = fb.getAttribute("href");
    const [addr, query] = href.split("?");
    const q = new URLSearchParams(query || "");
    const lines = [`Page: ${window.location.pathname}${window.location.search}`];
    const company = ctx || ownCompany;
    if (company && companies[company]) lines.push(`Company context: ${companies[company].name}`);
    lines.push(`Build: ${build.trim()}`, "", "What worked, what broke, or what you expected:", "");
    q.set("body", lines.join("\n"));
    fb.setAttribute("href", `${addr}?${q.toString().replace(/\+/g, "%20")}`);
  }

  /* Command palette (⌘K / Ctrl+K). */
  const trigger = $("[data-cmdk]");
  const routes = $$(".menu-panel a[href]");
  if (!trigger || !routes.length || typeof window.HTMLDialogElement !== "function") return;
  const plain = (node) => {
    const clone = node.cloneNode(true);
    $$('[aria-hidden="true"], .bus-k', clone).forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  };
  const terms = {
    "/r": "start home roboboston",
    "/r/thesis": "why systems signal audio career",
    "/r#companies": "company employer dossier selector",
    "/r/open-letter": "general letter cover",
    "/r/resume": "cv record experience",
    "/r/research/pac": "authority safety research",
    "/r/downloads/": "pdf download artifact resume thesis letter",
    "#contact": "email reach feedback",
  };
  const items = routes.map((a) => ({
    label: plain(a),
    key: ($(".bus-k", a) || {}).textContent || "",
    href: a.getAttribute("href"),
    group: "Route",
    terms: terms[a.getAttribute("href")] || "",
  })).filter((it, i, all) => all.findIndex((o) => o.href === it.href) === i);
  Object.keys(companies).forEach((slug) => items.push({
    label: companies[slug].name, key: "co", href: `/r/companies/${slug}`, group: "Companies", terms: "company dossier",
  }));
  $$("main h2[id]").forEach((h) => items.push({ label: plain(h), key: "§", href: `#${h.id}`, group: "On this page", terms: "" }));

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  const keyNode = $("[data-cmdk-key]", trigger);
  if (keyNode) keyNode.textContent = isMac ? "⌘K" : "Ctrl K";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-keyshortcuts", isMac ? "Meta+K" : "Control+K");
  trigger.hidden = false;

  let dialog, input, list, shown = [], active = 0;
  const select = (i) => {
    if (!shown.length) return;
    active = Math.max(0, Math.min(i, shown.length - 1));
    $$("[role=option]", list).forEach((o) => o.setAttribute("aria-selected", String(Number(o.dataset.i) === active)));
    const current = $(`#pal-opt-${active}`, list);
    if (current) { input.setAttribute("aria-activedescendant", current.id); current.scrollIntoView({ block: "nearest" }); }
  };
  const go = (item) => {
    // Only close once a real destination is confirmed — a failed search must leave
    // the palette open with the query editable (2026-09-18 audit fix).
    if (!item) return;
    if (item.href.startsWith("#")) {
      const target = document.getElementById(item.href.slice(1));
      if (!target) return;
      dialog.close();
      target.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
      history.replaceState(null, "", item.href);
    } else {
      dialog.close();
      window.location.href = item.href;
    }
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter((it) => !q || `${it.label} ${it.terms} ${it.href}`.toLowerCase().includes(q));
    list.textContent = "";
    if (!shown.length) {
      const none = document.createElement("p");
      none.className = "pal-empty";
      none.textContent = "No matching destination.";
      list.append(none);
      input.removeAttribute("aria-activedescendant");
      return;
    }
    let group = null, holder = list;
    shown.forEach((it, i) => {
      if (it.group !== group) {
        group = it.group;
        holder = document.createElement("div");
        holder.setAttribute("role", "group");
        const cap = document.createElement("p");
        cap.className = "pal-group";
        cap.id = `pal-group-${i}`;
        cap.textContent = group;
        holder.setAttribute("aria-labelledby", cap.id);
        holder.append(cap);
        list.append(holder);
      }
      const opt = document.createElement("div");
      opt.className = "pal-opt";
      opt.id = `pal-opt-${i}`;
      opt.dataset.i = String(i);
      opt.setAttribute("role", "option");
      [["pal-opt-k", it.key], ["pal-opt-label", it.label], ["pal-opt-path", it.href]].forEach(([cls, text]) => {
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = text;
        opt.append(span);
      });
      holder.append(opt);
    });
    select(0);
  };
  const build = () => {
    dialog = document.createElement("dialog");
    dialog.className = "palette";
    dialog.setAttribute("aria-label", "Go to");
    const head = document.createElement("div");
    head.className = "pal-head";
    input = document.createElement("input");
    input.className = "pal-input";
    input.type = "text";
    input.placeholder = "Go to a page, company or section…";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", "pal-list");
    input.setAttribute("aria-autocomplete", "list");
    input.autocomplete = "off";
    input.spellcheck = false;
    const esc = document.createElement("kbd");
    esc.className = "pal-esc";
    esc.textContent = "esc";
    head.append(input, esc);
    list = document.createElement("div");
    list.className = "pal-list";
    list.id = "pal-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "Destinations");
    const foot = document.createElement("div");
    foot.className = "pal-foot";
    ["↑↓ move", "↵ open", "esc close"].forEach((hint) => {
      const span = document.createElement("span");
      span.textContent = hint;
      foot.append(span);
    });
    dialog.append(head, list, foot);
    document.body.append(dialog);
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); select(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); select(active - 1); }
      else if (e.key === "Home") { e.preventDefault(); select(0); }
      else if (e.key === "End") { e.preventDefault(); select(shown.length - 1); }
      else if (e.key === "Enter") { e.preventDefault(); go(shown[active]); }
    });
    list.addEventListener("click", (e) => { const o = e.target.closest("[role=option]"); if (o) go(shown[Number(o.dataset.i)]); });
    list.addEventListener("mousemove", (e) => { const o = e.target.closest("[role=option]"); if (o) select(Number(o.dataset.i)); });
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  };
  const open = () => {
    if (!dialog) build();
    input.value = "";
    render();
    dialog.showModal();
    input.focus();
  };
  trigger.addEventListener("click", open);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (dialog && dialog.open) dialog.close();
      else open();
    }
  });
})();
