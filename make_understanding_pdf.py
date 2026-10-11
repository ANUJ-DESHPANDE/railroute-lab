"""Generate the concise, team-shareable project and viva guide.

Run: python make_understanding_pdf.py
Requires ReportLab only for PDF generation; it is not used by the AI core.
"""

from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from routing import astar, dijkstra, estimated_p90_seconds, reliable_route
from sample_map import DEFAULT_SEED, WEST_TUNNEL, EAST_TUNNEL, generate_map


ROOT = Path(__file__).parent
OUTPUT = ROOT / "RailRoute_Project_Understanding_and_Viva.pdf"
W, H = A4
INK = colors.HexColor("#20343E")
MUTED = colors.HexColor("#60747A")
TEAL = colors.HexColor("#315B64")
LINE = colors.HexColor("#D7E0DC")
PALE = colors.HexColor("#EFF3F0")
LEFT = 43
RIGHT = W - 43
BODY_WIDTH = RIGHT - LEFT

body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.2, leading=13.1, textColor=INK, alignment=TA_LEFT, spaceAfter=0)
small = ParagraphStyle("small", parent=body, fontSize=8.2, leading=11.5)
question = ParagraphStyle("question", parent=body, fontName="Helvetica-Bold", fontSize=9.0, leading=12)


def paragraph(pdf, text, y, style=body, width=BODY_WIDTH, gap=7):
    block = Paragraph(text, style)
    _, height = block.wrap(width, 1000)
    block.drawOn(pdf, LEFT, y - height)
    return y - height - gap


def heading(pdf, text, y):
    pdf.setFillColor(TEAL)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(LEFT, y, text.upper())
    pdf.setStrokeColor(LINE)
    pdf.line(LEFT, y - 5, RIGHT, y - 5)
    return y - 20


def page(pdf, number, title, subtitle):
    pdf.setFillColor(INK)
    pdf.rect(0, H - 68, W, 68, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(LEFT, H - 37, title)
    pdf.setFont("Helvetica", 8.7)
    pdf.setFillColor(colors.HexColor("#C4D2D2"))
    pdf.drawString(LEFT, H - 54, subtitle)
    pdf.setStrokeColor(LINE)
    pdf.line(LEFT, 38, RIGHT, 38)
    pdf.setFont("Helvetica", 8)
    pdf.setFillColor(MUTED)
    pdf.drawString(LEFT, 26, "RailRoute Lab  |  synthetic campus routing experiment  |  seed 17")
    pdf.drawRightString(RIGHT, 26, str(number))
    return H - 92


def row(pdf, label, value, y, label_width=105):
    pdf.setFillColor(PALE)
    pdf.rect(LEFT, y - 4, BODY_WIDTH, 22, fill=1, stroke=0)
    pdf.setFillColor(TEAL)
    pdf.setFont("Helvetica-Bold", 8.5)
    pdf.drawString(LEFT + 9, y + 4, label)
    pdf.setFillColor(INK)
    pdf.setFont("Helvetica", 8.5)
    pdf.drawString(LEFT + label_width, y + 4, value)
    return y - 28


def qa(pdf, q, a, y):
    y = paragraph(pdf, escape(q), y, question, gap=2)
    y = paragraph(pdf, escape(a), y, small, gap=8)
    return y


def make_pdf():
    graph, _ = generate_map(DEFAULT_SEED)
    start, goal = "Science Hall", "North Library"
    off = astar(graph, start, goal, "12:00")
    morning = astar(graph, start, goal, "08:30")
    closed = astar(graph, start, goal, "12:00", {WEST_TUNNEL})
    both = astar(graph, start, goal, "12:00", {WEST_TUNNEL, EAST_TUNNEL})
    baseline = dijkstra(graph, start, goal, "12:00")
    reliable = reliable_route(graph, start, goal, "12:00")
    assert off and morning and closed and baseline and reliable and both is None

    pdf = canvas.Canvas(str(OUTPUT), pagesize=A4)
    pdf.setTitle("RailRoute Lab - Project Understanding and Viva Guide")
    pdf.setAuthor("RailRoute Lab team")

    y = page(pdf, 1, "Understand the project", "Start here: the problem, inputs, and formal AI formulation")
    y = paragraph(pdf, "<b>One-sentence problem:</b> Given a departure time, two campus locations, and any closed railway tunnels, find the connected shuttle route with the least modeled travel time. The map is fictional and reproducible; it is a test network, not VIT road data.", y)
    y = heading(pdf, "What happens when you press Run A* search", y - 2)
    y = paragraph(pdf, "The browser sends the selected inputs and map seed to <b>app.py</b>. <b>sample_map.py</b> generates 14 locations and 17 roads. <b>routing.py</b> performs A* and Dijkstra. The server returns the route, road costs, and expansion trace. The browser displays the evidence and animates the chosen route. The 3D renderer never chooses a route.", y)
    y = heading(pdf, "Search formulation (memorize this)", y - 2)
    for label, value in (
        ("State", "Current road-graph node and its arrival time."),
        ("Initial state", "Chosen start location at the selected departure time."),
        ("Action", "Travel to a directly connected node on an open road."),
        ("Transition", "Move to that node; advance the clock by the edge travel time."),
        ("Goal test", "Current node equals the selected destination."),
        ("Path cost", "Sum of travel seconds over the traversed roads."),
    ):
        y = row(pdf, label, value, y)
    y -= 3
    y = paragraph(pdf, "<b>Railway rule:</b> The railway divides north and south. The only graph edges crossing it are the west and east road tunnels. Closing a tunnel removes that edge from search. If both close, trips across the railway have no path; trips on one side can still work.", y)
    y = paragraph(pdf, "<b>Road cost:</b> Each road has a free-flow time and morning/evening congestion multipliers. While the shuttle is on a road, progress is integrated across a time-period boundary, so a road entered at 09:59 can finish after the 10:00 peak ends. A later start cannot arrive earlier on the same edge merely because a period changed (FIFO property).", y)
    y = paragraph(pdf, "<b>Scope:</b> We optimize in-vehicle road time only. Stops, roads, traffic and delay spread are generated simulation values. There is no real shuttle timetable, passenger waiting time, live traffic, capacity, or surveyed campus geometry.", y)
    pdf.showPage()

    y = page(pdf, 2, "Explain the AI core", "A*, the heuristic, and a worked search on the default map")
    y = heading(pdf, "The decision rule", y)
    y = paragraph(pdf, "A* keeps candidate locations in a priority queue ordered by <b>f(n) = g(n) + h(n)</b>. <b>g</b> is actual modeled travel time from the start to n. <b>h</b> is an optimistic estimate of remaining time. The algorithm pops the smallest f, relaxes open neighboring roads, saves a parent when it finds a cheaper arrival, and stops when it pops the goal. Following parents backwards reconstructs the route.", y)
    y = paragraph(pdf, "Our heuristic is <b>straight-line distance from n to goal / 15 km/h</b>, converted to seconds. Example: 0.50 km implies at least 2 minutes. Every modeled road is at least as long as straight-line distance, free-flow speed never exceeds 15 km/h, and congestion multipliers are at least 1. Therefore h cannot overestimate the remaining road time. The same triangle/edge bound makes it consistent; after a node is popped, its best arrival is final under this FIFO road model.", y)
    y = heading(pdf, "Pseudocode in plain words", y - 1)
    for line in (
        "1. Put start in the min-heap with g=0 and f=h(start).",
        "2. Pop the lowest-f entry; ignore stale entries replaced by a better g.",
        "3. If it is the goal, follow parent pointers and return the route.",
        "4. For each open outgoing road, compute arrival-dependent edge time.",
        "5. If new g is smaller, save parent and push neighbor with f=new g+h.",
        "6. If the heap empties, report no route and retain the exploration trace.",
    ):
        y = paragraph(pdf, escape(line), y, small, gap=2)
    y = heading(pdf, "Real run: seed 17, Science Hall to North Library, 12:00", y + 1)
    y = paragraph(pdf, "The first four A* expansions below are read from the running program (minutes):", y, small, gap=4)
    pdf.setFont("Helvetica-Bold", 8.3)
    pdf.setFillColor(TEAL)
    pdf.drawString(LEFT + 7, y, "Expanded node")
    for x, label in ((350, "g"), (409, "h"), (469, "f")):
        pdf.drawString(x, y, label)
    y -= 14
    for step in off.expansions[:4]:
        pdf.setFillColor(PALE)
        pdf.rect(LEFT, y - 3, BODY_WIDTH, 19, fill=1, stroke=0)
        pdf.setFillColor(INK)
        pdf.setFont("Helvetica", 8.3)
        pdf.drawString(LEFT + 7, y + 4, step.node)
        for x, value in ((350, step.g_seconds), (409, step.h_seconds), (469, step.f_seconds)):
            pdf.drawString(x, y + 4, f"{value / 60:.2f}")
        y -= 22
    y -= 3
    y = paragraph(pdf, f"Final route: <b>{' - '.join(off.path)}</b>. Its three road times add to <b>{off.travel_seconds / 60:.2f} minutes</b>. A* expanded {off.nodes_expanded} nodes; Dijkstra expanded {baseline.nodes_expanded} and returned the same minimum time.", y, small)
    y = paragraph(pdf, "<b>Why Dijkstra?</b> It is the same search with h=0, so it is an independent baseline for route cost. A* may explore fewer nodes because h guides it, but that is not guaranteed on every input. Tiny runtime measurements are noisy; compare exact cost and expansion counts first.", y, small)
    pdf.showPage()

    y = page(pdf, 3, "Defend the demonstration", "Observed scenarios, tests, assumptions, and honest limits")
    y = heading(pdf, "Three inputs the professor can change", y)
    scenarios = (
        ("12:00, open", off),
        ("08:30, open", morning),
        ("12:00, west shut", closed),
    )
    for label, result in scenarios:
        tunnel = "west" if "West Tunnel South" in result.path else "east"
        y = row(pdf, label, f"{tunnel} tunnel; {result.travel_seconds / 60:.2f} min; {result.nodes_expanded} A* expansions", y, 133)
    y = paragraph(pdf, "At 12:00 the shorter west crossing wins. In the modeled morning peak, its congested approach loses to the east crossing. Closing west forces the east route. Closing both makes a north/south trip unreachable; the UI still shows the nodes explored before the frontier emptied.", y - 1)
    y = heading(pdf, "What was actually checked", y)
    y = paragraph(pdf, "The automated suite compares A* and Dijkstra for <b>43,120</b> combinations: 5 map seeds x 11 times x 4 tunnel states x 14 starts x 14 goals. It asserts identical reachability and equal optimum cost. Separate tests check invalid inputs, same start/goal, a disconnected graph, traffic-period boundary behavior, and the default scenario switches. The browser check exercises controls, trace, source view, alternate seed, and the no-route case.", y)
    y = heading(pdf, "The optional reliability experiment", y)
    y = paragraph(pdf, "For this small map, we enumerate simple paths and rank them by <b>estimated P90 = mean route time + 1.28155 x sqrt(sum of edge variance)</b>. This assumes independent, roughly normal road-delay variation. It is a separate experimental objective, not the A* heuristic and not a real measured 90th percentile. For the default trip, fastest west is {fast} min with modeled P90 {fastp:.2f}; the east reliability route is {rel:.2f} min with modeled P90 {relp:.2f}.".format(fast=f"{off.travel_seconds / 60:.2f}", fastp=estimated_p90_seconds(graph, off.path, "12:00") / 60, rel=reliable.expected_seconds / 60, relp=reliable.estimated_p90_seconds / 60), y)
    y = heading(pdf, "What we cannot claim", y)
    y = paragraph(pdf, "We cannot claim real VIT routes, actual shuttle ETAs, measured uncertainty, calibrated peak hours, or real stop positions. The seed changes coordinates and road parameters while preserving the same 14-node, two-tunnel topology; it does not generate arbitrary graph structures. A* is optimal for the stated model, not for unmodeled waiting, capacity, or driving restrictions. Enumerating every simple route for reliability becomes exponential on a large map.", y)
    y = paragraph(pdf, "<b>AI-use declaration for the final report:</b> State that an AI assistant helped draft/refine the synthetic data, code, tests, UI, and study guide. The submitted program runs its own A* and Dijkstra locally; no external AI service decides routes. Every team member should inspect the code and verify the explanation independently.", y)
    pdf.showPage()

    y = page(pdf, 4, "Viva quick answers", "Short answers to likely follow-up questions")
    for q, a in (
        ("Where does the AI make its decision?", "In routing.py, _search pops the smallest f=g+h from a heap and updates a neighbor only when a cheaper arrival is found."),
        ("Why is this A* rather than ordinary shortest path?", "The priority includes h, an informed lower bound to the goal. Dijkstra is the same search with h=0."),
        ("Why is your heuristic safe?", "Straight-line distance cannot exceed a road path's distance; no edge exceeds 15 km/h and congestion never speeds it up."),
        ("Could A* return a wrong optimum?", "Yes if the heuristic overestimates, road costs violate the model assumptions, or we add non-FIFO behavior without changing the search state."),
        ("Why does arrival time matter?", "A road's congestion depends on when the shuttle reaches it, not just the trip's original departure time."),
        ("What if a road crosses 10:00?", "edge_travel_seconds integrates progress before and after 10:00 instead of charging the whole edge at one rate."),
        ("Why can both closed tunnels yield no route?", "The railway separates north and south; those are the only crossing edges. Search exhausts the reachable side."),
        ("What if start equals destination?", "The first popped node is already the goal: path contains one node, cost is zero."),
        ("Why compare with Dijkstra?", "Both should return the same minimum modeled time. Their expansion counts show how much the heuristic helps on each case."),
        ("Why might A* not expand far fewer nodes?", "Straight-line time is a weak lower bound when road detours or congestion dominate, so its priorities resemble Dijkstra's."),
        ("Why use a priority queue?", "It quickly selects the next lowest-f candidate; a plain list would repeatedly scan all waiting nodes."),
        ("What does relaxing a road mean?", "Compute a possible arrival at its neighbor. If it beats the saved arrival, update that g value and parent."),
        ("What is the rough complexity?", "With a consistent heuristic and a binary heap, graph search is roughly O(E log E) time and O(V+E) space for fixed-time edge evaluation. The optional all-path reliability mode is exponential."),
        ("Is the reliability path guaranteed reliable in reality?", "No. Its P90 is conditional on synthetic, independent normal-delay assumptions, not observed traffic."),
        ("What would you improve with real data?", "Survey legal shuttle roads and stops, measure time by period, calibrate delays, then validate predicted ETAs against recorded trips."),
    ):
        y = qa(pdf, q, a, y)
    y = heading(pdf, "Run it", y - 1)
    y = paragraph(pdf, "<b>Browser:</b> python app.py, then open http://127.0.0.1:8000<br/><b>Code-first:</b> python review_demo.py --time 08:30 --seed 17<br/><b>Tests:</b> python -m unittest -v", y, small)
    pdf.save()
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    make_pdf()
