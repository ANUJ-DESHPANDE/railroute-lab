"""Local browser simulator backed by the Python A* implementation.

Run: python app.py, then open http://localhost:8000
"""

from __future__ import annotations

import json
from dataclasses import asdict
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter
from urllib.parse import parse_qs, urlparse

from routing import MAX_SHUTTLE_SPEED_KMH, astar, congestion_period, dijkstra, edge_travel_seconds, estimated_p90_seconds, reliable_route
from sample_map import DEFAULT_SEED, EAST_TUNNEL, WEST_TUNNEL, generate_map


ROOT = Path(__file__).parent
TUNNELS = {"west": WEST_TUNNEL, "east": EAST_TUNNEL}


@lru_cache(maxsize=32)
def graph_for_seed(seed: int):
    return generate_map(seed)


GRAPH, LOCATIONS = graph_for_seed(DEFAULT_SEED)


def graph_payload(seed: int) -> dict:
    graph, locations = graph_for_seed(seed)
    seen = set()
    roads = []
    for start, edges in graph.neighbors.items():
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
            for name, x, y, kind in locations
        ],
        "roads": roads,
        "tunnels": TUNNELS,
        "seed": seed,
        "max_speed_kmh": MAX_SHUTTLE_SPEED_KMH,
        "data_status": "Fictional, seeded campus. Railway crossings exist only at the two road tunnels. Distances, congestion, and delay spread are generated simulation values.",
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
        query = parse_qs(parsed.query)
        try:
            seed = int(query.get("seed", [str(DEFAULT_SEED)])[0])
            graph, _ = graph_for_seed(seed)
        except (ValueError, TypeError) as exc:
            self.send_json(400, {"error": f"Invalid map seed: {exc}"})
            return
        if parsed.path == "/api/graph":
            self.send_json(200, graph_payload(seed))
            return
        if parsed.path == "/api/source":
            body = (ROOT / "routing.py").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/route":
            start = query.get("start", ["Science Hall"])[0]
            goal = query.get("goal", ["North Library"])[0]
            departure = query.get("departure", ["12:00"])[0]
            closed_names = query.get("closed", [])
            unknown = set(closed_names) - set(TUNNELS)
            if unknown:
                self.send_json(400, {"error": "Unknown tunnel closure"})
                return
            closures = {TUNNELS[name] for name in closed_names}
            try:
                astar_trace = []
                dijkstra_trace = []
                start_clock = perf_counter()
                a = astar(graph, start, goal, departure, closures, astar_trace)
                astar_ms = (perf_counter() - start_clock) * 1000
                start_clock = perf_counter()
                d = dijkstra(graph, start, goal, departure, closures, dijkstra_trace)
                dijkstra_ms = (perf_counter() - start_clock) * 1000
                reliable = reliable_route(graph, start, goal, departure, closures)
            except ValueError as exc:
                self.send_json(400, {"error": str(exc)})
                return
            self.send_json(200, {
                "astar": asdict(a) if a else None,
                "dijkstra": asdict(d) if d else None,
                "astar_trace": [asdict(item) for item in astar_trace],
                "dijkstra_trace": [asdict(item) for item in dijkstra_trace],
                "reliable": asdict(reliable) if reliable else None,
                "fastest_p90_seconds": estimated_p90_seconds(graph, a.path, departure) if a else None,
                "verified_optimum": bool(a and d and abs(a.travel_seconds - d.travel_seconds) < 1e-6),
                "runtime_ms": {"astar": round(astar_ms, 4), "dijkstra": round(dijkstra_ms, 4)},
                "input": {"start": start, "goal": goal, "departure": departure, "closed": closed_names, "seed": seed},
                "steps": route_steps(graph, a.path, departure) if a else [],
                "reliable_steps": route_steps(graph, reliable.path, departure) if reliable else [],
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


def route_steps(graph, path: tuple[str, ...], departure: str) -> list[dict]:
    hour, minute = map(int, departure.split(":"))
    clock = hour * 3600 + minute * 60
    steps = []
    for start, end in zip(path, path[1:]):
        edge = next(item for item in graph.neighbors[start] if item.destination == end)
        duration = edge_travel_seconds(edge, clock)
        entry_time = f"{int(clock // 3600) % 24:02d}:{int(clock // 60) % 60:02d}"
        steps.append({
            "start": start, "end": end, "seconds": round(duration, 1),
            "distance_km": edge.distance_km,
            "free_flow_seconds": edge.free_flow_seconds,
            "entry_time": entry_time,
            "entry_period": congestion_period(entry_time),
            "effective_multiplier": round(duration / edge.free_flow_seconds, 3),
        })
        clock += duration
    return steps


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("RailRoute Lab: http://127.0.0.1:8000")
    server.serve_forever()
