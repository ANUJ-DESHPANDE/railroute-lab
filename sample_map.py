"""Generate a reproducible fictional campus with a railway barrier.

The seed changes locations, road lengths, cruising speeds and congestion.
The connected road topology is fixed so every generated map retains two
different road tunnels beneath the railway. No real campus is represented.
"""

from __future__ import annotations

from math import hypot
from random import Random

from routing import CampusGraph


DEFAULT_SEED = 17
WEST_TUNNEL = ("B", "C")
EAST_TUNNEL = ("F", "G")

# x = east, y = north, in an abstract kilometre-scale coordinate frame.
BASE_LOCATIONS = (
    ("J", 0.08, -0.57, "stop"),
    ("I", 0.28, -0.41, "stop"),
    ("A", 0.55, -0.20, "stop"),
    ("E", 0.94, -0.19, "stop"),
    ("K", 1.34, -0.19, "stop"),
    ("L", 1.38, -0.01, "stop"),
    ("M", 0.25, 0.55, "stop"),
    ("N", 0.43, 0.76, "stop"),
    ("D", 1.02, 0.61, "stop"),
    ("H", 1.27, 0.43, "stop"),
    ("B", 0.45, -0.06, "junction"),
    ("C", 0.45, 0.25, "junction"),
    ("F", 1.18, -0.01, "junction"),
    ("G", 1.18, 0.27, "junction"),
)

ROADS = (
    ("J", "I", "central"),
    ("I", "A", "central"),
    ("A", "E", "central"),
    ("E", "K", "moderate"),
    ("K", "L", "moderate"),
    ("L", "F", "moderate"),
    ("E", "F", "quiet"),
    ("A", "B", "central"),
    ("I", "B", "central"),
    ("B", "C", "central"),
    ("F", "G", "quiet"),
    ("C", "M", "central"),
    ("M", "N", "moderate"),
    ("N", "D", "moderate"),
    ("D", "H", "quiet"),
    ("H", "G", "quiet"),
    ("C", "D", "moderate"),
)


def generate_map(seed: int = DEFAULT_SEED) -> tuple[CampusGraph, tuple[tuple[str, float, float, str], ...]]:
    """Return a graph and its display locations for an integer seed."""
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 99999:
        raise ValueError("Map seed must be an integer from 0 to 99999")
    rng = Random(seed)
    locations = []
    graph = CampusGraph()
    for name, x, y, kind in BASE_LOCATIONS:
        jitter = 0.018 if kind == "junction" else 0.045
        east = round(x + rng.uniform(-jitter, jitter), 4)
        north = round(y + rng.uniform(-jitter, jitter), 4)
        locations.append((name, east, north, kind))
        graph.add_location(name, east, north)

    for start, end, category in ROADS:
        x1, y1 = graph.coordinates[start]
        x2, y2 = graph.coordinates[end]
        road_length = round(hypot(x2 - x1, y2 - y1) * rng.uniform(1.08, 1.24), 4)
        speed = rng.uniform(9.5, 12.8)  # Below the heuristic's 15 km/h bound.
        free_flow = round(road_length / speed * 3600, 1)
        if category == "central":
            morning = rng.uniform(2.25, 2.85)
            evening = rng.uniform(1.45, 1.85)
        elif category == "moderate":
            morning = rng.uniform(1.30, 1.65)
            evening = rng.uniform(1.15, 1.40)
        else:
            morning = rng.uniform(1.02, 1.15)
            evening = rng.uniform(1.02, 1.16)
        factors = {"off_peak": 1.0, "morning_peak": round(morning, 3), "evening_peak": round(evening, 3)}
        uncertainty = free_flow * 0.15
        if {start, end} == set(WEST_TUNNEL):
            uncertainty = rng.uniform(180, 240)
        elif {start, end} == set(EAST_TUNNEL):
            uncertainty = rng.uniform(45, 75)
        graph.add_road(start, end, road_length, free_flow, factors, uncertainty_seconds=round(uncertainty, 1))
    return graph, tuple(locations)
