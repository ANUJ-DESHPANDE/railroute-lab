"""Reproduce the course comparison from the local search implementations.

Run ``python experiments.py`` to write experiment_results.json. The generated
file contains assumptions, individual demo cases, and aggregate measurements.
"""

from __future__ import annotations

import json
from pathlib import Path

from routing import astar, dijkstra
from sample_map import DEFAULT_SEED, EAST_TUNNEL, WEST_TUNNEL, generate_map


ROOT = Path(__file__).parent
SEEDS = (0, 1, 7, 17, 42)
TIMES = ("07:00", "08:30", "10:00", "12:00", "16:00", "19:00")
CLOSURES = {
    "open": set(),
    "west_closed": {WEST_TUNNEL},
    "east_closed": {EAST_TUNNEL},
    "both_closed": {WEST_TUNNEL, EAST_TUNNEL},
}


def run_experiment() -> dict:
    graph, _ = generate_map(DEFAULT_SEED)
    scenarios = []
    for label, time, closure in (
        ("off_peak_open", "12:00", "open"),
        ("morning_open", "08:30", "open"),
        ("off_peak_west_closed", "12:00", "west_closed"),
        ("off_peak_east_closed", "12:00", "east_closed"),
        ("off_peak_both_closed", "12:00", "both_closed"),
    ):
        a = astar(graph, "Science Hall", "North Library", time, CLOSURES[closure])
        d = dijkstra(graph, "Science Hall", "North Library", time, CLOSURES[closure])
        scenarios.append({
            "case": label, "time": time, "closures": closure,
            "astar_path": list(a.path) if a else None,
            "astar_minutes": round(a.travel_seconds / 60, 3) if a else None,
            "dijkstra_minutes": round(d.travel_seconds / 60, 3) if d else None,
            "astar_expanded": a.nodes_expanded if a else None,
            "dijkstra_expanded": d.nodes_expanded if d else None,
        })

    total = reachable = astar_expansions = dijkstra_expansions = 0
    fewer = equal = more = 0
    for seed in SEEDS:
        graph, _ = generate_map(seed)
        names = tuple(graph.coordinates)
        for time in TIMES:
            for closure in CLOSURES.values():
                for start in names:
                    for goal in names:
                        a = astar(graph, start, goal, time, closure)
                        d = dijkstra(graph, start, goal, time, closure)
                        total += 1
                        if (a is None) != (d is None):
                            raise AssertionError((seed, time, closure, start, goal, "reachability"))
                        if a is None:
                            continue
                        if abs(a.travel_seconds - d.travel_seconds) > 1e-6:
                            raise AssertionError((seed, time, closure, start, goal, "cost"))
                        reachable += 1
                        astar_expansions += a.nodes_expanded
                        dijkstra_expansions += d.nodes_expanded
                        if a.nodes_expanded < d.nodes_expanded:
                            fewer += 1
                        elif a.nodes_expanded == d.nodes_expanded:
                            equal += 1
                        else:
                            more += 1
    return {
        "model": "Fictional 14-node, 17-road graph; synthetic road times and congestion",
        "method": "All ordered start/goal pairs for five seeds, six times, and four tunnel states",
        "seeds": SEEDS, "times": TIMES, "closure_states": tuple(CLOSURES),
        "individual_cases": scenarios,
        "aggregate": {
            "cases": total, "reachable_cases": reachable,
            "unreachable_cases": total - reachable,
            "cost_or_reachability_disagreements": 0,
            "astar_total_expansions_on_reachable": astar_expansions,
            "dijkstra_total_expansions_on_reachable": dijkstra_expansions,
            "astar_mean_expansions_on_reachable": round(astar_expansions / reachable, 3),
            "dijkstra_mean_expansions_on_reachable": round(dijkstra_expansions / reachable, 3),
            "astar_fewer": fewer, "equal_expansions": equal, "astar_more": more,
        },
        "caveat": "Dijkstra is the same search engine with h=0; agreement is a useful consistency check, not independent proof of optimality.",
    }


if __name__ == "__main__":
    output = ROOT / "experiment_results.json"
    result = run_experiment()
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
    print(json.dumps(result["aggregate"], indent=2))
