"""VIT Vellore inspired schematic network for algorithm experiments.

Landmark names and the railway split follow public maps and user annotations.
All stop choices, link geometry, directions, times and traffic values remain
model assumptions. This is a simulator dataset, not a surveyed shuttle map.
"""

from math import hypot

from routing import CampusGraph


WEST_TUNNEL = ("West Tunnel South", "West Tunnel North")
EAST_TUNNEL = ("East Tunnel South", "East Tunnel North")

LOCATIONS = (
    ("Main Gate", 0.08, -0.57, "stop"),
    ("MGR Block", 0.28, -0.41, "stop"),
    ("Technology Tower", 0.55, -0.20, "stop"),
    ("Silver Jubilee Tower", 0.94, -0.19, "stop"),
    ("Pearl Research Park", 1.34, -0.19, "stop"),
    ("Gandhi Block", 1.38, -0.01, "stop"),
    ("Hostel J Block", 0.25, 0.55, "stop"),
    ("Hostel F Block", 0.43, 0.76, "stop"),
    ("Hostel Q Block", 1.02, 0.61, "stop"),
    ("Hostel M Block", 1.27, 0.43, "stop"),
    ("West Tunnel South", 0.45, -0.06, "junction"),
    ("West Tunnel North", 0.45, 0.25, "junction"),
    ("East Tunnel South", 1.18, -0.01, "junction"),
    ("East Tunnel North", 1.18, 0.27, "junction"),
)


def vit_demo_graph() -> CampusGraph:
    graph = CampusGraph()
    for name, east, north, _ in LOCATIONS:
        graph.add_location(name, east, north)

    # Hypothetical congestion factors, chosen to produce different routes.
    central = {"off_peak": 1.0, "morning_peak": 2.7, "evening_peak": 1.8}
    moderate = {"off_peak": 1.0, "morning_peak": 1.5, "evening_peak": 1.3}
    quiet = {"off_peak": 1.0, "morning_peak": 1.1, "evening_peak": 1.1}

    roads = (
        ("Main Gate", "MGR Block", central),
        ("MGR Block", "Technology Tower", central),
        ("Technology Tower", "Silver Jubilee Tower", central),
        ("Silver Jubilee Tower", "Pearl Research Park", moderate),
        ("Pearl Research Park", "Gandhi Block", moderate),
        ("Gandhi Block", "East Tunnel South", moderate),
        ("Silver Jubilee Tower", "East Tunnel South", quiet),
        ("Technology Tower", "West Tunnel South", central),
        ("MGR Block", "West Tunnel South", central),
        ("West Tunnel South", "West Tunnel North", central),
        ("East Tunnel South", "East Tunnel North", quiet),
        ("West Tunnel North", "Hostel J Block", central),
        ("Hostel J Block", "Hostel F Block", moderate),
        ("Hostel F Block", "Hostel Q Block", moderate),
        ("Hostel Q Block", "Hostel M Block", quiet),
        ("Hostel M Block", "East Tunnel North", quiet),
        ("West Tunnel North", "Hostel Q Block", moderate),
    )
    for start, end, factors in roads:
        x1, y1 = graph.coordinates[start]
        x2, y2 = graph.coordinates[end]
        distance = round(hypot(x2 - x1, y2 - y1) * 1.15, 3)
        free_flow = round(distance / 12 * 3600, 1)  # 12 km/h modeled cruising speed.
        uncertainty = 300.0 if {start, end} == set(WEST_TUNNEL) else None
        if {start, end} == set(EAST_TUNNEL):
            uncertainty = 60.0
        graph.add_road(start, end, distance, free_flow, factors, uncertainty_seconds=uncertainty)
    return graph
