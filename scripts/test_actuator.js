#!/usr/bin/env node
/* 011B4 actuator + PAC authority tests, plus 011C TRACE tests.

   Runs the exact controller source that ships in public/assets/site.js (the
   text between the ACTUATOR:BEGIN / ACTUATOR:END markers) and the exact TRACE
   helpers (TRACE:BEGIN / TRACE:END) against fake effects and a fake timer, so
   it needs no DOM and no browser. It proves the state machine, the safety
   invariant and what TRACE prints; it does not prove how anything looks (that
   is an owner visual check). Ported 2026-09-18 from the 011B3 pose-sequence
   model to the 011B4 capsule-transfer controller; same invariants. */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const js = read("public/assets/site.js");
const css = read("public/assets/site.css");
const html = read("public/index.html");

const slice = (from, to, label) => {
  const a = js.indexOf(from);
  const b = js.indexOf(to);
  if (a < 0 || b < a) { console.log(`actuator: FAIL  ${label} markers missing from site.js`); process.exit(1); }
  return js.slice(a, b);
};
const src = slice("/* ACTUATOR:BEGIN */", "/* ACTUATOR:END */", "ACTUATOR");
const traceSrc = slice("/* TRACE:BEGIN */", "/* TRACE:END */", "TRACE");
const fmtSrc = slice("/* PACFMT:BEGIN */", "/* PACFMT:END */", "PACFMT");
const lib = new Function(`${src}; return { ACT_SEQ, ACT_AMBIENT, ACT_POSE, ACT_ST, PAC_CASES, actuationAllowed, actPlan, createActuator, createCapsuleView };`)();
const fmt = new Function(`${fmtSrc}; return { presentExecution, presentChain };`)();
const tr = new Function(`${fmtSrc}; ${traceSrc}; return { TRACE_FIELDS, TRACE_ATTRS, traceRows, traceCaseNote };`)();

let passed = 0;
const failures = [];
const ok = (cond, name) => { if (cond) passed += 1; else failures.push(name); };

/* Fake effects: a manual clock with a timer list; every publish is snapshotted. */
const rig = ({ reduced = false } = {}) => {
  const rc = { poses: [], caps: [], snaps: [], timers: [], maxTimers: 0, now: 0 };
  const act = lib.createActuator({
    pose: (s, e, w, g, ms) => rc.poses.push([s, e, w, g, ms]),
    capsule: (kind, info) => rc.caps.push({ kind, ...info }),
    publish: (st) => rc.snaps.push({ ...st }),
    setTimer: (fn, ms) => {
      const t = { fn, at: rc.now + ms };
      rc.timers.push(t);
      rc.maxTimers = Math.max(rc.maxTimers, rc.timers.length);
      return t;
    },
    clearTimer: (t) => { rc.timers = rc.timers.filter((x) => x !== t); },
    reduced: () => reduced,
  });
  /* Advance until no timer remains (each fire may schedule the next step). */
  rc.drain = () => {
    let guard = 0;
    while (rc.timers.length && guard++ < 200) {
      rc.timers.sort((a, b) => a.at - b.at);
      const t = rc.timers.shift();
      rc.now = t.at;
      t.fn();
    }
  };
  rc.act = act;
  return rc;
};
const moved = (rc) => rc.poses.length > 0;
const kinds = (rc) => rc.caps.map((c) => c.kind);

/* --- sequence library ------------------------------------------------- */
const names = Object.keys(lib.ACT_SEQ);
ok(names.length >= 5 && names.length <= 8, "sequence count is 5-8");
["TRANSFER_LEFT_TO_RIGHT", "TRANSFER_RIGHT_TO_LEFT", "SHORT_TRANSFER", "DEEP_TRANSFER", "INSPECT_AND_PLACE", "PICK_AND_RETURN"].forEach((n) => ok(names.includes(n), `sequence ${n} exists`));
names.forEach((n) => {
  const q = lib.ACT_SEQ[n];
  ok(["L", "R"].includes(q.lane) && lib.ACT_ST[q.pick] && lib.ACT_ST[q.drop] && lib.ACT_POSE[q.pick] && lib.ACT_POSE[q.drop], `${n} names real stations and poses`);
});
ok(Object.values(lib.ACT_AMBIENT).flat().every((n) => names.includes(n)), "ambient lists only name authored sequences");
ok(!/Math\.random/.test(src), "controller uses no randomness");
ok(!/requestAnimationFrame|setInterval/.test(src), "controller uses no RAF / interval");

/* --- MODE 1: ambient -------------------------------------------------- */
{
  const rc = rig();
  const st = rc.act.state;
  ok(st.mode === "AMBIENT_AUTONOMOUS" && st.state === "IDLE" && st.capsule === "NONE" && st.route === "NONE", "starts AMBIENT_AUTONOMOUS / IDLE / no capsule");
  ok(rc.act.ambientArrival("L") === true, "a real packet arrival at the pickup is accepted");
  ok(st.capsule === "PICKUP" && kinds(rc)[0] === "appear", "the capsule is at PICKUP before the arm moves");
  ok(rc.act.ambientArrival("L") === false && st.runs === 1, "arrival while moving is dropped, not queued");
  rc.drain();
  ok(st.state === "SETTLED" && st.capsule === "RELEASED" && st.transfers === 1 && rc.timers.length === 0, "ambient run settles with the capsule released and no timer left");
  const last = rc.poses[rc.poses.length - 1];
  ok(last[0] === 0 && last[1] === 0 && last[2] === 0, "arm returns to rest after an ambient run");
  ok(["attach", "detach", "release"].every((k) => kinds(rc).includes(k)) && kinds(rc).indexOf("attach") < kinds(rc).indexOf("detach") && kinds(rc).indexOf("detach") < kinds(rc).indexOf("release"), "capsule is attached, then placed, then released, in that order");
}
{
  const rc = rig();
  const seen = [];
  for (let i = 0; i < 15; i += 1) { rc.act.ambientArrival("L"); seen.push(rc.act.state.sequence); rc.drain(); }
  ok(seen.every((n, i) => i === 0 || n !== seen[i - 1]), "no immediate sequence repeat over 15 left arrivals");
  ok(new Set(seen).size === lib.ACT_AMBIENT.L.length, "every authored left-lane sequence is reachable ambiently");
  ok(rc.act.ambientArrival("R") === true && rc.act.state.sequence === "TRANSFER_RIGHT_TO_LEFT" && rc.act.state.route === "OUTBOUND", "the right (return) lane plays the mirror transfer");
  rc.drain();
  ok(rc.maxTimers <= 1, "at most one timer alive during ambient runs");
}

/* --- MODE 2: takeover, sticky ---------------------------------------- */
{
  const rc = rig();
  ok(rc.act.takeover() === true && rc.act.state.mode === "PAC_AUTHORITY" && rc.act.state.takeovers === 1, "PAC takeover switches once");
  ok(rc.act.takeover() === false && rc.act.state.takeovers === 1, "second takeover is a no-op (exactly once)");
  const before = rc.poses.length;
  for (let i = 0; i < 10; i += 1) rc.act.ambientArrival("L");
  ok(rc.poses.length === before && rc.act.state.runs === 0 && rc.act.state.mode === "PAC_AUTHORITY", "ambient arrivals stay inert after takeover (sticky)");
}
{
  const rc = rig();
  rc.act.ambientArrival("L");
  ok(rc.act.takeover() === true && rc.act.state.mode === "AMBIENT_AUTONOMOUS", "takeover during motion is deferred, mode unchanged mid-motion");
  ok(rc.act.ambientArrival("L") === false, "no new ambient motion while a takeover is pending");
  rc.drain();
  ok(rc.act.state.mode === "PAC_AUTHORITY" && rc.act.state.takeovers === 1 && rc.act.state.runs === 1 && rc.act.state.capsule === "NONE", "current motion finished, then switched exactly once, capsule cleared");
}

/* --- frozen demo cases ------------------------------------------------ */
{
  const rc = rig();
  rc.act.takeover();
  ok(rc.act.runCase("D01") === true && rc.act.state.runs === 1, "D01 is accepted (one run)");
  ok(rc.act.runCase("D02") === false && rc.act.state.runs === 1, "case refused while the arm is mid-motion");
  rc.drain();
  const st = rc.act.state;
  ok(moved(rc) && st.state === "SETTLED" && st.runs === 1 && rc.maxTimers <= 1, "D01 moved exactly once and settled");
  ok(st.request === "SIM_VALVE_ACTION" && st.pac === "PERMIT" && st.safety === "ALLOW" && st.execution === "EXECUTED" && st.sequence === "TRANSFER_LEFT_TO_RIGHT", "D01 state is PERMIT / ALLOW / EXECUTED, TRANSFER_LEFT_TO_RIGHT");
  ok(st.capsule === "RELEASED" && kinds(rc).filter((k) => k === "spawn").length === 1, "D01 carried the one capsule through to RELEASED");
}
const expectRefusal = { D02: ["DENY", "NOT_REPORTED", "NOT_EXECUTED"], D03: ["NOT_REPORTED", "NOT_REPORTED", "AUTHORITY_CONSUMED"], D04: ["PERMIT", "DENY", "NOT_EXECUTED"], D05: ["DEFER", "NOT_REPORTED", "NOT_EXECUTED"] };
Object.entries(expectRefusal).forEach(([id, [pac, safety, execution]]) => {
  const rc = rig();
  rc.act.takeover();
  rc.act.runCase(id);
  rc.drain();
  const st = rc.act.state;
  ok(!moved(rc) && st.runs === 0 && st.state === "IDLE" && st.sequence === "NONE", `${id} does not move the arm`);
  ok(st.capsule === "PICKUP" && !kinds(rc).some((k) => ["attach", "detach", "release"].includes(k)), `${id} leaves the capsule waiting at PICKUP`);
  ok(st.pac === pac && st.safety === safety && st.execution === execution, `${id} reports ${pac} / ${safety} / ${execution}`);
});
{
  const rc = rig();
  rc.act.takeover();
  rc.act.runCase("D04");
  rc.drain();
  rc.act.runCase("D01");
  rc.drain();
  ok(kinds(rc).filter((k) => k === "spawn").length === 1 && rc.act.state.capsule === "RELEASED", "a capsule waiting after a refusal is reused; only one ever exists");
  ok(rc.act.runCase("D99") === false, "unknown case id refused");
}
{
  /* Invariant over the whole value space: only PERMIT+ALLOW+EXECUTED may actuate. */
  const pacV = ["PERMIT", "DENY", "DEFER", "NOT_REPORTED", "NONE"];
  const safeV = ["ALLOW", "DENY", "NOT_REPORTED", "NONE"];
  const execV = ["EXECUTED", "NOT_EXECUTED", "AUTHORITY_CONSUMED", "NONE"];
  let clean = true;
  pacV.forEach((pac) => safeV.forEach((safety) => execV.forEach((execution) => {
    const allowed = lib.actuationAllowed({ pac, safety, execution });
    if (allowed !== (pac === "PERMIT" && safety === "ALLOW" && execution === "EXECUTED")) clean = false;
  })));
  ok(clean, "actuation gate is exactly PERMIT AND ALLOW AND EXECUTED");
  ok(Object.entries(lib.PAC_CASES).every(([id, c]) => lib.actuationAllowed(c) === (id === "D01")), "only D01 is actuating in the frozen table");
}
{
  /* In every published state of every scenario, a PAC-mode capsule is held/placed/released only under a full gate. */
  const rc = rig();
  rc.act.takeover();
  ["D02", "D01", "D03", "D04", "D05", "D01"].forEach((id) => { rc.act.runCase(id); rc.drain(); });
  const carried = rc.snaps.filter((s) => ["HELD", "PLACED", "RELEASED"].includes(s.capsule));
  ok(carried.length > 0 && carried.every((s) => s.pac === "PERMIT" && s.safety === "ALLOW" && s.execution === "EXECUTED"), "in PAC mode the capsule is only ever carried under PERMIT + ALLOW + EXECUTED");
  ok(rc.snaps.every((s) => s.capsule !== "HELD" || s.state === "TRANSFERRING"), "HELD only ever appears while TRANSFERRING");
}
{
  /* A case clicked before the section observer fired: takeover first, then that case, once. */
  const rc = rig();
  rc.act.runCase("D01");
  rc.drain();
  ok(rc.act.state.mode === "PAC_AUTHORITY" && rc.act.state.takeovers === 1 && rc.act.state.runs === 1, "case before takeover promotes to PAC once, then moves once");
  const rd = rig();
  rd.act.ambientArrival("L");
  rd.act.runCase("D01");
  ok(rd.act.state.mode === "AMBIENT_AUTONOMOUS" && rd.act.state.runs === 1, "case during ambient motion waits for it to finish");
  rd.drain();
  ok(rd.act.state.mode === "PAC_AUTHORITY" && rd.act.state.runs === 2 && rd.act.state.takeovers === 1 && rd.maxTimers <= 1, "pending case then runs exactly once after takeover");
}

/* --- reduced motion --------------------------------------------------- */
{
  const rc = rig({ reduced: true });
  rc.act.takeover();
  rc.act.runCase("D01");
  ok(!moved(rc) && rc.timers.length === 0, "reduced motion: arm never posed, no timers");
  const st = rc.act.state;
  ok(st.pac === "PERMIT" && st.safety === "ALLOW" && st.execution === "EXECUTED" && st.sequence === "TRANSFER_LEFT_TO_RIGHT" && st.state === "SETTLED" && st.capsule === "RELEASED", "reduced motion: D01 state logic still correct");
  rc.act.runCase("D04");
  ok(!rc.timers.length && st.safety === "DENY" && st.state === "IDLE" && st.capsule === "PICKUP", "reduced motion: D04 state logic still correct");
  const ra = rig({ reduced: true });
  ra.act.ambientArrival("L");
  ok(!moved(ra) && ra.timers.length === 0 && ra.act.state.state === "SETTLED" && ra.act.state.mode === "AMBIENT_AUTONOMOUS", "reduced motion: ambient arrival resolves without posing the arm");
}

/* --- 011C1 actuator kinematics (current 011B4 arm) ---------------------- */
/* The geometry is READ from the shipped markup and CSS, not restated here, so the test follows the
   arm as drawn: base -> shoulder -> upper link -> elbow -> forearm -> wrist -> end effector, each joint
   rotating about its own rest coordinate (nested <g>, css transform-origin), the gripper anchor being the
   point the capsule is re-parented to while HELD. Forward kinematics mirrors that nesting exactly:
   p' = Shoulder(Elbow(Wrist(p))). The limits below are declared here for the accepted arm (the
   controller defines none); edit them deliberately if the arm design changes. */
{
  const rad = (d) => (d * Math.PI) / 180;
  const rot = (deg, c, p) => { const a = rad(deg), co = Math.cos(a), si = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1]; return [c[0] + co * dx - si * dy, c[1] + si * dx + co * dy]; };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const nums = (m) => m.slice(1).map(Number);

  /* variants: the desktop layer and the portrait layer carry the same arm */
  const armRe = /<g class="act-shoulder"[^>]*>\s*<line class="act-link" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>\s*<g class="act-elbow"[^>]*>\s*<line class="act-link" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>\s*<g class="act-wrist"[^>]*data-anchor="(\d+) (\d+)"[^>]*>\s*<line class="act-eff" [^>]*\/>\s*<line class="act-eff" [^>]*\/>\s*<line class="act-eff act-jaw act-jaw--a" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>\s*<line class="act-eff act-jaw act-jaw--b" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"\/>/g;
  const arms = [...html.matchAll(armRe)].map(nums);
  ok(arms.length === 2 && JSON.stringify(arms[0]) === JSON.stringify(arms[1]), "both substrate variants draw the identical arm in cell-local coordinates");
  const [sx, sy, ex, ey, e2x, e2y, wx, wy, ax, ay, jax1, jay1, jax2, jay2, jbx1, jby1, jbx2, jby2] = arms[0];
  const S = [sx, sy], E = [ex, ey], W = [wx, wy], A0 = [ax, ay];
  ok(e2x === ex && e2y === ey, "the forearm starts exactly where the upper link ends (elbow joint)");
  ok(dist(S, E) === 104 && dist(E, W) === 100 && sx === ex && ey === e2y && wy === ey, "links are 104 (up) and 100 (right) at rest");
  ok(Math.abs(ax - (jax1 + jax2) / 2) <= 1 && ay === (jay1 + jby1) / 2 && ax - wx === 19, "the gripper anchor is on the forearm axis, 19 past the wrist, at the midpoint of the jaws");

  const css1 = (sel) => (css.match(new RegExp(`\\.${sel}\\{transform-origin:(\\d+)px (\\d+)px`)) || []).slice(1).map(Number);
  ok(JSON.stringify(css1("act-shoulder")) === JSON.stringify(S) && JSON.stringify(css1("act-elbow")) === JSON.stringify(E) && JSON.stringify(css1("act-wrist")) === JSON.stringify(W), "css joint origins are the joint coordinates: base, elbow, wrist");
  ok(JSON.stringify(css1("act-jaw--a")) === JSON.stringify([jax1, jay1]) && JSON.stringify(css1("act-jaw--b")) === JSON.stringify([jbx1, jby1]), "css jaw origins are the jaw roots");
  const JAW_OPEN = Number((js.match(/g \? "0" : "(\d+)"/) || [])[1]);
  ok(JAW_OPEN === 18 && /--act-jaw,18\) \* -1deg/.test(css) && /--act-jaw,18\) \* 1deg/.test(css), "jaws open 18 degrees, closed 0, mirrored");

  /* cell (work envelope) and stations, from the same markup, both variants */
  const cells = [...html.matchAll(/<rect class="dash pulse"[^>]* x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"\/>/g)].map(nums);
  const layerShift = (html.match(/<g class="act-layer" transform="translate\((-?\d+) (-?\d+)\)"/) || []).slice(1).map(Number);
  ok(cells.length === 2 && cells[1][0] === cells[0][0] + layerShift[0] && cells[1][1] === cells[0][1] + layerShift[1] && cells[1][2] === cells[0][2] && cells[1][3] === cells[0][3], "the portrait cell is the desktop cell translated by the layer transform");
  const [cx0, cy0, cw, ch] = cells[0];
  const inCell = (p) => p[0] >= cx0 && p[0] <= cx0 + cw && p[1] >= cy0 && p[1] <= cy0 + ch;
  const stations = [...html.matchAll(/data-station="(\w)" cx="(\d+)" cy="(\d+)"/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  ok(stations.length === 10 && ["P", "N", "H", "R", "E"].every((k) => stations.filter((s) => s[0] === k).length === 2 && stations.filter((s) => s[0] === k).every((s) => s[1] === lib.ACT_ST[k][0] && s[2] === lib.ACT_ST[k][1])), "controller stations P N H R E match the drawn stations in both variants");
  ok(Object.values(lib.ACT_ST).every(inCell), "every station is inside the actuation cell");

  const LIM = { s: [-60, 60], e: [-170, 5], w: [-5, 205] };   /* declared limits of the accepted arm */
  const MAX_JUMP = 180;                                          /* deg per joint per step: never more than half a turn, so no step can spin */
  const TOL = 1;                                                 /* px */
  const jawDeg = (g) => (g ? 0 : JAW_OPEN);
  const fkOf = (s, e, w, jaw) => {
    const chain = (p) => rot(s, S, rot(e, E, rot(w, W, p)));
    return {
      elbow: rot(s, S, E), wrist: rot(s, S, rot(e, E, W)), anchor: chain(A0),
      tips: [chain(rot(-jaw, [jax1, jay1], [jax2, jay2])), chain(rot(jaw, [jbx1, jby1], [jbx2, jby2]))],
      heading: s + e + w,
    };
  };
  const fk = (pose) => fkOf(pose[0], pose[1], pose[2], jawDeg(pose[3]));
  const REST = [...lib.ACT_POSE.REST, 0];
  ok(JSON.stringify(lib.ACT_POSE.REST) === "[0,0,0]", "REST is all zeros");

  /* every named station pose puts the anchor on its station, gripper straight down */
  ["P", "N", "H", "R", "E"].forEach((k) => {
    const f = fk([...lib.ACT_POSE[k], 1]);
    ok(dist(f.anchor, lib.ACT_ST[k]) <= TOL, `pose ${k} puts the anchor on station ${k} (within ${TOL}px)`);
    ok(Math.abs((((f.heading % 360) + 360) % 360) - 90) <= 1, `pose ${k} points the gripper straight down`);
  });

  Object.keys(lib.ACT_SEQ).forEach((name) => {
    const q = lib.ACT_SEQ[name];
    const plan = lib.actPlan(name);
    const posed = plan.filter((s) => s.pose);
    ok(q.pick === (q.lane === "L" ? "P" : "E") && q.drop !== q.pick, `${name}: picks up at its lane's station and drops elsewhere`);
    ok(JSON.stringify(plan.filter((s) => s.cap).map((s) => s.cap)) === '["HELD","PLACED","RELEASED"]', `${name}: capsule events are HELD, PLACED, RELEASED exactly once, in order`);

    let prev = REST, bad = null;
    posed.forEach((step, i) => {
      const [s, e, w] = step.pose;
      if (!(s >= LIM.s[0] && s <= LIM.s[1])) bad = bad || `step ${i} shoulder ${s}`;
      if (!(e >= LIM.e[0] && e <= LIM.e[1])) bad = bad || `step ${i} elbow ${e}`;
      if (!(w >= LIM.w[0] && w <= LIM.w[1])) bad = bad || `step ${i} wrist ${w}`;
      if (!(step.ms >= 100 && step.ms <= 800)) bad = bad || `step ${i} duration ${step.ms}`;
      const jump = Math.max(Math.abs(s - prev[0]), Math.abs(e - prev[1]), Math.abs(w - prev[2]));
      if (jump > MAX_JUMP) bad = bad || `step ${i} jump ${jump}`;
      /* the css transition interpolates each joint angle linearly, so sample the whole travel */
      for (let n = 0; n <= 8; n += 1) {
        const l = (a, b) => a + ((b - a) * n) / 8;
        const f = fkOf(l(prev[0], s), l(prev[1], e), l(prev[2], w), l(jawDeg(prev[3]), jawDeg(step.pose[3])));
        [f.elbow, f.wrist, f.anchor, ...f.tips].forEach((p, k) => { if (!inCell(p)) bad = bad || `step ${i} sample ${n} point ${k} at ${p.map((v) => v.toFixed(1))} left the cell`; });
      }
      prev = step.pose;
    });
    ok(!bad, `${name}: every step keeps shoulder, elbow and wrist inside their limits, no jump over ${MAX_JUMP} deg, and the whole arm (elbow, wrist, anchor, jaw tips) inside the work envelope${bad ? " — " + bad : ""}`);
    ok(JSON.stringify(posed[posed.length - 1].pose) === JSON.stringify(REST), `${name}: ends at REST with the jaws open`);

    /* pickup: at the moment the capsule is attached the arm is already on the pickup station, gripper closed */
    const held = plan.findIndex((s) => s.cap === "HELD");
    const atPick = plan.slice(0, held).filter((s) => s.pose).pop().pose;
    ok(dist(fk(atPick).anchor, lib.ACT_ST[q.pick]) <= TOL && atPick[3] === 1 && plan[held].node === q.pick, `${name}: pickup pose reaches the real pickup station ${q.pick} (within ${TOL}px) with the gripper closed`);
    /* carry: everything between HELD and PLACED keeps the gripper closed */
    const placed = plan.findIndex((s) => s.cap === "PLACED");
    ok(plan.slice(held, placed).filter((s) => s.pose).every((s) => s.pose[3] === 1), `${name}: the gripper stays closed for the whole carry`);
    /* drop: the arm is on the destination when the capsule is set down, and stays there as the jaws open */
    const atDrop = plan.slice(0, placed).filter((s) => s.pose).pop().pose;
    ok(dist(fk(atDrop).anchor, lib.ACT_ST[q.drop]) <= TOL && atDrop[3] === 1 && plan[placed].node === q.drop && dist(fk(plan[placed].pose).anchor, lib.ACT_ST[q.drop]) <= TOL, `${name}: placement reaches the correct destination ${q.drop} (within ${TOL}px)`);
  });

  /* --- capsule ownership, driven through the shipped capsule view over fake nodes ------------- */
  const mkEl = (attrs = {}) => {
    const el = { attrs, children: [], style: {}, parentNode: null, getAttribute: (k) => attrs[k], getBoundingClientRect: () => ({}) };
    el.appendChild = (c) => { if (c.parentNode) c.parentNode.children = c.parentNode.children.filter((k) => k !== c); c.parentNode = el; el.children.push(c); };
    return el;
  };
  const capAttrs = (html.match(/<rect class="act-capsule"[^>]*data-enter="(\d+)" data-exit-r="(\d+)" data-exit-l="(\d+)"/) || []).slice(1);
  const at = (el) => (el.style.transform.match(/translate\(([-\d.]+)px,([-\d.]+)px\)/) || []).slice(1).map(Number);
  const rigView = () => {
    const rc = { timers: [], now: 0, log: [], snaps: [], pose: REST, problems: [], attached: false, transfers: [] };
    const layer = mkEl(), wrist = mkEl({ "data-anchor": `${ax} ${ay}` });
    const capsule = mkEl({ "data-enter": capAttrs[0], "data-exit-r": capAttrs[1], "data-exit-l": capAttrs[2] });
    layer.appendChild(capsule);
    const view = lib.createCapsuleView({ layer, capsule, wrist, instant: () => false });
    const bad = (m) => rc.problems.push(m);
    const copies = () => layer.children.filter((c) => c === capsule).length + wrist.children.filter((c) => c === capsule).length;
    rc.act = lib.createActuator({
      pose: (s, e, w, g) => { rc.pose = [s, e, w, g]; },
      capsule: (kind, info) => {
        const beforePose = rc.pose;
        const beforeAt = capsule.style.transform ? at(capsule) : null;
        view(kind, info);
        rc.log.push(kind);
        if (copies() !== 1) bad(`${kind}: ${copies()} capsules in the tree`);
        if (kind === "attach") {
          if (rc.attached) bad("attach while a capsule is already held");
          rc.attached = true;
          const f = fk(beforePose).anchor;
          if (wrist.children[0] !== capsule || layer.children.includes(capsule)) bad("attach: capsule is not owned by the wrist");
          if (JSON.stringify(at(capsule)) !== JSON.stringify([ax, ay])) bad("attach: capsule is not at the wrist's gripper anchor");
          if (!beforeAt || dist(beforeAt, f) > TOL) bad(`attach: capsule at ${beforeAt} but end effector at ${f.map((v) => v.toFixed(1))} (jump on pickup)`);
          rc.transfers.push({ pick: dist(beforeAt || [0, 0], lib.ACT_ST[info.node]) });
        } else if (kind === "detach") {
          if (!rc.attached) bad("detach without a held capsule");
          rc.attached = false;
          const f = fk(beforePose).anchor;
          if (layer.children[0] !== capsule || wrist.children.includes(capsule)) bad("detach: capsule is not back on the layer");
          if (dist(at(capsule), lib.ACT_ST[info.node]) > 0.01 || dist(at(capsule), f) > TOL) bad(`detach: placed at ${at(capsule)} but end effector at ${f.map((v) => v.toFixed(1))} (jump on placement)`);
        } else if (kind === "release" && rc.attached) bad("release while held");
      },
      publish: (st) => rc.snaps.push({ ...st }),
      setTimer: (fn, ms) => { const t = { fn, at: rc.now + ms }; rc.timers.push(t); return t; },
      clearTimer: (t) => { rc.timers = rc.timers.filter((k) => k !== t); },
      reduced: () => false,
    });
    rc.step = () => { rc.timers.sort((a, b) => a.at - b.at); const t = rc.timers.shift(); rc.now = t.at; t.fn(); };
    rc.drain = () => { let n = 0; while (rc.timers.length && n++ < 300) rc.step(); };
    rc.holders = () => (wrist.children.includes(capsule) ? "wrist" : "layer");
    return rc;
  };
  const collapse = (arr) => arr.filter((v, i) => i === 0 || v !== arr[i - 1]);

  {
    const rc = rigView();
    const order = ["L", "L", "L", "L", "L", "R"];
    const seen = [];
    order.forEach((lane) => {
      const mark = rc.snaps.length, logMark = rc.log.length, before = rc.act.state.transfers;
      ok(rc.act.ambientArrival(lane) === true, `ambient ${lane} arrival accepted`);
      const name = rc.act.state.sequence;
      seen.push(name);
      rc.drain();
      const run = rc.snaps.slice(mark).map((s) => s.capsule);
      ok(JSON.stringify(collapse(run)) === '["PICKUP","HELD","PLACED","RELEASED"]', `${name}: capsule ownership runs PICKUP -> HELD -> PLACED -> RELEASED, once, without skipping or repeating`);
      ok(JSON.stringify(rc.log.slice(logMark)) === '["appear","attach","detach","release"]', `${name}: exactly one appear, attach, detach and release (never a second capsule)`);
      const st = rc.act.state;
      ok(st.state === "SETTLED" && st.capsule === "RELEASED" && st.transfers === before + 1 && st.sequence === name && st.route === (lane === "L" ? "OUTBOUND" : "INBOUND") && rc.timers.length === 0 && JSON.stringify(rc.pose) === JSON.stringify(REST), `${name}: terminates SETTLED, capsule RELEASED on the correct route, arm at REST, no timer left`);
      ok(rc.holders() === "layer", `${name}: the capsule ends on the layer, not left on the arm`);
    });
    ok(new Set(seen).size === 6 && Object.keys(lib.ACT_SEQ).every((n) => seen.includes(n)), "all six authored sequences were run through the shipped capsule view");
    ok(rc.problems.length === 0, `capsule stays exactly where the end effector is at every pickup and placement, and is never duplicated${rc.problems.length ? " — " + rc.problems.join("; ") : ""}`);
  }
  {
    /* only one capsule may be held: while it is HELD nothing else can start */
    const rc = rigView();
    rc.act.takeover();
    rc.act.runCase("D01");
    let n = 0;
    while (rc.act.state.capsule !== "HELD" && rc.timers.length && n++ < 300) rc.step();
    ok(rc.act.state.capsule === "HELD" && rc.holders() === "wrist", "mid-transfer the capsule is HELD and owned by the wrist");
    const held = rc.log.filter((k) => k === "attach").length;
    ok(rc.act.ambientArrival("L") === false && rc.act.ambientArrival("R") === false && rc.act.runCase("D01") === false && rc.act.takeover() === false, "while HELD, no ambient arrival, replay or takeover can start a second transfer");
    ok(rc.log.filter((k) => k === "attach").length === held && rc.log.filter((k) => k === "spawn").length === 1, "still exactly one capsule and one attach while HELD");
    rc.drain();
    ok(JSON.stringify(collapse(rc.snaps.map((s) => s.capsule).filter((c) => c !== "NONE"))) === '["ROUTE","PICKUP","HELD","PLACED","RELEASED"]', "D01 ownership runs ROUTE -> PICKUP -> HELD -> PLACED -> RELEASED");
    ok(rc.act.state.state === "SETTLED" && rc.act.state.capsule === "RELEASED" && rc.problems.length === 0 && JSON.stringify(rc.pose) === JSON.stringify(REST), "D01 terminates coherently with no capsule problems");
    ["D02", "D03", "D04", "D05"].forEach((id) => {
      const r = rigView();
      r.act.takeover();
      r.act.runCase(id);
      r.drain();
      ok(JSON.stringify(collapse(r.snaps.map((s) => s.capsule).filter((c) => c !== "NONE"))) === '["ROUTE","PICKUP"]' && r.log.every((k) => k === "spawn") && r.holders() === "layer" && r.problems.length === 0, `${id}: the capsule stops at PICKUP and is never held`);
    });
  }
}

/* --- 011C1 PAC presentation: wording only, controller untouched ---------- */
{
  const frozen = {
    D01: ["SIM_VALVE_ACTION", "PERMIT", "ALLOW", "EXECUTED", "TRANSFER_LEFT_TO_RIGHT"],
    D02: ["SIM_VALVE_ACTION", "DENY", "NOT_REPORTED", "NOT_EXECUTED", "NONE"],
    D03: ["SIM_VALVE_ACTION_REPLAY", "NOT_REPORTED", "NOT_REPORTED", "AUTHORITY_CONSUMED", "NONE"],
    D04: ["SIM_VALVE_ACTION", "PERMIT", "DENY", "NOT_EXECUTED", "NONE"],
    D05: ["SIM_VALVE_ACTION", "DEFER", "NOT_REPORTED", "NOT_EXECUTED", "NONE"],
  };
  ok(JSON.stringify(Object.fromEntries(Object.entries(lib.PAC_CASES).map(([id, c]) => [id, [c.request, c.pac, c.safety, c.execution, c.sequence]]))) === JSON.stringify(frozen), "the controller's PAC table is exactly the accepted one (internal values untouched)");
  const pub = (id) => fmt.presentExecution(lib.PAC_CASES[id]);
  ok(pub("D01") === "EXECUTED", "D01 public execution: EXECUTED");
  ok(pub("D02") === "NO EXECUTION", "D02 public execution: NO EXECUTION");
  ok(pub("D03") === "NO_EXECUTION:AUTHORITY_CONSUMED", "D03 public execution: NO_EXECUTION:AUTHORITY_CONSUMED");
  ok(pub("D04") === "NO_EXECUTION:SAFETY_DENY", "D04 public execution: NO_EXECUTION:SAFETY_DENY");
  ok(pub("D05") === "NO EXECUTION", "D05 public execution: NO EXECUTION");
  ok(!Object.keys(lib.PAC_CASES).some((id) => /NOT_EXECUTED/.test(pub(id) + fmt.presentChain(lib.PAC_CASES[id]))), "the internal NOT_EXECUTED never reaches public wording");
  const chains = Object.keys(lib.PAC_CASES).map((id) => fmt.presentChain(lib.PAC_CASES[id]));
  ok(new Set(chains).size === 5, "the five public chains are all different");
  ok(new Set([pub("D02"), pub("D05")]).size === 1 && lib.PAC_CASES.D02.pac !== lib.PAC_CASES.D05.pac && /DENY/.test(chains[1]) && /DEFER/.test(chains[4]) && /evidence UNKNOWN/.test(chains[4]), "D02 and D05 both read NO EXECUTION but stay distinct: DENY versus evidence UNKNOWN then DEFER");
  ok(pub("D03") !== pub("D04") && pub("D03") !== pub("D02") && pub("D04") !== pub("D02"), "consumed authority, safety veto and denial stay three distinct outcomes");
  ok(fmt.presentExecution({ execution: "NONE", safety: "NONE" }) === "NONE" && fmt.presentExecution({ execution: "INACTIVE", safety: "INACTIVE" }) === "INACTIVE" && fmt.presentExecution({ execution: "SOMETHING_NEW", safety: "ALLOW" }) === "SOMETHING_NEW", "ambient and unknown values pass through unchanged");
  const fmtCode = fmtSrc.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/\b(let|var|document|dataset|window|setTimeout|localStorage|sessionStorage)\b/.test(fmtCode) && !/[^=!<>]=[^=>]/.test(fmtCode.replace(/\bconst \w+ = /g, "")), "the formatter is stateless: values in, string out, no assignment, no DOM, no storage");
  ok(!/presentExecution|presentChain/.test(src), "the controller never calls the formatter (adjudication logic is separate from wording)");
  ok(/pacOut\.execution\.textContent = presentExecution\(st\);/.test(js) && !/pacOut\.execution\.textContent = st\.execution/.test(js), "the public replay's Execution cell uses the formatter");
  ok(/pacOut\.pac\.textContent = st\.pac;/.test(js) && /pacOut\.safety\.textContent = st\.safety;/.test(js), "the replay's PAC and Safety cells still show the controller's own values");

  /* end to end through the real controller: what a visitor reads after each replay */
  const read = (id) => { const r = rig(); r.act.takeover(); r.act.runCase(id); r.drain(); const st = r.snaps[r.snaps.length - 1]; return [st.pac, st.safety, fmt.presentExecution(st)]; };
  ok(JSON.stringify(read("D01")) === '["PERMIT","ALLOW","EXECUTED"]', "replay D01 reads PERMIT / ALLOW / EXECUTED");
  ok(JSON.stringify(read("D02")) === '["DENY","NOT_REPORTED","NO EXECUTION"]', "replay D02 reads DENY / NO EXECUTION");
  ok(JSON.stringify(read("D03")) === '["NOT_REPORTED","NOT_REPORTED","NO_EXECUTION:AUTHORITY_CONSUMED"]', "replay D03 reads NO_EXECUTION:AUTHORITY_CONSUMED");
  ok(JSON.stringify(read("D04")) === '["PERMIT","DENY","NO_EXECUTION:SAFETY_DENY"]', "replay D04 reads PERMIT / DENY / NO_EXECUTION:SAFETY_DENY");
  ok(JSON.stringify(read("D05")) === '["DEFER","NOT_REPORTED","NO EXECUTION"]', "replay D05 reads DEFER / NO EXECUTION");
  ok(/OFFLINE — VERIFIED TRACE REPLAY/.test(html) && /class="pac-offline-k">OFFLINE — VERIFIED TRACE REPLAY</.test(html) && /raw controller values/.test(js), "the offline-replay label stays conspicuous, and the live TRACE line says its values are raw controller values");
}

/* --- 011C TRACE: what is printed -------------------------------------- */
const APPROVED = ["ACTUATOR_MODE", "ACTUATOR_STATE", "CAPSULE_STATE", "CAPSULE_ROUTE", "SEQUENCE", "ACTION_REQUEST", "PAC", "SAFETY", "EXECUTION", "STAGE"];
ok(JSON.stringify(tr.TRACE_FIELDS.map(([l]) => l)) === JSON.stringify(APPROVED), "TRACE prints exactly the approved fields, in order");
ok(tr.TRACE_ATTRS.join() === "data-actuator-mode,data-actuator-state,data-capsule-state,data-capsule-route,data-sequence,data-action-request,data-pac,data-safety,data-execution,data-stage", "TRACE observes exactly those data-* attributes");
{
  /* Every traced key is genuinely published: actuator keys by hooks(), STAGE by the taxonomy control. */
  const hooksSrc = js.slice(js.indexOf("const hooks = (st) => {"), js.indexOf("const actuator = createActuator"));
  const map = {};
  for (const m of hooksSrc.matchAll(/d\.(\w+) = st\.(\w+);/g)) map[m[1]] = m[2];
  tr.TRACE_FIELDS.filter(([label]) => label !== "STAGE").forEach(([label, key]) => ok(map[key], `${label} is published by the controller hooks (d.${key})`));
  ok(/substrate\.dataset\.stage = stage;/.test(js) && /delete substrate\.dataset\.stage;/.test(js), "STAGE is published when a chain stage opens and cleared when it closes");
  const stageKeys = [...html.matchAll(/<li data-trace="(\w+)"(?: data-node="\w+")?><button type="button" class="chain-btn"/g)].map((m) => m[1]);
  ok(stageKeys.join() === "signal,transformation,routing,control,interface,feedback,consequence", "the seven STAGE values are the real chain stages, in order");
  const dataset = (st) => Object.fromEntries(Object.entries(map).map(([k, f]) => [k, st[f]]));
  const row = (rows, label) => (rows.find(([l]) => l === label) || [])[1];

  /* Ambient, mid-transfer: the brief's own example. */
  const ra = rig();
  ra.act.ambientArrival("L");
  ra.drain();
  const mid = ra.snaps.find((s) => s.state === "TRANSFERRING" && s.capsule === "HELD");
  const rows = tr.traceRows(dataset(mid));
  ok(row(rows, "ACTUATOR_MODE") === "AMBIENT_AUTONOMOUS" && row(rows, "ACTUATOR_STATE") === "TRANSFERRING" && row(rows, "CAPSULE_STATE") === "HELD" && row(rows, "SEQUENCE") === "TRANSFER_LEFT_TO_RIGHT", "ambient trace: AMBIENT_AUTONOMOUS / TRANSFERRING / HELD / TRANSFER_LEFT_TO_RIGHT");
  ok(row(rows, "ACTION_REQUEST") === "AMBIENT_ARRIVAL" && row(rows, "PAC") === "INACTIVE" && row(rows, "SAFETY") === "INACTIVE" && row(rows, "EXECUTION") === "INACTIVE" && row(rows, "STAGE") === "NONE", "ambient trace: PAC / SAFETY / EXECUTION read INACTIVE, STAGE reads NONE (nothing selected)");
  ok(row(tr.traceRows({ ...dataset(mid), stage: "transformation" }), "STAGE") === "TRANSFORMATION", "STAGE prints the selected chain stage");
  ok(tr.traceRows({}).every(([, v]) => v === "NONE"), "an unpublished value reads NONE, never a guess");

  /* PAC mode: the live readout after each replayed case. */
  const finalRows = (id, opts) => { const r = rig(opts); r.act.takeover(); r.act.runCase(id); r.drain(); return tr.traceRows(dataset(r.snaps[r.snaps.length - 1])); };
  const d01 = finalRows("D01");
  ok(row(d01, "ACTUATOR_MODE") === "PAC_AUTHORITY" && row(d01, "PAC") === "PERMIT" && row(d01, "SAFETY") === "ALLOW" && row(d01, "EXECUTION") === "EXECUTED" && row(d01, "CAPSULE_STATE") === "RELEASED", "D01 trace: PERMIT / ALLOW / EXECUTED, capsule RELEASED");
  const d02 = finalRows("D02");
  ok(row(d02, "PAC") === "DENY" && row(d02, "EXECUTION") === "NOT_EXECUTED" && row(d02, "SEQUENCE") === "NONE" && row(d02, "CAPSULE_STATE") === "PICKUP", "D02 trace: DENY, NOT_EXECUTED, no sequence, capsule waits");
  const d03 = finalRows("D03");
  ok(row(d03, "EXECUTION") === "AUTHORITY_CONSUMED" && row(d03, "ACTION_REQUEST") === "SIM_VALVE_ACTION_REPLAY", "D03 trace: EXECUTION stays AUTHORITY_CONSUMED");
  const d04 = finalRows("D04");
  ok(row(d04, "PAC") === "PERMIT" && row(d04, "SAFETY") === "DENY" && row(d04, "EXECUTION") === "NOT_EXECUTED" && row(d04, "SEQUENCE") === "NONE", "D04 trace: PAC PERMIT, SAFETY DENY, EXECUTION NOT_EXECUTED");
  const d05 = finalRows("D05");
  ok(row(d05, "PAC") === "DEFER" && row(d05, "EXECUTION") === "NOT_EXECUTED", "D05 trace: PAC stays DEFER, no execution");
  const outcomes = [d01, d02, d03, d04, d05].map((r) => ["PAC", "SAFETY", "EXECUTION"].map((k) => row(r, k)).join("/"));
  ok(new Set(outcomes).size === 5, "D01-D05 print five distinct outcomes; none collapsed into another");
  const rr = rig({ reduced: true });
  rr.act.takeover(); rr.act.runCase("D01");
  const rrRows = tr.traceRows(dataset(rr.snaps[rr.snaps.length - 1]));
  ok(row(rrRows, "PAC") === "PERMIT" && row(rrRows, "EXECUTION") === "EXECUTED" && row(rrRows, "ACTUATOR_STATE") === "SETTLED", "reduced motion: the trace still reports the true D01 outcome");
}
{
  const n = (id) => tr.traceCaseNote(lib.PAC_CASES[id]);
  ok(n("D01") === "PAC PERMIT → SAFETY ALLOW → EXECUTED", "D01 case note: the frozen public chain");
  ok(n("D02") === "PAC DENY → NO EXECUTION", "D02 case note: PAC DENY, no execution");
  ok(n("D03") === "NO_EXECUTION:AUTHORITY_CONSUMED", "D03 case note: NO_EXECUTION:AUTHORITY_CONSUMED");
  ok(n("D04") === "PAC PERMIT → SAFETY DENY → NO_EXECUTION:SAFETY_DENY", "D04 case note: PERMIT, safety DENY, NO_EXECUTION:SAFETY_DENY");
  ok(n("D05") === "evidence UNKNOWN → DEFER → NO EXECUTION", "D05 case note: evidence UNKNOWN, DEFER, no execution");
  ok(!Object.keys(lib.PAC_CASES).some((id) => /NOT_EXECUTED/.test(n(id))), "no case note promotes the internal NOT_EXECUTED into the public outcome");
}

/* --- 011C TRACE: how it is wired (static) ----------------------------- */
{
  const wire = slice("/* 011C TRACE control.", "/* Inspection: mark the section being read", "TRACE control");
  ok(!/requestAnimationFrame|setInterval|setTimeout|requestIdleCallback/.test(wire + traceSrc), "TRACE wiring has no RAF, interval or timer");
  ok(/new MutationObserver\(paint\)/.test(wire) && /attributeFilter: TRACE_ATTRS/.test(wire) && /observer\.disconnect\(\)/.test(wire), "TRACE reads state by an attribute-filtered MutationObserver that disconnects when OFF");
  ok(/root\.dataset\.tracemode = "off";/.test(wire) && /toggle\.setAttribute\("aria-pressed", "false"\)/.test(wire), "TRACE is OFF (aria-pressed=false) by default");
  ok(/if \(remembered\) setTrace\(true, false\)/.test(wire) && /getItem\(TRACE_KEY\) === "1"/.test(wire), "TRACE turns on at load only if the tab remembered it");
  ok(/try \{ remembered = window\.sessionStorage[\s\S]*catch \(_\) \{ remembered = false; \}/.test(wire) && /try \{\s*if \(on\) window\.sessionStorage\.setItem/.test(wire), "sessionStorage reads and writes are guarded and fail to OFF");
  ok(/window\.sessionStorage/.test(wire) && !/localStorage/.test(js), "TRACE persists in sessionStorage only, never localStorage");
  ok(/if \(cells\[i\]\.textContent !== value\)/.test(wire), "a value is written only when it changed");
  ok(!/aria-live|role", "status"|role", "log"/.test(wire), "the readout is not a live region");
  ok(/aria-pressed/.test(wire) && /"button"/.test(wire), "the toggle is a real button with aria-pressed");
  ok(/PAC_CASES\[row\.dataset\.pacCase\]/.test(wire), "case notes read the controller's own PAC table");
  ok(/OFFLINE — VERIFIED TRACE REPLAY/.test(wire) && /not live PAC · no robot connected/.test(wire), "the readout carries the offline-replay label and says it is not live");
  const trCss = css.slice(css.indexOf("/* ---------- 011C TRACE mode"));
  ok(trCss.length > 100 && !/animation|@keyframes|transform/.test(trCss), "TRACE CSS has no animation or transform");
  ok(/\.trace-strip\[hidden\]\{display:none\}/.test(trCss) && /\.tr-note\{display:none/.test(trCss) && /html\[data-tracemode="on"\] \.tr-note\{display:block\}/.test(trCss), "TRACE OFF hides the strip and every case note");
  ok(/\.trace-strip\{position:sticky;bottom:0/.test(trCss), "the readout is sticky at the end of the page (takes space; covers no content)");
  const fake = /volt|torque|temperat|latenc|confidence|packet.?id|coordinate|\brpm\b|\bamps?\b|\bhz\b|\bms\b|battery|payload/i;
  ok(!fake.test(traceSrc) && !fake.test(wire) && !fake.test(trCss), "no fake telemetry vocabulary in the TRACE code or CSS");
  ok(!/<[^>]*trace-toggle|trace-strip/.test(html), "TRACE UI is built by site.js only; the static page carries none of it");
}

/* --- 011C3 reading capsules (static guards) ------------------------------ */
{
  const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, "");
  const a = css.indexOf("/* 011C3 A");
    const z = css.indexOf(".sect-head{display:flex");
  const capsuleAll = a >= 0 ? css.slice(a, z) : "";
  const cap = strip(capsuleAll);
  const field = (cap.match(/\)::before,\s*#thesis \.chain-explain::after\{([\s\S]*?mask-composite:intersect,intersect)\}/) || [])[1] || "";
  ok(capsuleAll.length > 800 && !!field, "011C3 capsule rule exists");
  ok(!/backdrop-filter|filter:|blur\(/.test(cap), "no blur or filter of any kind");
  ok(!/011C2/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")) && !/:is\(#thesis,#evidence,#pac,#peer\)::after/.test(css), "superseded 011C2 / 011C2R layers are gone");
  ok(/position:absolute;z-index:-1;pointer-events:none;/.test(field) && /inset:calc\(-1 \* var\(--rf-y\)\) calc\(-1 \* var\(--rf-x\)\)/.test(field), "capsule sits behind the text, inert, and bleeds beyond the block");
  ok(/background:rgba\(var\(--rf\),\.84\)/.test(field) && /--rf:25,36,32/.test(cap) && /--field:#192420/.test(css), "capsule centre is .84 of the existing --field forest, no new colour");
  ok(!/border|outline|radius|box-shadow/.test(field), "capsule has no border, outline, radius or box-shadow");
  ok((field.match(/rgba\(0,0,0,\.75\)/g) || []).length >= 4 && (field.match(/rgba\(0,0,0,\.35\)/g) || []).length >= 4 && (field.match(/transparent 0,/g) || []).length >= 2 && /transparent 100%\)/.test(field) && /radial-gradient\(ellipse/.test(field), "profile eases .84 -> ~.63 -> ~.29 -> 0 on both axes, corners trimmed by an ellipse");
  ok(/--rf-x:clamp\(14px,4\.4vw,52px\)/.test(cap) && /--rf-y:clamp\(26px,4\.6vh,46px\)/.test(cap), "bleed is <= 52px sideways and <= 46px vertical, scaling down on narrow screens");
  ok(!/z-index:\s*(0|[1-9])/.test(cap) && !/isolation|will-change|transform/.test(cap.replace(/#thesis \.chain-explain[^}]*\}/g, "")), "treated blocks create no stacking context, so no capsule paints over any text");
  ["sect-sub", "chain-bridge", "chain-closing", "seq", "sect-note", "pac-offline", "pac-cases", "pac-rule", "ledger--links", "selector-list", "sel-filter", "sel-note"].forEach((c) => ok(new RegExp(`\\.${c}[,)]`).test(cap), `.${c} is treated`));
  ok(/:is\(#thesis,#companies,#evidence,#pac,#peer\)\{--rf/.test(cap), "the companies section is treated with the same capsules");
  ok(!/\.hero|\.act\b|\.sect-lede|\.stmt|\.sel-name|\.sel-state|\.selector-list a|\.foot|\.topbar|\.substrate/.test(cap.replace(/#thesis \.chain-explain[^}]*\}/g, "").replace(/:is\([^)]*\) :is\([^)]*\)/g, "")), "hero, lede, statement, CTAs, company rows, footer and schematic are not restyled");
  ok(/:is\(#thesis,#companies,#evidence,#pac,#peer\)::before\{content:none\}/.test(cap), "the diffuse section luminance pools are retired for the treated sections");
  const mo = capsuleAll.match(/@media \(prefers-reduced-motion:no-preference\)\{[^}]*\}\}/);
  ok(!!mo && /opacity/.test(mo[0]) && !/animation|@keyframes/.test(cap), "only motion: an opacity fade of the explainer capsule, and only where motion is allowed");

  /* palette: no stale blue/cyan anywhere in the stylesheet */
  const blues = [];
  for (const m of css.matchAll(/#([0-9a-fA-F]{6})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    let r, g, b;
    if (m[1]) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); } else { r = +m[2]; g = +m[3]; b = +m[4]; }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 30 || mx < 60) continue;
    let h;
    if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6; else if (mx === g) h = (b - r) / (mx - mn) + 2; else h = (r - g) / (mx - mn) + 4;
    h *= 60;
    if (h >= 165 && h <= 265) blues.push(m[0]);
  }
  ok(blues.length === 0, `no blue/cyan literal remains in site.css${blues.length ? ": " + blues.join(", ") : ""}`);
  ok(/::selection\{background:rgba\(201,183,217,\.3\)/.test(css), "text selection uses the accepted lavender (--cold), not the old light blue");
  const comp = css.split("\n").filter((l) => /selector-list|\.sel-|#companies|sect--select/.test(l)).join("\n");
  ok(!/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(comp.replace(/rgba\(var\(--rf\)[^)]*\)/g, "").replace(/rgba\(0,0,0,[^)]*\)/g, "")), "companies rules use tokens only, no hardcoded colour");
  ok(/\.selector-list a:hover::before,\.selector-list li\.is-context a::before\{background:var\(--cold\)\}/.test(css) && /\.selector-list a:hover \.sel-go\{transform:translateX\(4px\);color:var\(--cold\)\}/.test(css), "company hover and context emphasis is the accepted lavender");
}

/* --- static structure ------------------------------------------------- */
ok(!/requestAnimationFrame|setInterval/.test(js), "site.js has no RAF / setInterval");
ok((js.match(/setTimeout\(/g) || []).length <= 3, "site.js timeouts are the known few (flash, copy status, actuator step)");
["D01", "D02", "D03", "D04", "D05"].forEach((id) => ok(html.includes(`data-pac-run="${id}"`) && js.includes(`${id}: {`), `${id} present in markup and table`));
ok((html.match(/data-actuator-trigger="L"/g) || []).length === 2 && (html.match(/data-actuator-trigger="R"/g) || []).length === 2, "one left and one right ambient trigger per substrate variant");
ok(html.includes("OFFLINE — VERIFIED TRACE REPLAY"), "offline replay label present in the PAC section");
ok(/\.act-shoulder\{transform-origin:830px 636px/.test(css) && /\.act-elbow\{transform-origin:830px 532px/.test(css) && /\.act-wrist\{transform-origin:930px 532px/.test(css), "joint transform origins match the arm (base 830,636; links 104 + 100)");
const rmStart = css.indexOf("@media (prefers-reduced-motion:no-preference){", css.indexOf(".act-shoulder{transform-origin"));
const rmBlock = css.slice(rmStart, css.indexOf("@media (prefers-reduced-motion:reduce)", rmStart));
const armTransition = /\.act-shoulder,\.act-elbow,\.act-wrist,\.act-jaw--a,\.act-jaw--b\{transition:transform/;
ok(armTransition.test(rmBlock) && css.split(armTransition).length === 2, "arm transition is declared once, inside prefers-reduced-motion:no-preference");
ok(!/<canvas|WebGL|getContext/i.test(html + js), "no canvas / WebGL");
["actuatorMode", "actuatorState", "capsuleState", "capsuleRoute", "actionRequest", "d.pac ", "d.safety", "d.execution", "d.sequence"].forEach((h) => ok(js.includes(h), `TRACE hook published: ${h.trim()}`));

if (failures.length) {
  failures.forEach((f) => console.log(`FAIL  ${f}`));
  console.log(`actuator: FAIL (${failures.length} failed, ${passed} passed)`);
  process.exit(1);
}
console.log(`actuator: PASS (${passed} assertions)`);
