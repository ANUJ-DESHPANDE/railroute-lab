"""Self-implemented A* and Dijkstra for a time-dependent campus road graph.

Road traversal integrates congestion across time-period boundaries. Costs are
seconds, and the straight-line heuristic is a validated lower bound.
"""

from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
from itertools import count
from math import hypot, inf, isfinite, sqrt


MAX_SHUTTLE_SPEED_KMH = 15.0
PERIODS = ("off_peak", "morning_peak", "evening_peak")


@dataclass(frozen=True)
class Edge:
    destination: str
    distance_km: float
    free_flow_seconds: float
    multipliers: dict[str, float]
    uncertainty_seconds: float


@dataclass(frozen=True)
class RouteResult:
    path: tuple[str, ...]
    travel_seconds: float
    distance_km: float
    nodes_expanded: int
    period: str
    expansions: tuple[SearchExpansion, ...]


@dataclass(frozen=True)
class SearchExpansion:
    node: str
    g_seconds: float
    h_seconds: float
    f_seconds: float
    neighbors: tuple[NeighborDecision, ...] = ()
    frontier_after: tuple[FrontierEntry, ...] = ()


@dataclass(frozen=True)
class NeighborDecision:
    """One road considered while expanding a node, including skipped roads."""

    destination: str
    road_seconds: float | None
    candidate_g_seconds: float | None
    candidate_h_seconds: float | None
    candidate_f_seconds: float | None
    outcome: str  # queued, closed, settled, or not_better


@dataclass(frozen=True)
class FrontierEntry:
    """A valid pending node after this expansion, ordered by heap priority."""

    node: str
    g_seconds: float
    h_seconds: float
    f_seconds: float


@dataclass(frozen=True)
class ReliabilityResult:
    path: tuple[str, ...]
    expected_seconds: float
    estimated_p90_seconds: float
    distance_km: float
    paths_evaluated: int
    period: str


class CampusGraph:
    def __init__(self) -> None:
        # Coordinates are local east/north distances in kilometres.
        self.coordinates: dict[str, tuple[float, float]] = {}
        self.neighbors: dict[str, list[Edge]] = {}

    def add_location(self, name: str, east_km: float, north_km: float) -> None:
        if name in self.coordinates:
            raise ValueError(f"Location already exists: {name}")
        if not all(isfinite(value) for value in (east_km, north_km)):
            raise ValueError("Location coordinates must be finite")
        self.coordinates[name] = (east_km, north_km)
        self.neighbors[name] = []

    def add_road(
        self,
        start: str,
        end: str,
        distance_km: float,
        free_flow_seconds: float,
        multipliers: dict[str, float] | None = None,
        bidirectional: bool = True,
        uncertainty_seconds: float | None = None,
    ) -> None:
        if start not in self.coordinates or end not in self.coordinates:
            raise ValueError("Both road endpoints must be known locations")
        if start == end or not all(isfinite(value) and value > 0 for value in (distance_km, free_flow_seconds)):
            raise ValueError("A road needs different endpoints and positive distance/time")
        values = dict(multipliers or {period: 1.0 for period in PERIODS})
        if set(values) != set(PERIODS) or any(not isfinite(value) or value < 1 for value in values.values()):
            raise ValueError("Every period needs a congestion multiplier >= 1")
        straight_km = hypot(
            self.coordinates[start][0] - self.coordinates[end][0],
            self.coordinates[start][1] - self.coordinates[end][1],
        )
        if distance_km + 1e-9 < straight_km:
            raise ValueError("Road distance cannot be shorter than straight-line distance")
        if free_flow_seconds + 1e-9 < distance_km / MAX_SHUTTLE_SPEED_KMH * 3600:
            raise ValueError("Free-flow travel time exceeds the assumed 15 km/h speed")
        uncertainty = 0.15 * free_flow_seconds if uncertainty_seconds is None else uncertainty_seconds
        if not isfinite(uncertainty) or uncertainty < 0:
            raise ValueError("Uncertainty must be finite and non-negative")
        self.neighbors[start].append(Edge(end, distance_km, free_flow_seconds, values, uncertainty))
        if bidirectional:
            self.neighbors[end].append(Edge(start, distance_km, free_flow_seconds, values, uncertainty))


def congestion_period(departure_time: str) -> str:
    """Classify a 24-hour HH:MM departure time."""
    try:
        if not isinstance(departure_time, str):
            raise ValueError
        hour_text, minute_text = departure_time.split(":")
        if len(hour_text) != 2 or len(minute_text) != 2:
            raise ValueError
        hour, minute = int(hour_text), int(minute_text)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError
    except ValueError as exc:
        raise ValueError("Departure time must be HH:MM in 24-hour format") from exc
    minutes = hour * 60 + minute
    if 7 * 60 <= minutes < 10 * 60:
        return "morning_peak"
    if 16 * 60 <= minutes < 19 * 60:
        return "evening_peak"
    return "off_peak"


def _clock_seconds(departure_time: str) -> int:
    congestion_period(departure_time)  # Validate format and range.
    hour, minute = map(int, departure_time.split(":"))
    return hour * 3600 + minute * 60


def _period_at(clock_seconds: float) -> str:
    seconds = clock_seconds % 86400
    if 7 * 3600 <= seconds < 10 * 3600:
        return "morning_peak"
    if 16 * 3600 <= seconds < 19 * 3600:
        return "evening_peak"
    return "off_peak"


def edge_travel_seconds(edge: Edge, entry_clock_seconds: float) -> float:
    """Integrate progress across period boundaries instead of jumping costs.

    The shuttle makes 1/multiplier units of free-flow progress per second.
    This continuous-progress model is FIFO: leaving later cannot arrive first
    merely because a congestion bucket changed while traversing an edge.
    """
    remaining_work = edge.free_flow_seconds
    clock = entry_clock_seconds
    elapsed = 0.0
    while remaining_work > 1e-9:
        today = clock % 86400
        next_boundary = next(
            boundary for boundary in (7 * 3600, 10 * 3600, 16 * 3600, 19 * 3600, 86400)
            if boundary > today + 1e-9
        )
        available_seconds = next_boundary - today
        multiplier = edge.multipliers[_period_at(clock)]
        progress = available_seconds / multiplier
        if remaining_work <= progress + 1e-9:
            elapsed += remaining_work * multiplier
            break
        remaining_work -= progress
        clock += available_seconds
        elapsed += available_seconds
    return elapsed


def _heuristic_seconds(graph: CampusGraph, current: str, goal: str) -> float:
    x1, y1 = graph.coordinates[current]
    x2, y2 = graph.coordinates[goal]
    return hypot(x2 - x1, y2 - y1) / MAX_SHUTTLE_SPEED_KMH * 3600


def _search(
    graph: CampusGraph,
    start: str,
    goal: str,
    departure_time: str,
    use_heuristic: bool,
    closed_roads: set[tuple[str, str]] | None = None,
    trace: list[SearchExpansion] | None = None,
) -> RouteResult | None:
    if start not in graph.coordinates or goal not in graph.coordinates:
        raise ValueError("Start and goal must be known locations")
    period = congestion_period(departure_time)
    departure_clock = _clock_seconds(departure_time)
    closures = {tuple(sorted(road)) for road in (closed_roads or set())}
    # Each heap item holds f = g + h, a tie breaker, node, and its g value.
    serial = count()
    initial_h = _heuristic_seconds(graph, start, goal) if use_heuristic else 0.0
    frontier = [(initial_h, next(serial), start, 0.0)]
    best_g = {start: 0.0}
    parent: dict[str, tuple[str, Edge]] = {}
    expanded: set[str] = set()
    expansion_log: list[SearchExpansion] = trace if trace is not None else []

    def pending_frontier() -> tuple[FrontierEntry, ...]:
        """Ignore stale heap copies, preserving the heap's actual tie order."""
        pending = []
        seen = set()
        for _, _, node, queued_g in sorted(frontier):
            if node in expanded or node in seen or queued_g > best_g[node] + 1e-9:
                continue
            h = _heuristic_seconds(graph, node, goal) if use_heuristic else 0.0
            pending.append(FrontierEntry(node, queued_g, h, queued_g + h))
            seen.add(node)
        return tuple(pending)

    while frontier:
        _, _, current, queued_g = heappop(frontier)
        if queued_g > best_g[current] + 1e-9 or current in expanded:
            continue  # A better entry superseded this heap entry.
        expanded.add(current)
        current_h = _heuristic_seconds(graph, current, goal) if use_heuristic else 0.0
        if current == goal:
            expansion_log.append(SearchExpansion(current, best_g[current], current_h, best_g[current] + current_h))
            path = [goal]
            distance = 0.0
            while path[-1] != start:
                previous, edge = parent[path[-1]]
                distance += edge.distance_km
                path.append(previous)
            path.reverse()
            return RouteResult(tuple(path), best_g[goal], distance, len(expanded), period, tuple(expansion_log))

        decisions: list[NeighborDecision] = []
        for edge in graph.neighbors[current]:
            neighbor = edge.destination
            if tuple(sorted((current, neighbor))) in closures:
                decisions.append(NeighborDecision(neighbor, None, None, None, None, "closed"))
                continue
            edge_seconds = edge_travel_seconds(edge, departure_clock + best_g[current])
            new_g = best_g[current] + edge_seconds
            h = _heuristic_seconds(graph, neighbor, goal) if use_heuristic else 0.0
            if neighbor in expanded:
                decisions.append(NeighborDecision(neighbor, edge_seconds, new_g, h, new_g + h, "settled"))
                continue
            if new_g >= best_g.get(neighbor, inf) - 1e-9:
                decisions.append(NeighborDecision(neighbor, edge_seconds, new_g, h, new_g + h, "not_better"))
                continue
            best_g[neighbor] = new_g
            parent[neighbor] = (current, edge)
            heappush(frontier, (new_g + h, next(serial), neighbor, new_g))
            decisions.append(NeighborDecision(neighbor, edge_seconds, new_g, h, new_g + h, "queued"))
        expansion_log.append(SearchExpansion(
            current, best_g[current], current_h, best_g[current] + current_h,
            tuple(decisions), pending_frontier(),
        ))
    return None


def astar(
    graph: CampusGraph,
    start: str,
    goal: str,
    departure_time: str,
    closed_roads: set[tuple[str, str]] | None = None,
    trace: list[SearchExpansion] | None = None,
) -> RouteResult | None:
    """Find a minimum-travel-time route with a straight-line time heuristic."""
    return _search(graph, start, goal, departure_time, use_heuristic=True, closed_roads=closed_roads, trace=trace)


def dijkstra(
    graph: CampusGraph,
    start: str,
    goal: str,
    departure_time: str,
    closed_roads: set[tuple[str, str]] | None = None,
    trace: list[SearchExpansion] | None = None,
) -> RouteResult | None:
    """Find the same optimum without a heuristic (A* with h = 0)."""
    return _search(graph, start, goal, departure_time, use_heuristic=False, closed_roads=closed_roads, trace=trace)


def reliable_route(
    graph: CampusGraph,
    start: str,
    goal: str,
    departure_time: str,
    closed_roads: set[tuple[str, str]] | None = None,
) -> ReliabilityResult | None:
    """Choose the simple path with the smallest estimated 90th-percentile ETA.

    This small-graph teaching model enumerates simple paths. Each edge has an
    assumed independent delay standard deviation derived from its modeled
    peak congestion. For a larger road network, path enumeration would need
    replacing with a scalable multi-label or candidate-path method.
    """
    if start not in graph.coordinates or goal not in graph.coordinates:
        raise ValueError("Start and goal must be known locations")
    period = congestion_period(departure_time)
    departure_clock = _clock_seconds(departure_time)
    closures = {tuple(sorted(road)) for road in (closed_roads or set())}
    stack = [(start, (start,), 0.0, 0.0, 0.0)]
    best: ReliabilityResult | None = None
    evaluated = 0
    while stack:
        node, path, elapsed, variance, distance = stack.pop()
        if node == goal:
            evaluated += 1
            p90 = elapsed + 1.28155 * sqrt(variance)
            if best is None or p90 < best.estimated_p90_seconds - 1e-9:
                best = ReliabilityResult(path, elapsed, p90, distance, evaluated, period)
            continue
        for edge in graph.neighbors[node]:
            if edge.destination in path or tuple(sorted((node, edge.destination))) in closures:
                continue
            edge_mean = edge_travel_seconds(edge, departure_clock + elapsed)
            # Standard deviation is a declared road-data assumption.
            sigma = edge.uncertainty_seconds
            stack.append((
                edge.destination,
                path + (edge.destination,),
                elapsed + edge_mean,
                variance + sigma * sigma,
                distance + edge.distance_km,
            ))
    if best is None:
        return None
    return ReliabilityResult(
        best.path, best.expected_seconds, best.estimated_p90_seconds,
        best.distance_km, evaluated, period,
    )


def estimated_p90_seconds(
    graph: CampusGraph, path: tuple[str, ...], departure_time: str
) -> float:
    """Estimate a path's 90th-percentile ETA under the declared delay model."""
    clock = _clock_seconds(departure_time)
    elapsed = 0.0
    variance = 0.0
    for start, end in zip(path, path[1:]):
        edge = next((road for road in graph.neighbors[start] if road.destination == end), None)
        if edge is None:
            raise ValueError(f"No road connects {start} to {end}")
        elapsed += edge_travel_seconds(edge, clock + elapsed)
        variance += edge.uncertainty_seconds ** 2
    return elapsed + 1.28155 * sqrt(variance)
