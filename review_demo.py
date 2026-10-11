"""Code-first route demonstration for project review.

Run ``python review_demo.py --help`` for input options.
"""

from __future__ import annotations

import argparse

from app import GRAPH, TUNNELS, graph_for_seed, route_steps
from routing import astar, dijkstra, estimated_p90_seconds, reliable_route
from sample_map import DEFAULT_SEED


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default="Science Hall", choices=GRAPH.coordinates)
    parser.add_argument("--goal", default="North Library", choices=GRAPH.coordinates)
    parser.add_argument("--time", default="12:00", help="24-hour HH:MM departure time")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="Fictional map seed (0–99999)")
    parser.add_argument("--close", action="append", choices=TUNNELS, default=[], help="Close a modeled underpass")
    args = parser.parse_args()
    graph, _ = graph_for_seed(args.seed)
    closures = {TUNNELS[name] for name in args.close}

    trace = []
    a = astar(graph, args.start, args.goal, args.time, closures, trace)
    d = dijkstra(graph, args.start, args.goal, args.time, closures)
    reliable = reliable_route(graph, args.start, args.goal, args.time, closures)
    print(f"TRIP  {args.start} -> {args.goal} | {args.time} | seed {args.seed} | closed: {', '.join(args.close) or 'none'}")
    if a is None:
        print("No route exists under these conditions.")
        print(f"A* explored {len(trace)} reachable locations before its queue emptied:")
        for index, step in enumerate(trace, 1):
            closed = [choice.destination for choice in step.neighbors if choice.outcome == "closed"]
            print(f"{index:>2}. {step.node}" + (f" | closed road toward {', '.join(closed)}" if closed else ""))
        print(f"Dijkstra agrees: {'no route' if d is None else 'route found'}.")
        return
    print(f"A* FASTEST  {' -> '.join(a.path)}")
    print(f"ETA {a.travel_seconds / 60:.2f} min | distance {a.distance_km:.2f} km | expanded {a.nodes_expanded} nodes")
    print("\nSEARCH TRACE  f = g + h (minutes)")
    for index, step in enumerate(a.expansions, 1):
        print(f"{index:>2}. {step.node:<24} {step.g_seconds / 60:>5.2f} + {step.h_seconds / 60:>5.2f} = {step.f_seconds / 60:>5.2f}")
    print("\nROAD COSTS")
    for step in route_steps(graph, a.path, args.time):
        print(f"{step['start']} -> {step['end']}: {step['seconds'] / 60:.2f} min")
    print(f"\nDIJKSTRA  {d.travel_seconds / 60:.2f} min | expanded {d.nodes_expanded} nodes")
    print(f"OPTIMUM CHECK  {'PASS' if abs(a.travel_seconds - d.travel_seconds) < 1e-6 else 'FAIL'}")
    print(f"FASTEST P90 ESTIMATE  {estimated_p90_seconds(graph, a.path, args.time) / 60:.2f} min")
    print(f"RELIABLE ROUTE  {' -> '.join(reliable.path)}")
    print(f"RELIABLE ETA / P90  {reliable.expected_seconds / 60:.2f} / {reliable.estimated_p90_seconds / 60:.2f} min")
    print("All traffic and uncertainty values are hypothetical simulation inputs.")


if __name__ == "__main__":
    main()
