"""Build the nine-page course-report draft and six-slide presentation PDF.

Both PDFs read experiment_results.json, produced by ``python experiments.py``.
ReportLab is only a document renderer; it is not used by the routing AI.
"""

from __future__ import annotations

import json
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).parent
DATA = json.loads((ROOT / "experiment_results.json").read_text(encoding="utf-8"))
CASES = {case["case"]: case for case in DATA["individual_cases"]}
AGG = DATA["aggregate"]
INK = colors.HexColor("#18313C")
TEAL = colors.HexColor("#22636D")
MUTED = colors.HexColor("#52666D")
PALE = colors.HexColor("#EDF3F1")
LINE = colors.HexColor("#D4DEDA")
ACCENT = colors.HexColor("#B86234")
W, H = A4
L, R = 48, W - 48
WIDTH = R - L
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9.3, leading=13.3, textColor=INK, alignment=TA_LEFT)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8.2, leading=11.7)
CODE = ParagraphStyle("code", fontName="Courier", fontSize=7.8, leading=11.8, textColor=INK)


def block(pdf, text, y, style=BODY, gap=8, width=WIDTH, x=L):
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(width, 2000)
    paragraph.drawOn(pdf, x, y - height)
    return y - height - gap


def section(pdf, title, y):
    y -= 5
    pdf.setFillColor(TEAL)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(L, y, title.upper())
    pdf.setStrokeColor(LINE)
    pdf.line(L, y - 5, R, y - 5)
    return y - 19


def bullets(pdf, items, y, style=BODY):
    for item in items:
        y = block(pdf, "<b>•</b> " + item, y, style, gap=5, width=WIDTH - 12, x=L + 6)
    return y - 3


def table(pdf, headers, rows, widths, y, row_height=25, font=8.1):
    assert abs(sum(widths) - WIDTH) < 0.1
    all_rows = [headers] + list(rows)
    for index, row in enumerate(all_rows):
        fill = TEAL if index == 0 else (PALE if index % 2 else colors.white)
        pdf.setFillColor(fill)
        pdf.rect(L, y - row_height + 3, WIDTH, row_height, stroke=0, fill=1)
        x = L
        for cell, width in zip(row, widths):
            pdf.setFillColor(colors.white if index == 0 else INK)
            pdf.setFont("Helvetica-Bold" if index == 0 else "Helvetica", font)
            content = str(cell)
            while pdf.stringWidth(content, "Helvetica", font) > width - 12 and len(content) > 3:
                content = content[:-2] + "…"
            pdf.drawString(x + 6, y - row_height / 2 + 1, content)
            x += width
        y -= row_height
    return y - 10


def page(pdf, number, title, subtitle):
    pdf.setFillColor(INK)
    pdf.rect(0, H - 71, W, 71, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(L, H - 36, title)
    pdf.setFont("Helvetica", 8.7)
    pdf.setFillColor(colors.HexColor("#C5D6D7"))
    pdf.drawString(L, H - 54, subtitle)
    pdf.setStrokeColor(LINE)
    pdf.line(L, 38, R, 38)
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 7.7)
    pdf.drawString(L, 25, "RailRoute Lab  |  course report draft  |  synthetic campus experiment")
    pdf.drawRightString(R, 25, f"{number} / 9")
    return H - 92


def end_page(pdf, y):
    if y < 48:
        raise RuntimeError(f"Report page overflow: bottom={y:.1f}")
    pdf.showPage()


def code_lines(pdf, lines, y):
    pdf.setFillColor(PALE)
    height = 17 + 12 * len(lines)
    pdf.roundRect(L, y - height, WIDTH, height, 5, fill=1, stroke=0)
    pdf.setFillColor(INK)
    pdf.setFont("Courier", 7.7)
    for index, line in enumerate(lines):
        pdf.drawString(L + 12, y - 17 - index * 12, line)
    return y - height - 11


def make_report():
    output = ROOT / "RailRoute_Course_Report_DRAFT.pdf"
    pdf = canvas.Canvas(str(output), pagesize=A4)
    pdf.setTitle("RailRoute Lab - Course Project Report Draft")
    pdf.setAuthor("RailRoute Lab team; AI-assisted draft for verification")

    y = page(pdf, 1, "RailRoute Lab", "Time-aware A* shuttle routing on a fictional campus")
    y = section(pdf, "Report status", y)
    y = block(pdf, "<b>Draft for team verification before submission.</b> This report describes the running repository and measured experiments. Every member should check the code, numbers, wording, and actual contribution record before submitting it.", y)
    y = section(pdf, "Problem and motivation", y)
    y = block(pdf, "Given a start location, destination, departure time, and possible railway-tunnel closures, find the drivable route with the smallest modeled in-vehicle travel time. Congestion changes by time of day, so the fastest path can change even when the start and goal do not. A railway barrier creates a useful routing constraint: the graph has only two crossing roads.", y)
    y = block(pdf, "This is a controlled <b>search experiment</b>, not a deployed campus navigator. Fourteen named locations and seventeen roads form a reproducible synthetic graph. Coordinates, speed, congestion, and delay values are generated assumptions. No measured VIT road or timetable data are used.", y)
    y = section(pdf, "What is implemented", y)
    y = bullets(pdf, [
        "A local Python A* search whose priority is <b>f = g + h</b>, with an admissible straight-line travel-time heuristic.",
        "A Dijkstra comparison mode using the same search engine with <b>h = 0</b>.",
        "Arrival-time-dependent road costs, closure handling, route reconstruction, and a recorded search trace.",
        "A terminal demo and browser view that accept varied inputs and expose the algorithm's decisions.",
    ], y)
    y = section(pdf, "Team", y)
    y = block(pdf, "This is a five-person project. Add verified member names and actual contributions before final submission. The original proposal's planned task split is not treated as a record of who implemented the current code.", y)
    y = section(pdf, "Main result", y)
    y = block(pdf, f"On {AGG['cases']:,} reproducible input cases, A* and Dijkstra agreed on reachability and route cost. Across the {AGG['reachable_cases']:,} reachable cases, A* expanded {AGG['astar_mean_expansions_on_reachable']:.3f} locations on average versus {AGG['dijkstra_mean_expansions_on_reachable']:.3f} for Dijkstra. This is a consistency result for a small synthetic model, not a real-world performance claim.", y)
    end_page(pdf, y)

    y = page(pdf, 2, "AI formulation", "State, action, transition, goal, and cost are explicit")
    y = section(pdf, "Search problem", y)
    y = table(pdf, ("Component", "Definition"), (
        ("State", "Road-graph location together with arrival time"),
        ("Initial state", "Chosen start at the requested departure time"),
        ("Action", "Traverse a connected road that is open"),
        ("Transition", "Reach adjacent node; advance by entry-time road duration"),
        ("Goal test", "Current location equals selected destination"),
        ("Path cost", "Sum of modeled road travel seconds"),
    ), (111, WIDTH - 111), y, row_height=27)
    y = block(pdf, "The route objective is <b>minimum in-vehicle travel time</b>. Waiting for a shuttle, passenger demand, road legality outside the test graph, and schedule constraints are not included. The only blocked roads exposed as inputs are the west and east tunnel edges.", y)
    y = section(pdf, "Graph and transition model", y)
    y = block(pdf, "Let G=(V,E), with V the fourteen locations and E the seventeen bidirectional roads. For edge (u,v), the time cost c(u,v,t) depends on the clock time t at which the shuttle enters that road. If it arrives at u after elapsed time g(u), then its candidate arrival at v is <b>g(v)=g(u)+c(u,v, departure+g(u))</b>. Closed tunnel edges are skipped.", y)
    y = block(pdf, "Each road has a free-flow traversal time. The model multiplies that time by a congestion factor determined by time of day. It integrates progress across period boundaries, so a road started at 09:59 may use both peak and off-peak rates. The resulting edge arrival function is FIFO: a later departure on the same road cannot arrive before an earlier one solely because a time bucket changed.", y)
    y = section(pdf, "Why one best arrival per node suffices", y)
    y = block(pdf, "With FIFO edge travel and no waiting reward, reaching the same location earlier is never worse than reaching it later. The search therefore stores only the best known elapsed arrival g for each location. If future actions could benefit from waiting, reservations, capacity, or non-FIFO travel, the state representation would need to change.", y)
    y = section(pdf, "Success and failure outputs", y)
    y = block(pdf, "On success the system returns the route, total time, total distance, expansion trace, and comparison result. If both tunnels are closed for a cross-rail trip, the queue empties without reaching the goal; the terminal and browser demos report no route and retain the explored locations.", y)
    end_page(pdf, y)

    y = page(pdf, 3, "Model and heuristic", "Assumptions that make the experiment reproducible")
    y = section(pdf, "Synthetic network", y)
    y = block(pdf, "The generator in sample_map.py uses an integer seed to perturb coordinates, road distances, free-flow speeds, and congestion factors while keeping the same connected topology. Seed 17 is the default case. Nodes north and south of the railway connect only through two tunnel edges. This lets one input demonstrate a west route, an east route, or no crossing route.", y)
    y = block(pdf, "The assumed maximum shuttle speed is 15 km/h. Every generated road length is at least its straight-line length, free-flow time respects the maximum speed, and congestion factors are at least 1. Morning peak is 07:00–10:00; evening peak is 16:00–19:00. These are scenario settings, not measured traffic periods.", y)
    y = section(pdf, "Heuristic", y)
    y = block(pdf, "For current location n and destination z, <b>h(n) = straight-line-distance(n,z) / 15 km/h</b>, converted to seconds. For example, a 0.50 km straight-line separation gives a 2.0 minute lower bound. The actual road path cannot be shorter than that line, and no modeled road travels faster than 15 km/h. Congestion only increases road time. Therefore h never exceeds the true remaining modeled travel time: it is <b>admissible</b>.", y)
    y = block(pdf, "The triangle inequality plus the edge speed bound also gives h(u) ≤ c(u,v,t)+h(v) for every open road and entry time. This is <b>consistency</b>. Together with FIFO costs, it justifies treating a popped location as settled in this search implementation.", y)
    y = section(pdf, "Time-dependent road cost", y)
    y = block(pdf, "The function edge_travel_seconds does not apply one multiplier to an entire road merely because of its entry time. It tracks remaining free-flow work, advances to the next daily boundary, and continues at the new rate. At 09:59 a two-minute road under 2× peak congestion takes 60 seconds of peak time for 30 seconds of work, then 90 seconds off peak: 150 seconds total.", y)
    y = section(pdf, "What the model does not estimate", y)
    y = block(pdf, "No live traffic, stop geolocation, boarding time, passenger waiting, railway train schedules, traffic signal cycles, or real operational restrictions are included. The animation shows the route computed from these assumptions; it is not observed vehicle movement.", y)
    end_page(pdf, y)

    y = page(pdf, 4, "A* and Dijkstra", "The decision mechanism and its comparison baseline")
    y = section(pdf, "A* decision rule", y)
    y = block(pdf, "A* stores candidate locations in a min-heap. The priority is <b>f(n)=g(n)+h(n)</b>: g is the best elapsed travel time from the start; h is the safe lower bound from n to the goal. It repeatedly pops the smallest f, skips outdated heap copies, and checks outgoing roads. A better candidate arrival replaces the saved g and parent link.", y)
    y = section(pdf, "Pseudocode", y)
    y = code_lines(pdf, (
        "best_g[start] = 0; push(start, h(start))",
        "while queue is not empty:",
        "    n = pop_min_f(); skip if this entry is stale",
        "    if n == goal: reconstruct parents; return route",
        "    for each road n -> v:",
        "        if road closed: continue",
        "        candidate = best_g[n] + cost(road, depart + best_g[n])",
        "        if candidate < best_g[v]:",
        "            best_g[v] = candidate; parent[v] = n",
        "            push(v, candidate + h(v))",
        "return no route",
    ), y)
    y = block(pdf, "The relevant code is <b>routing.py: _search</b>, especially heappop, the neighbor loop, the comparison against best_g, heappush, and parent reconstruction. The standard-library heap supplies an efficient queue; it does not perform route reasoning for us.", y)
    y = section(pdf, "Dijkstra comparison", y)
    y = block(pdf, "Calling the same search engine with <b>h=0</b> gives Dijkstra's ordering by elapsed time alone. Both methods use the same graph, road-cost function, and closure set. Compare their minimum travel time, reachability, and number of expanded locations. The shared implementation makes this a useful <b>consistency check</b>, not an independent mathematical proof or a separately written oracle.", y)
    y = block(pdf, "The heuristic need not save work on every trip. It helps when straight-line proximity predicts useful road progress; detours and congestion can weaken that signal. Runtime on a fourteen-node graph is too small and machine-sensitive to be the main claim, so the experiment emphasizes cost and expansion count.", y)
    end_page(pdf, y)

    y = page(pdf, 5, "Implementation", "Data structures and inspectable evidence")
    y = section(pdf, "Key design choices", y)
    y = table(pdf, ("Structure", "Purpose"), (
        ("Adjacency lists", "Available roads from each location"),
        ("Min-heap", "Select lowest f candidate"),
        ("best_g map", "Best known elapsed arrival per location"),
        ("parent map", "Reconstruct chosen route"),
        ("expanded set", "Ignore already settled locations"),
        ("expansion log", "Record neighbor decisions and pending queue"),
    ), (123, WIDTH - 123), y, row_height=25)
    y = section(pdf, "Where to look in the repository", y)
    y = bullets(pdf, [
        "<b>routing.py</b>: A*, Dijkstra mode, heuristic, time-dependent road cost, and optional reliability experiment.",
        "<b>sample_map.py</b>: seeded fictional graph and the two crossing edges.",
        "<b>review_demo.py</b>: code-first terminal run with trace, route costs, and no-route output.",
        "<b>app.py</b> and <b>web/</b>: input handling and visual explanation. Three.js only draws the result.",
        "<b>test_routing.py</b> and <b>experiments.py</b>: correctness checks and reproducible comparison data.",
    ], y)
    y = section(pdf, "Recorded decisions", y)
    y = block(pdf, "For each expanded location the trace stores g, h, f; each neighboring road's time and outcome (queued, closed, settled, or no improvement); and the valid waiting locations after that step. The browser exposes these values so a reviewer can choose a step and see why the next location was considered.", y)
    y = section(pdf, "Optional reliability experiment", y)
    y = block(pdf, "A separate teaching experiment enumerates simple paths on this small graph and ranks an estimated P90 ETA under independent, approximately normal synthetic road delays. It is not part of A*'s objective or heuristic, and path enumeration is not scalable. Its delay spread is assumed, not measured.", y)
    end_page(pdf, y)

    y = page(pdf, 6, "Experiment design", "Inputs, measures, and reproducibility")
    y = section(pdf, "Comparison question", y)
    y = block(pdf, "Does the admissible heuristic reduce the number of locations examined while keeping the same optimal modeled travel time as Dijkstra? Does changing departure time or blocking a tunnel change the selected route?", y)
    y = section(pdf, "Protocol", y)
    y = bullets(pdf, [
        "Generate the same fixed-topology map at seeds 0, 1, 7, 17, and 42.",
        "Use departures 07:00, 08:30, 10:00, 12:00, 16:00, and 19:00.",
        "Test all four closure states and every ordered start/goal pair, including same-location and unreachable cases.",
        "Run A* and Dijkstra on identical graph/input data; record reachability, travel cost, and locations expanded.",
        "Use seed 17, A to D, for human-readable route-switch examples.",
    ], y)
    y = block(pdf, f"The Cartesian product is <b>5 × 6 × 4 × 14 × 14 = {AGG['cases']:,}</b> cases. The experiment code raises an error if the two methods disagree on reachability or travel time. The separate unit suite covers 43,120 cases using eleven times, including just-before and just-after peak boundaries.", y)
    y = section(pdf, "Measures and interpretation", y)
    y = table(pdf, ("Measure", "Meaning"), (
        ("Route time", "Sum of arrival-dependent road costs"),
        ("Reachability", "Whether an open-road path reaches the goal"),
        ("Nodes expanded", "Valid queue pops whose roads were considered"),
        ("Chosen tunnel", "Whether the route crosses west or east"),
    ), (124, WIDTH - 124), y, row_height=28)
    y = block(pdf, "The aggregate averages use only reachable cases because the returned RouteResult carries an expansion count only on success. Unreachable cases are counted separately. Search expansion counts are not vehicle stops, and the animation's elapsed playback time is not the modeled trip time.", y)
    end_page(pdf, y)

    y = page(pdf, 7, "Results", "Observed route switches and A* versus Dijkstra")
    y = section(pdf, "Concrete seed-17 cases", y)
    rows = []
    for key, label in (("off_peak_open", "12:00 open"), ("morning_open", "08:30 open"),
                       ("off_peak_west_closed", "12:00 west shut"),
                       ("off_peak_east_closed", "12:00 east shut"),
                       ("off_peak_both_closed", "12:00 both shut")):
        case = CASES[key]
        path = case["astar_path"]
        tunnel = "west" if path and "B" in path else "east" if path else "none"
        eta = f"{case['astar_minutes']:.2f}" if path else "—"
        expansions = f"{case['astar_expanded']} / {case['dijkstra_expanded']}" if path else "—"
        rows.append((label, tunnel, eta, expansions))
    y = table(pdf, ("Scenario", "Crossing", "Minutes", "Expanded A* / D"), rows,
              (143, 90, 81, WIDTH - 314), y, row_height=29)
    y = block(pdf, "The open midday case chooses the west tunnel. Morning congestion changes the best route to the east tunnel. Closing west also forces east; closing both makes this cross-rail trip unreachable. The difference is produced by the cost function and topology, not by animation rules.", y)
    y = section(pdf, "Aggregate A* versus Dijkstra", y)
    y = table(pdf, ("Cases", "Reachable", "Disagreements", "A* mean expanded", "D mean expanded"), (
        (f"{AGG['cases']:,}", f"{AGG['reachable_cases']:,}", "0", f"{AGG['astar_mean_expansions_on_reachable']:.3f}", f"{AGG['dijkstra_mean_expansions_on_reachable']:.3f}"),
    ), (84, 91, 103, 111, WIDTH - 389), y, row_height=29, font=7.7)
    y = block(pdf, f"Among reachable cases, A* expanded fewer locations in {AGG['astar_fewer']:,} cases, the same number in {AGG['equal_expansions']:,}, and more in {AGG['astar_more']:,}. Its mean reduction was {(1 - AGG['astar_mean_expansions_on_reachable'] / AGG['dijkstra_mean_expansions_on_reachable']) * 100:.1f}% relative to Dijkstra on this test set.", y)
    y = section(pdf, "Mean expanded locations (reachable cases)", y)
    for label, value, color in (("A*", AGG["astar_mean_expansions_on_reachable"], TEAL),
                                ("Dijkstra", AGG["dijkstra_mean_expansions_on_reachable"], ACCENT)):
        pdf.setFont("Helvetica-Bold", 8.5)
        pdf.setFillColor(INK)
        pdf.drawString(L, y - 5, label)
        pdf.setFillColor(color)
        pdf.roundRect(L + 72, y - 9, value / 8 * 355, 14, 3, fill=1, stroke=0)
        pdf.setFillColor(INK)
        pdf.drawString(L + 445, y - 5, f"{value:.3f}")
        y -= 26
    end_page(pdf, y)

    y = page(pdf, 8, "Analysis and limits", "What worked, what failed, and what would change")
    y = section(pdf, "What worked", y)
    y = bullets(pdf, [
        "The search runs end to end in terminal and browser on user-selected inputs, including new seeds and closures.",
        "The default map makes the crossing constraint visible: changing time or closing west changes the route.",
        "A* and Dijkstra agree on all measured route costs and reachability states; A* expands fewer locations on many cases.",
        "The trace exposes every expansion, neighbor decision, and waiting queue rather than merely displaying a final route.",
    ], y)
    y = section(pdf, "What failed or remains limited", y)
    y = bullets(pdf, [
        "When both tunnel roads close, a cross-rail route cannot be found. This is a correct no-route result, not a program crash.",
        "The heuristic can be weak when road detours or congestion dominate straight-line distance; many cases show equal expansions.",
        "The map is generated and has no measured geographic or traffic accuracy. No real VIT ETA can be inferred.",
        "The topology remains fixed across seeds, so the experiment does not test arbitrary road-network structures.",
        "Dijkstra shares the search engine. Agreement detects some errors but cannot independently certify both implementations.",
        "The optional P90 estimate depends on synthetic, independent normal-delay assumptions; it is not observed reliability.",
    ], y)
    y = section(pdf, "Next improvements", y)
    y = block(pdf, "Survey legal shuttle roads and stops, gather repeated travel times by period, and validate predicted times against held-out trips. Add passenger waiting and service frequency only after defining a new objective and state. Add an independent shortest-path oracle on tiny graphs to strengthen verification. For larger maps, replace exhaustive reliability path enumeration with a scalable method.", y)
    y = section(pdf, "Interpretation", y)
    y = block(pdf, "The experiment supports a narrow conclusion: in this declared synthetic model, an admissible straight-line heuristic preserves the minimum modeled travel time and often reduces search expansions. It does not establish real-world route quality, bus efficiency, or a universal A* speedup.", y)
    end_page(pdf, y)

    y = page(pdf, 9, "Reproduce and disclose", "Run instructions, references, and viva responsibility")
    y = section(pdf, "Exact run commands", y)
    y = code_lines(pdf, (
        "python app.py                 # open http://127.0.0.1:8000",
        "python review_demo.py          # code-first test case",
        "python review_demo.py --time 08:30 --seed 42 --close west",
        "python review_demo.py --close west --close east",
        "python -m unittest -v        # correctness checks",
        "python experiments.py          # regenerate comparison JSON",
    ), y)
    y = block(pdf, "Python 3.10+ runs the AI core without external packages. The local browser animation uses bundled Three.js. Rebuilding the PDFs requires ReportLab; it does not participate in route decisions. The repository README gives the full setup and optional browser check.", y)
    y = section(pdf, "AI-tool declaration and academic responsibility", y)
    y = block(pdf, "An AI assistant helped draft and refine synthetic data, Python code, tests, interface, experiments, and this report. No external AI model or API makes route decisions at runtime. The submitted search executes in local inspectable Python. The team must confirm that its AI-assisted workflow is allowed by the course, verify the generated material, and state actual individual contributions truthfully. Each member must be able to explain and modify the AI core in the viva.", y)
    y = section(pdf, "References", y)
    y = block(pdf, "[1] P. E. Hart, N. J. Nilsson, and B. Raphael, “A Formal Basis for the Heuristic Determination of Minimum Cost Paths,” <i>IEEE Transactions on Systems Science and Cybernetics</i>, 4(2), 100–107, 1968. DOI: 10.1109/TSSC.1968.300136.", y, SMALL)
    y = block(pdf, "[2] E. W. Dijkstra, “A note on two problems in connexion with graphs,” <i>Numerische Mathematik</i>, 1, 269–271, 1959. DOI: 10.1007/BF01386390.", y, SMALL)
    y = block(pdf, "[3] Course-project guidelines email supplied by the instructor; requirements for self-implemented AI core, search formulation, comparison, report, slides, live demo, and individual viva.", y, SMALL)
    y = section(pdf, "Viva-ready explanation", y)
    y = block(pdf, "“The state is a location and its arrival time. For each open road, we calculate its travel time when the shuttle reaches it. A* expands the waiting location with the lowest elapsed time plus a safe straight-line estimate. The best-arrival and parent maps record improvements. Dijkstra sets that estimate to zero for comparison. Our result is a modeled optimum on synthetic data.”", y)
    end_page(pdf, y)
    pdf.save()
    print(f"Wrote {output}")


def slide_base(pdf, number, title, subtitle):
    sw, sh = landscape(A4)
    pdf.setFillColor(colors.HexColor("#F8FAF8"))
    pdf.rect(0, 0, sw, sh, stroke=0, fill=1)
    pdf.setFillColor(INK)
    pdf.rect(0, sh - 94, sw, 94, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 28)
    pdf.drawString(46, sh - 51, title)
    pdf.setFillColor(colors.HexColor("#B8D2D2"))
    pdf.setFont("Helvetica", 11)
    pdf.drawString(47, sh - 73, subtitle)
    pdf.setStrokeColor(LINE)
    pdf.line(46, 39, sw - 46, 39)
    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(46, 24, "RAILROUTE LAB  •  FICTIONAL CAMPUS ROUTING EXPERIMENT")
    pdf.drawRightString(sw - 46, 24, f"{number} / 6")
    return sw, sh, sh - 121


def slide_text(pdf, x, y, text, width=720, size=17, leading=23, gap=16):
    style = ParagraphStyle("slide", fontName="Helvetica", fontSize=size, leading=leading, textColor=INK)
    return block(pdf, text, y, style, gap=gap, width=width, x=x)


def slide_bullets(pdf, items, y, x=54, width=730, size=17):
    for item in items:
        y = slide_text(pdf, x, y, "<font color='#22636D'><b>•</b></font>  " + item, width, size, size + 7, 15)
    return y


def make_slides():
    output = ROOT / "RailRoute_Six_Slide_Presentation_DRAFT.pdf"
    pdf = canvas.Canvas(str(output), pagesize=landscape(A4))
    pdf.setTitle("RailRoute Lab - Six-slide Course Presentation Draft")
    pdf.setAuthor("RailRoute Lab team; AI-assisted draft for verification")

    sw, sh, y = slide_base(pdf, 1, "RailRoute Lab", "One problem. One inspectable AI core. Reproducible evidence.")
    y = slide_text(pdf, 56, y - 18, "<b>Problem:</b> Find the minimum modeled shuttle travel-time route between two campus locations for a selected departure time and tunnel-closure state.", 720, 20, 29, 26)
    y = slide_bullets(pdf, [
        "A fictional 14-location, 17-road network with a railway barrier and two tunnels.",
        "A* performs the route search locally in Python; the 3D view displays its result.",
        "Outputs: route, travel time, road costs, and every A* expansion decision.",
    ], y)
    y = slide_text(pdf, 56, y - 12, "<b>Model boundary:</b> generated road times and congestion; no measured VIT traffic or live ETA.", 720, 15, 21)
    pdf.showPage()

    sw, sh, y = slide_base(pdf, 2, "Formal search formulation", "What the algorithm is allowed to do")
    y = slide_bullets(pdf, [
        "<b>State:</b> current road location and arrival time.",
        "<b>Action:</b> traverse an adjacent open road.",
        "<b>Transition:</b> reach its neighbor after its entry-time travel cost.",
        "<b>Goal:</b> current location equals destination.",
        "<b>Cost:</b> sum of modeled driving seconds.",
    ], y, size=19)
    y = slide_text(pdf, 56, y - 3, "Only two graph edges cross the railway. Closing both makes cross-rail trips unreachable.", 720, 16, 23)
    pdf.showPage()

    sw, sh, y = slide_base(pdf, 3, "Inside A*", "The exact decision rule used in routing.py")
    y = slide_text(pdf, 56, y - 12, "<font color='#22636D'><b>f(n) = g(n) + h(n)</b></font>", 700, 31, 39, 23)
    y = slide_bullets(pdf, [
        "<b>g:</b> modeled travel time already spent from the start.",
        "<b>h:</b> straight-line distance to goal ÷ 15 km/h; a safe lower bound.",
        "<b>f:</b> priority in the waiting queue; the lowest f is expanded next.",
        "A better arrival updates best_g and a parent link; parents reconstruct the route.",
    ], y, size=17)
    y = slide_text(pdf, 56, y - 5, "The heuristic is admissible because roads are at least straight-line length and never exceed the assumed maximum speed.", 730, 14, 20)
    pdf.showPage()

    sw, sh, y = slide_base(pdf, 4, "A live route decision", "Seed 17: A to D")
    rows = [
        ("12:00, both open", CASES["off_peak_open"]),
        ("08:30, both open", CASES["morning_open"]),
        ("12:00, west closed", CASES["off_peak_west_closed"]),
        ("12:00, both closed", CASES["off_peak_both_closed"]),
    ]
    for label, case in rows:
        path = case["astar_path"]
        tunnel = "WEST" if path and "B" in path else "EAST" if path else "NO ROUTE"
        eta = f"{case['astar_minutes']:.2f} min" if path else "queue exhausted"
        pdf.setFillColor(PALE)
        pdf.roundRect(56, y - 61, sw - 112, 52, 6, fill=1, stroke=0)
        pdf.setFillColor(INK)
        pdf.setFont("Helvetica-Bold", 15)
        pdf.drawString(73, y - 31, label)
        pdf.setFillColor(TEAL)
        pdf.drawString(389, y - 31, tunnel)
        pdf.setFillColor(ACCENT)
        pdf.drawRightString(sw - 78, y - 31, eta)
        y -= 70
    y = slide_text(pdf, 56, y - 3, "Show the expansion list and road decisions; the shuttle animation is only a playback of the chosen route.", 720, 15, 22)
    pdf.showPage()

    sw, sh, y = slide_base(pdf, 5, "Comparison evidence", "A* versus Dijkstra (same search engine, h = 0)")
    y = slide_text(pdf, 56, y - 7, f"<b>{AGG['cases']:,}</b> test cases  •  <b>{AGG['reachable_cases']:,}</b> reachable  •  <b>0</b> cost/reachability disagreements", 740, 19, 26, 22)
    for label, value, color in (("A*", AGG["astar_mean_expansions_on_reachable"], TEAL),
                                ("Dijkstra", AGG["dijkstra_mean_expansions_on_reachable"], ACCENT)):
        pdf.setFillColor(INK)
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(62, y - 5, label)
        pdf.setFillColor(color)
        pdf.roundRect(202, y - 9, value / 8 * 360, 26, 5, fill=1, stroke=0)
        pdf.setFillColor(INK)
        pdf.drawRightString(sw - 76, y - 4, f"{value:.3f} mean expansions")
        y -= 66
    y = slide_bullets(pdf, [
        f"A* expanded fewer locations in {AGG['astar_fewer']:,} reachable cases; equal in {AGG['equal_expansions']:,}.",
        "Cost agreement is a consistency check, not independent proof: the methods share code.",
    ], y - 5, size=15)
    pdf.showPage()

    sw, sh, y = slide_base(pdf, 6, "Demonstrate and defend", "What to run and what to explain in the viva")
    y = slide_bullets(pdf, [
        "Run <b>python review_demo.py</b>; change time, start, destination, seed, and closures.",
        "Point to <b>routing.py / _search</b>: pop lowest f, evaluate roads, update best_g, save parent.",
        "Explain why h is a lower bound and why arrival time affects road cost.",
        "Show no-route output when both tunnel edges are closed.",
        "State the limits: synthetic map, generated traffic, and no passenger waiting time.",
    ], y, size=17)
    y = slide_text(pdf, 56, y - 10, "<b>Disclosure:</b> AI assisted with code and presentation drafting. The local Python algorithm makes every route decision. Each teammate must verify and explain it.", 720, 14, 20)
    pdf.showPage()
    pdf.save()
    print(f"Wrote {output}")


if __name__ == "__main__":
    make_report()
    make_slides()
