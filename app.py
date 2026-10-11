"""Local browser simulator backed by the Python A* implementation.

Run: python app.py, then open http://localhost:8000
"""

from __future__ import annotations

import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from routing import astar, dijkstra, edge_travel_seconds, estimated_p90_seconds, reliable_route
from vit_demo import EAST_TUNNEL, LOCATIONS, WEST_TUNNEL, vit_demo_graph


ROOT = Path(__file__).parent
GRAPH = vit_demo_graph()
TUNNELS = {"west": WEST_TUNNEL, "east": EAST_TUNNEL}


def graph_payload() -> dict:
    seen = set()
    roads = []
    for start, edges in GRAPH.neighbors.items():
        for edge in edges:
            key = tuple(sorted((start, edge.destination)))
            if key in seen:
                continue
            seen.add(key)
            roads.append({
                "start": start,
                "end": edge.destination,
                "distance_km": edge.distance_km,
                "free_flow_seconds": edge.free_flow_seconds,
                "multipliers": edge.multipliers,
                "uncertainty_seconds": edge.uncertainty_seconds,
            })
    return {
        "locations": [
            {"name": name, "east_km": x, "north_km": y, "kind": kind}
            for name, x, y, kind in LOCATIONS
        ],
        "roads": roads,
        "tunnels": TUNNELS,
        "data_status": "VIT inspired schematic. Landmark names and railway split are grounded in maps; stops, road links, directions, positions, traffic and travel times are model assumptions.",
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/graph":
            self.send_json(200, graph_payload())
            return
        if parsed.path == "/api/route":
            query = parse_qs(parsed.query)
            start = query.get("start", ["Technology Tower"])[0]
            goal = query.get("goal", ["Hostel Q Block"])[0]
            departure = query.get("departure", ["12:00"])[0]
            closed_names = query.get("closed", [])
            unknown = set(closed_names) - set(TUNNELS)
            if unknown:
                self.send_json(400, {"error": "Unknown tunnel closure"})
                return
            closures = {TUNNELS[name] for name in closed_names}
            try:
                a = astar(GRAPH, start, goal, departure, closures)
                d = dijkstra(GRAPH, start, goal, departure, closures)
                reliable = reliable_route(GRAPH, start, goal, departure, closures)
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
                return
            self.send_json(200, {
                "astar": asdict(a) if a else None,
                "dijkstra": asdict(d) if d else None,
                "reliable": asdict(reliable) if reliable else None,
                "fastest_p90_seconds": estimated_p90_seconds(GRAPH, a.path, departure) if a else None,
                "verified_optimum": bool(a and d and abs(a.travel_seconds - d.travel_seconds) < 1e-6),
                "input": {"start": start, "goal": goal, "departure": departure, "closed": closed_names},
                "steps": route_steps(a.path, departure) if a else [],
                "reliable_steps": route_steps(reliable.path, departure) if reliable else [],
            })
            return
        if parsed.path in ("/", "/index.html"):
            file = ROOT / "web" / "index.html"
            content_type = "text/html; charset=utf-8"
        elif parsed.path in ("/app.js", "/style.css", "/favicon.svg", "/vendor/three.module.js", "/vendor/three.core.js"):
            file = ROOT / "web" / parsed.path.lstrip("/")
            content_type = {".css": "text/css", ".svg": "image/svg+xml"}.get(file.suffix, "text/javascript")
        else:
            self.send_error(404)
            return
        if not file.is_file():
            self.send_error(404)
            return
        body = file.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def route_steps(path: tuple[str, ...], departure: str) -> list[dict]:
    hour, minute = map(int, departure.split(":"))
    clock = hour * 3600 + minute * 60
    steps = []
    for start, end in zip(path, path[1:]):
        edge = next(item for item in GRAPH.neighbors[start] if item.destination == end)
        duration = edge_travel_seconds(edge, clock)
        steps.append({
            "start": start, "end": end, "seconds": round(duration, 1),
            "distance_km": edge.distance_km,
        })
        clock += duration
    return steps


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("VIT shuttle simulator: http://127.0.0.1:8000")
    server.serve_forever()
