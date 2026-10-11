"""Checks that the search core returns the expected optimum on varied inputs."""

import unittest

from demo import example_graph
from routing import CampusGraph, Edge, astar, dijkstra, edge_travel_seconds, estimated_p90_seconds, reliable_route
from vit_demo import EAST_TUNNEL, WEST_TUNNEL, vit_demo_graph


class RoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.graph = example_graph()

    def test_departure_time_changes_optimal_route(self) -> None:
        off_peak = astar(self.graph, "Gate", "Library", "12:00")
        peak = astar(self.graph, "Gate", "Library", "08:30")
        self.assertEqual(off_peak.path, ("Gate", "Admin", "Library"))
        self.assertEqual(off_peak.travel_seconds, 240)
        self.assertEqual(peak.path, ("Gate", "Sports", "Library"))
        self.assertEqual(peak.travel_seconds, 360)

    def test_astar_agrees_with_dijkstra_on_all_pairs_and_periods(self) -> None:
        for departure in ("06:59", "07:00", "09:59", "10:00", "16:00", "19:00"):
            for start in self.graph.coordinates:
                for goal in self.graph.coordinates:
                    with self.subTest(departure=departure, start=start, goal=goal):
                        a = astar(self.graph, start, goal, departure)
                        d = dijkstra(self.graph, start, goal, departure)
                        self.assertEqual(a.travel_seconds, d.travel_seconds)

    def test_unreachable_goal_returns_none(self) -> None:
        graph = CampusGraph()
        graph.add_location("A", 0, 0)
        graph.add_location("B", 1, 0)
        self.assertIsNone(astar(graph, "A", "B", "12:00"))

    def test_invalid_time_and_heuristic_assumptions_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            astar(self.graph, "Gate", "Library", "25:00")
        with self.assertRaises(ValueError):
            self.graph.add_road("Gate", "Library", 1.0, 100)

    def test_edge_spanning_a_traffic_boundary_integrates_both_periods(self) -> None:
        edge = Edge("B", 0.3, 120, {"off_peak": 1.0, "morning_peak": 2.0, "evening_peak": 1.0}, 10)
        self.assertAlmostEqual(edge_travel_seconds(edge, 9 * 3600 + 59 * 60), 150)
        self.assertLess(9 * 3600 + 58 * 60 + edge_travel_seconds(edge, 9 * 3600 + 58 * 60),
                        9 * 3600 + 59 * 60 + edge_travel_seconds(edge, 9 * 3600 + 59 * 60))

    def test_vit_scenarios_change_routes_and_baselines_agree(self) -> None:
        graph = vit_demo_graph()
        off_peak = astar(graph, "Technology Tower", "Hostel Q Block", "12:00")
        morning = astar(graph, "Technology Tower", "Hostel Q Block", "08:30")
        closed = astar(graph, "Technology Tower", "Hostel Q Block", "12:00", {WEST_TUNNEL})
        self.assertIn("West Tunnel South", off_peak.path)
        self.assertIn("East Tunnel South", morning.path)
        self.assertIn("East Tunnel South", closed.path)
        self.assertNotIn("West Tunnel South", closed.path)
        self.assertEqual(off_peak.nodes_expanded, len(off_peak.expansions))
        for time in ("06:59", "07:00", "09:59", "10:00", "12:00", "18:59"):
            for start in graph.coordinates:
                for goal in graph.coordinates:
                    for closures in (set(), {WEST_TUNNEL}, {EAST_TUNNEL}):
                        with self.subTest(time=time, start=start, goal=goal, closures=closures):
                            a = astar(graph, start, goal, time, closures)
                            d = dijkstra(graph, start, goal, time, closures)
                            self.assertEqual(a is None, d is None)
                            if a is not None:
                                self.assertAlmostEqual(a.travel_seconds, d.travel_seconds)

    def test_reliable_mode_optimizes_its_declared_p90_model(self) -> None:
        graph = vit_demo_graph()
        fastest = astar(graph, "Technology Tower", "Hostel Q Block", "12:00")
        reliable = reliable_route(graph, "Technology Tower", "Hostel Q Block", "12:00")
        self.assertNotEqual(fastest.path, reliable.path)
        self.assertLess(reliable.estimated_p90_seconds,
                        estimated_p90_seconds(graph, fastest.path, "12:00"))
        self.assertGreater(reliable.paths_evaluated, 1)
        self.assertIsNone(astar(graph, "Technology Tower", "Hostel Q Block", "12:00",
                                {WEST_TUNNEL, EAST_TUNNEL}))


if __name__ == "__main__":
    unittest.main()
