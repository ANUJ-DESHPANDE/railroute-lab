"""Temporary synthetic network for exercising the Review 2 routing core."""

from __future__ import annotations

import argparse

from routing import CampusGraph, astar, dijkstra


def example_graph() -> CampusGraph:
    graph = CampusGraph()
    for name, east, north in (
        ("Gate", 0.0, 0.0),
        ("Admin", 0.5, 0.0),
        ("Library", 1.0, 0.0),
        ("Sports", 0.5, 0.5),
        ("Hostel", 1.0, 0.5),
    ):
        graph.add_location(name, east, north)

    busy = {"off_peak": 1.0, "morning_peak": 2.0, "evening_peak": 1.5}
    quiet = {"off_peak": 1.0, "morning_peak": 1.0, "evening_peak": 1.0}
    graph.add_road("Gate", "Admin", 0.5, 120, busy)
    graph.add_road("Admin", "Library", 0.5, 120, busy)
    graph.add_road("Gate", "Sports", 0.75, 180, quiet)
    graph.add_road("Sports", "Library", 0.75, 180, quiet)
    graph.add_road("Sports", "Hostel", 0.5, 120, quiet)
    graph.add_road("Hostel", "Library", 0.5, 120, quiet)
    return graph


def main() -> None:
    graph = example_graph()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("start", nargs="?", default="Gate", choices=graph.coordinates)
    parser.add_argument("goal", nargs="?", default="Library", choices=graph.coordinates)
    parser.add_argument("departure", nargs="?", default="08:30", help="24-hour HH:MM")
    args = parser.parse_args()
    for label, algorithm in (("A*", astar), ("Dijkstra", dijkstra)):
        result = algorithm(graph, args.start, args.goal, args.departure)
        if result is None:
            print(f"{label}: no route exists")
        else:
            print(
                f"{label}: {' -> '.join(result.path)} | "
                f"{result.travel_seconds / 60:.1f} min | "
                f"{result.distance_km:.2f} km | "
                f"{result.nodes_expanded} nodes expanded | {result.period}"
            )


if __name__ == "__main__":
    main()
