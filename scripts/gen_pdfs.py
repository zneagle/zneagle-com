#!/usr/bin/env python3
"""Regenerates the three downloadable PDFs in public/r/downloads/ (résumé, thesis, open letter).

  python3 scripts/gen_pdfs.py            # write the PDFs
  python3 scripts/gen_pdfs.py --check    # write nothing; exit 1 if a shipped PDF differs from a fresh build

Requires fpdf2 (pip install fpdf2==2.8.8, the version the shipped files were verified against).

Provenance: these PDFs were first produced by a one-off script that was not kept. It was reconstructed from its
recorded edit history and verified to reproduce the shipped 2026-09-18 files byte for byte before this contact
change. The page text below is a hand-copied second source: the pages in public/r/ remain the editable source, and
a change to a page's wording is not carried here automatically. Only the contact address is read from
site/site.json.

Determinism: PDF_DATES pins each file's creation date, the only clock-dependent value fpdf2 writes, so a rebuild
is byte-identical. When a document's content changes, set its date to the time it is regenerated and record the
same date on the downloads page.
"""
import argparse
import datetime
import json
import sys
import warnings
from pathlib import Path

from fpdf import FPDF

warnings.filterwarnings("ignore", message='The parameter "ln" is deprecated')  # cell(ln=1) is kept as-is: it is what the shipped bytes were built with

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "r" / "downloads"
EMAIL = json.loads((ROOT / "site" / "site.json").read_text(encoding="utf-8"))["contact"]["email"]
UTC = datetime.timezone.utc
PDF_DATES = {
    "Resume": datetime.datetime(2026, 9, 21, 6, 41, 1, tzinfo=UTC),
    "Thesis": datetime.datetime(2026, 9, 18, 14, 15, 14, tzinfo=UTC),
    "Open_Letter": datetime.datetime(2026, 9, 21, 5, 42, 47, tzinfo=UTC),
}

ap = argparse.ArgumentParser(description="Regenerate the site's downloadable PDFs.")
ap.add_argument("--check", action="store_true", help="compare a fresh build with the shipped files; write nothing")
ARGS = ap.parse_args()
RESULTS = []


def save(d, name):
    d.set_creation_date(PDF_DATES[name])
    data = bytes(d.output())
    path = OUT / f"Zachary_Neagle_{name}.pdf"
    if ARGS.check:
        ok = path.is_file() and path.read_bytes() == data
        RESULTS.append(ok)
        print(("OK     " if ok else "DRIFT  ") + str(path.relative_to(ROOT)))
    else:
        path.write_bytes(data)
        print("wrote  " + str(path.relative_to(ROOT)))


INK = (30, 38, 34)
MUTED = (90, 105, 98)
ACCENT = (58, 92, 68)
RULE = (210, 216, 210)

class Doc(FPDF):
    def header(self):
        pass
    def footer(self):
        self.set_y(-14)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 8, f"Zachary Neagle - RoboBoston 2026 - zneagle.com/r - page {self.page_no()}", align="C")

def new_doc():
    d = Doc(format="Letter", unit="mm")
    d.set_auto_page_break(auto=True, margin=18)
    d.set_margins(20, 18, 20)
    d.add_page()
    return d

def title_block(d, kicker, title, lede=None):
    d.set_font("Helvetica", "", 9)
    d.set_text_color(*ACCENT)
    d.cell(0, 6, kicker.upper(), ln=1)
    d.set_font("Helvetica", "B", 22)
    d.set_text_color(*INK)
    d.cell(0, 11, title, ln=1)
    if lede:
        d.set_font("Helvetica", "I", 11)
        d.set_text_color(*MUTED)
        d.multi_cell(0, 6, lede, new_x="LMARGIN", new_y="NEXT")
    d.set_draw_color(*RULE)
    d.set_line_width(0.3)
    y = d.get_y() + 2
    d.line(20, y, 191, y)
    d.ln(6)

def h2(d, text):
    d.ln(2)
    d.set_font("Helvetica", "B", 13)
    d.set_text_color(*ACCENT)
    d.cell(0, 8, text, ln=1)

def h3(d, text):
    d.ln(1)
    d.set_font("Helvetica", "B", 10.5)
    d.set_text_color(*INK)
    d.cell(0, 6, text, ln=1)

def body(d, text):
    d.set_font("Helvetica", "", 10.3)
    d.set_text_color(*INK)
    d.multi_cell(0, 5.4, text, new_x="LMARGIN", new_y="NEXT")
    d.ln(1)

def bullet(d, text, indent=4):
    d.set_font("Helvetica", "", 10)
    d.set_text_color(*INK)
    left = d.l_margin
    width = d.w - d.l_margin - d.r_margin - indent
    d.set_x(left + indent)
    d.multi_cell(width, 5.2, f"-  {text}", new_x="LMARGIN", new_y="NEXT")
    d.set_x(left)

def ledger_item(d, k, v):
    d.set_font("Helvetica", "B", 10)
    d.set_text_color(*INK)
    d.multi_cell(0, 5.2, k, new_x="LMARGIN", new_y="NEXT")
    d.set_font("Helvetica", "", 9.7)
    d.set_text_color(*MUTED)
    d.multi_cell(0, 5, v, new_x="LMARGIN", new_y="NEXT")
    d.ln(1)

def job(d, role, org, meta, bullets):
    d.set_font("Helvetica", "B", 10.5)
    d.set_text_color(*INK)
    d.cell(0, 5.6, role, ln=1)
    d.set_font("Helvetica", "", 9.7)
    d.set_text_color(*ACCENT)
    d.cell(0, 5, org, ln=1)
    d.set_font("Helvetica", "I", 9)
    d.set_text_color(*MUTED)
    d.cell(0, 5, meta, ln=1)
    d.ln(0.5)
    for b in bullets:
        bullet(d, b)
    d.ln(2)

# ===================== RESUME =====================
d = new_doc()
d.set_font("Helvetica", "B", 26)
d.set_text_color(*INK)
d.cell(0, 12, "Zachary Neagle", ln=1)
d.set_font("Helvetica", "", 11)
d.set_text_color(*MUTED)
d.cell(0, 6, "RoboBoston 2026 - Electromechanical Technician · Robotics Transition", ln=1)
d.set_font("Helvetica", "", 9.5)
d.cell(0, 5.5, f"zneagle.com/r/resume  -  {EMAIL}", ln=1)
d.set_draw_color(*RULE)
d.line(20, d.get_y() + 2, 191, d.get_y() + 2)
d.ln(6)

body(d, "Hands-on multidisciplinary technician moving deliberately into robotics and electromechanical systems. Background spans audio engineering and routed-system troubleshooting, mechanical and automotive diagnostics, metal fabrication and welding, sensor-driven interactive systems, electrical study, construction, equipment operation, and field problem solving. Strongest recurring skill is tracing consequential signal, control, and failure paths across interconnected systems. Seeking robotics, integration, test, reliability, prototype-build, field-support, and electromechanical roles where existing physical-systems competence can contribute immediately while deeper robotics expertise is developed professionally.")

h2(d, "Technical foundation")
ledger_item(d, "Signal paths / systems troubleshooting", "Years of self-directed audio engineering developed mental modeling of signal paths, gain stages, processing chains, control points, dependencies, downstream effects, and methodical fault isolation.")
ledger_item(d, "Sensors / controls / interactive systems", "Troubleshot systems involving RFID and other sensors, PLC-monitored elements, DMX lighting, Arduino hardware, programmable LEDs, audio, mechanical components, and computer controls. Used PLC monitoring interfaces to observe system states and test sensors; programming and ladder-logic changes were handled by software personnel.")
ledger_item(d, "Mechanical systems / diagnostics", "Long-term self-directed hands-on diagnosis and repair of gasoline- and diesel-powered vehicles, dirt bikes, ATVs, and small engines; familiarity with fuel, ignition, starting/charging, cooling, lubrication, wiring, sensors, and controls.")
ledger_item(d, "Fabrication / build execution", "GMAW and SMAW welding, oxy-fuel cutting, brake, shear, punch, drill press, structural fabrication, fitting, rigging, machinery, field installation, material handling, and physical build sequencing.")
ledger_item(d, "Electrical foundation", "Completed Martin Electrical School's Journeyman One program in May 2026. Studied electrical theory, code, safety, and trade fundamentals; one of two students in the class to score 100 on the midterm examination.")

h2(d, "Selected relevant experience")
job(d, "Experienced Crew Member", "Morton Buildings", "Norton, MA  -  Oct 2025-Present", [
    "Post-frame construction from blueprint-based layout and foundation preparation through framing, roofing, siding, trim, and interior work.",
    "Worked at height and operated equipment including telehandlers and elevating work platforms across traveling project sites.",
    "Built for a varied customer base spanning farms, commercial facilities, artists' properties, and occasional residential projects.",
])
d.add_page()  # Keep the Level99 heading with its dates and experience.
job(d, "Venue Technician", "Level99", "Natick, MA  -  Jul 2024-Jun 2025", [
    "Maintained and troubleshot interactive systems integrating RFID and other sensors, PLC-monitored elements, DMX lighting, Arduino hardware, programmable LEDs, audio, mechanical components, and computer-based controls.",
    "Used PLC monitoring interfaces primarily to observe system states and test sensors while supporting broad venue fault diagnosis, preventive maintenance, and physical repair.",
    "Worked at the boundary between software-controlled behavior and real physical mechanisms in a high-use environment.",
])
job(d, "Project-Based Construction & Technical Installations", "Tradesmen International / Wide Effect Talent Solutions / Suncat Solutions", "National / MA / TX / TN / FL  -  2022-2025", [
    "Completed traveling assignments spanning manufacturing construction, commercial millwork, high-end remodeling, interactive entertainment installation, and technical/scenic builds.",
    "Built clean-room structures for PCB manufacturing at the Starlink facility in Bastrop, Texas.",
    "Completed Hyper Bowling installations and Escape Game technical/scenic builds; adapted quickly to unfamiliar crews, systems, sites, and production constraints.",
])
job(d, "Welder / Fabricator", "Superior Rail & Iron Works", "East Bridgewater, MA  -  May 2017-Nov 2019", [
    "Fabricated stairs and rails for steel-frame buildings using GMAW/SMAW welding, oxy-fuel cutting, brake, shear, punch, and drill-press operations.",
    "Supported fitting, finishing, rigging, shipping, loading, deliveries, and installation logistics.",
])
job(d, "Carpenter", "Absolute Home Improvement", "Lakeville, MA  -  Apr 2014-May 2022", [
    "Developed a long-term foundation in complete residential remodeling, including framing, windows, siding, roofing, decks, flooring, trim, painting, repair, and customer-facing work in occupied homes.",
    "Built practical judgment around sequencing, access, measurement, material behavior, repairability, and field adaptation.",
])

h2(d, "Education")
ledger_item(d, "Martin Electrical School - Norwood, MA", "Journeyman One - Certificate of First-Year Completion, May 2026.")
ledger_item(d, "Southeastern Regional Vocational Technical High School - Easton, MA", "Multi-Process Welding, Metal Fabrication & Machine Technology, May 2013.")

d.add_page()  # Keep the tooling section together after the added experience.
h2(d, "Selected hands-on tooling")
ledger_item(d, "Electrical / electronics", "Multimeter, oscilloscope, bench power supply, soldering station, wire strippers/crimpers, heat-shrink work.")
ledger_item(d, "Fabrication / shop", "MIG, TIG, and stick welding; oxy-fuel torch; angle grinder; drill press; brake and shear; ironworker/punch machine.")
ledger_item(d, "Mechanical / diagnostics", "Torque wrench, compression tester, OBD-II scan tool, timing light, calipers and micrometer, dial indicator.")
ledger_item(d, "Controls / signal", "DMX lighting console, Arduino, Raspberry Pi, PLC hardware, RFID readers, digital mixing console.")
ledger_item(d, "Software", "VS Code, Git/GitHub, Linux shell, Python, JavaScript/HTML/CSS, Node.js/npm, AI coding tools including Claude Code and Codex.")

h2(d, "Additional qualifications")
body(d, "OSHA 10  -  Rigging and signaling  -  Telehandler, skid loader, self-propelled and boom-supported work-platform experience  -  Valid driver's license  -  Reliable transportation  -  Available for travel")

h2(d, "What I'm targeting")
body(d, "Robotics / mechatronics hardware technician, prototype and integration/test, field robotics and deployment, reliability/root-cause work, and manufacturing/test engineering support where hands-on execution can grow into increasing engineering ownership.")

save(d, "Resume")

# ===================== THESIS =====================
d = new_doc()
title_block(d, "Thesis", "Thesis", "Why do these apparently unrelated technical experiences belong in the same career?")

h2(d, "01. Thesis")
body(d, "I have spent most of my life moving through technical domains that looked unrelated from the outside but kept teaching me the same underlying lesson: complex systems are defined by what flows through them, how those flows are transformed and routed, what controls them, where interfaces change their meaning, and what happens downstream when something changes or fails.")
body(d, "Audio engineering was where that pattern first became explicit to me. A complex audio system is not a collection of independent devices. It is a hierarchy of sources, signal paths, transformations, control signals, interfaces, routing decisions, dependencies, feedback, and consequences. Troubleshooting means understanding the topology well enough to ask the right questions in the right order: Where did the signal originate? What should happen to it next? What transformed it? What controls that transformation? Which path was selected? Where did the observed behavior first diverge from the expected behavior?")
body(d, "That way of thinking became one of the strongest transferable skills I have developed.")
body(d, "Mechanical and automotive work taught me to trace physical causality through engines, drivetrains, electrical faults, and failure modes. Fabrication and welding taught me that a system eventually has to survive material reality: fit, access, sequence, tooling, force, heat, tolerance, repairability, and the difference between what should work on paper and what actually works in the field.")
body(d, "Later technical environments added more layers to the same model. At Level99, I worked around interactive systems involving RFID and other sensors, PLC-monitored elements, DMX, Arduino hardware, programmable LEDs, audio, mechanical components, and computer control. The important lesson was not any one technology. It was the interaction between them. Physical state, sensing, logic, communication, control, and human-visible behavior all had to agree.")
body(d, "Work at the Starlink facility in Bastrop, Texas further sharpened my interest in advanced industrial systems, where integration, sequencing, infrastructure, and reliability operate at a much larger scale. Formal electrical study then gave me another language for the same underlying problem: power, protection, circuit behavior, safety, and controlled physical consequence.")
body(d, "Software and AI extended the pattern again. The medium changed, but the questions did not. What information enters the system? What transforms it? Which layer has authority to act? What context is preserved or lost at an interface? Which routing decision changes the downstream result? How do you distinguish a failure in reasoning from a failure in execution? How do you preserve evidence about what happened well enough to diagnose it afterward?")
body(d, "This is the lens through which I now approach increasingly complex technical systems.")

h2(d, "02. Why robotics")
body(d, "Robotics is compelling to me because it compresses nearly every one of those domains into the same machine. A robot is simultaneously a mechanical structure, an electrical system, a collection of sensors and signal paths, a control architecture, a software system, a communications system, a set of interfaces between abstractions, and a physical actor whose outputs change the real world.")
body(d, "That makes robotics less of a departure from my previous work than a convergence point. The through-line is not that I have already mastered every discipline robotics requires - I have not. The through-line is that I have spent years developing the habit of moving between domains, identifying the structure they share, tracing interactions across boundaries, and becoming useful where multiple technical layers meet.")

h2(d, "03. How I tend to model systems")
h3(d, "Vocabulary")
body(d, "Signal - Transformation - Routing - Control - Interface - Feedback - Consequence")
body(d, "A signal might be audio, voltage, sensor data, a software event, a model output, or a human instruction. A transformation might be amplification, mechanical transmission, computation, interpretation, or policy evaluation. Routing determines where something goes and therefore what can happen next. Control determines which transformations or routes are permitted, selected, or inhibited. Interfaces are where assumptions meet and where meaning is frequently changed, lost, or misinterpreted. Feedback tells the system - or the operator - what actually happened. Consequence is the final reminder that eventually a technical system does something observable, and in robotics that consequence can be physical.")
body(d, "Trajectory: Audio engineering -> Mechanical diagnosis -> Fabrication -> Sensors / controls -> Electrical systems -> Software architecture -> AI orchestration -> Robotics / cyber-physical systems.")

h2(d, "04. What I am bringing into robotics")
body(d, "I am not presenting myself as an experienced robotics engineer, embedded-firmware specialist, controls engineer, or someone with years of professional autonomy development. What I can bring immediately is a different combination: hands-on fabrication and welding experience; mechanical and automotive troubleshooting; experience using tools and equipment in real physical environments; electrical fundamentals and formal electrical study; sensor and interactive-system exposure; deep familiarity with signal-path reasoning from audio engineering; software and AI systems thinking; comfort learning across domain boundaries; and a strong bias toward tracing causes rather than treating symptoms.")
body(d, "That combination is still developing. That is part of why I am at RoboBoston. I am looking for environments where I can contribute at the level I have actually earned while continuing to move deeper into robotics, electromechanical systems, integration, test, reliability, controls, and the architecture of systems that have to work outside of a diagram.")

h2(d, "05. The general thesis")
body(d, "My work history and technical interests make more sense when treated as one trajectory rather than a collection of unrelated occupations. Audio engineering taught me to see signal paths. Mechanical diagnosis taught me to trace physical causality. Fabrication taught me to respect material reality. Interactive systems taught me to reason across sensors, controls, software, and mechanisms. Electrical study added power, protection, and formal physical-system constraints. Software and AI extended the same reasoning into information, orchestration, and decision systems.")
body(d, "Robotics is where all of those layers become consequential at once. That is the work I am trying to move toward.")

save(d, "Thesis")

# ===================== OPEN LETTER =====================
d = new_doc()
title_block(d, "General", "Open Letter")
body(d, "The general letter - the same form as the individual company letters, without claiming research into any particular company.")

paras = [
    "To the robotics, automation, AI, and physical-systems teams I meet at RoboBoston: thank you for being here, for sharing what you're building, and for taking the time to consider this.",
    "I did not arrive at robotics by deciding to abandon the technical work I had already learned. I arrived there because, after years of moving through increasingly complex systems, those different disciplines kept revealing the same underlying structure.",
    "Audio engineering was where that structure first became explicit to me. Working with signal chains taught me to stop seeing equipment as isolated devices and start seeing systems as paths: sources feeding transformations, control signals determining behavior, interfaces handing information from one stage to the next, and routing decisions creating consequences far downstream.",
    "Troubleshooting became an exercise in topology. Where did the signal originate? What should happen to it next? What transformed it? What controlled that transformation? Where did the observed behavior first diverge from the expected behavior?",
    "That way of thinking followed me everywhere else.",
    "Mechanical and automotive work taught me to trace physical causality through engines, drivetrains, electrical faults, sensors, and failure modes. Metal fabrication and welding taught me that technical ideas eventually have to survive material reality: fit, access, sequence, tooling, force, heat, repairability, and the difference between what should work and what actually does.",
    "Later environments made the pattern harder to ignore. At Level99, I worked around interactive systems combining RFID and other sensors, PLC-monitored elements, DMX, Arduino hardware, programmable LEDs, audio, mechanical components, and computer control. The important part was not any one technology. It was the interaction between them.",
    "At the Starlink facility in Bastrop, Texas, I worked on clean-room structures for PCB manufacturing and saw advanced industrial systems operating at a scale where infrastructure, sequencing, integration, and reliability could not be separated. I later completed Martin Electrical School's Journeyman One program, adding formal electrical theory, code, and safety to a technical foundation that had already been developing through mechanical work, fabrication, troubleshooting, and systems thinking.",
    "Software and AI extended the same pattern again. The medium changed, but the questions did not: What enters the system? What transforms it? Which layer controls what happens next? What context survives an interface? What dependency failed? What evidence tells you whether the problem was reasoning, routing, execution, or physical reality?",
    "My work history and technical interests make more sense to me as one trajectory than as a collection of unrelated jobs. Audio engineering taught me to see signal paths. Mechanical diagnosis taught me to trace physical causality. Fabrication taught me to respect material reality. Interactive systems taught me to reason across sensors, controls, software, and mechanisms. Electrical study added power, protection, and formal physical-system constraints. Software and AI extended the same reasoning into information, orchestration, and decision systems. Robotics is where those layers become consequential at once.",
    "I am not presenting myself as an experienced robotics engineer, controls engineer, embedded-firmware specialist, or someone who has already mastered the entire robotics stack. I have not.",
    "What I can bring immediately is hands-on fabrication and welding experience, mechanical troubleshooting, electrical fundamentals, experience around sensor-driven interactive systems, comfort with tools and equipment, signal-path reasoning from audio engineering, software and AI systems thinking, and a strong habit of tracing causes across domain boundaries.",
    "I am interested in roles where that foundation is useful now and where I can continue developing deeper professional competence in robotics hardware, electromechanical integration, test, reliability, controls, prototype build, field support, and systems that have to work outside of a diagram.",
    "If that combination is useful to your team, I would like to talk.",
]
for p in paras:
    body(d, p)
d.set_font("Helvetica", "B", 10.5)
d.cell(0, 6, "Zachary Neagle", ln=1)

save(d, "Open_Letter")

if ARGS.check:
    sys.exit(0 if all(RESULTS) else 1)
