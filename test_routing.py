"""Behavior and adversarial checks for the self-implemented search core."""

import unittest

from demo import example_graph
from routing import CampusGraph, Edge, astar, dijkstra, edge_travel_seconds, estimated_p90_seconds, reliable_route
from sample_map import DEFAULT_SEED, EAST_TUNNEL, WEST_TUNNEL, generate_map


class RoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.graph = example_graph()

    def test_small_hand_checked_example(self) -> None:
        off_peak = astar(self.graph, "Gate", "Library", "12:00")
        peak = astar(self.graph, "Gate", "Library", "08:30")
        self.assertEqual(off_peak.path, ("Gate", "Admin", "Library"))
        self.assertAlmostEqual(off_peak.travel_seconds, 240)
        self.assertEqual(peak.path, ("Gate", "Sports", "Library"))
        self.assertAlmostEqual(peak.travel_seconds, 360)

    def test_period_boundary_integrates_travel_and_preserves_fifo(self) -> None:
        edge = Edge("B", 0.3, 120, {"off_peak": 1.0, "morning_peak": 2.0, "evening_peak": 1.0}, 10)
        self.assertAlmostEqual(edge_travel_seconds(edge, 9 * 3600 + 59 * 60), 150)
        for minute in range(9 * 60 + 50, 10 * 60 + 10):
            entry = minute * 60
            self.assertLessEqual(entry + edge_travel_seconds(edge, entry), entry + 60 + edge_travel_seconds(edge, entry + 60) + 1e-8)

    def test_default_scenarios_make_the_railway_matter(self) -> None:
        graph, _ = generate_map(DEFAULT_SEED)
        off_peak = astar(graph, "A", "D", "12:00")
        morning = astar(graph, "A", "D", "08:30")
        closed = astar(graph, "A", "D", "12:00", {WEST_TUNNEL})
        self.assertIn("B", off_peak.path)
        self.assertIn("F", morning.path)
        self.assertIn("F", closed.path)
        self.assertNotIn("B", closed.path)
        self.assertEqual(off_peak.nodes_expanded, len(off_peak.expansions))
        self.assertTrue(any(choice.outcome == "queued" for choice in off_peak.expansions[0].neighbors))
        for expansion in off_peak.expansions:
            for choice in expansion.neighbors:
                if choice.outcome != "closed":
                    self.assertAlmostEqual(choice.candidate_g_seconds, expansion.g_seconds + choice.road_seconds)
                    self.assertAlmostEqual(choice.candidate_f_seconds, choice.candidate_g_seconds + choice.candidate_h_seconds)
            self.assertEqual(tuple(item.f_seconds for item in expansion.frontier_after),
                             tuple(sorted(item.f_seconds for item in expansion.frontier_after)))
        for current, following in zip(off_peak.expansions, off_peak.expansions[1:]):
            self.assertEqual(current.frontier_after[0].node, following.node)
        self.assertIsNone(astar(graph, "A", "D", "12:00", {WEST_TUNNEL, EAST_TUNNEL}))
        failed_trace = []
        self.assertIsNone(astar(graph, "A", "D", "12:00", {WEST_TUNNEL, EAST_TUNNEL}, failed_trace))
        self.assertGreater(len(failed_trace), 1)
        self.assertNotIn("D", [step.node for step in failed_trace])
        self.assertTrue(any(choice.outcome == "closed" for step in failed_trace for choice in step.neighbors))

    def test_reliable_mode_optimizes_declared_small_graph_model(self) -> None:
        graph, _ = generate_map(DEFAULT_SEED)
        fastest = astar(graph, "A", "D", "12:00")
        reliable = reliable_route(graph, "A", "D", "12:00")
        self.assertNotEqual(fastest.path, reliable.path)
        self.assertLess(reliable.estimated_p90_seconds, estimated_p90_seconds(graph, fastest.path, "12:00"))
        self.assertGreater(reliable.paths_evaluated, 1)

    def test_same_location_and_disconnected_graph(self) -> None:
        graph, _ = generate_map(DEFAULT_SEED)
        result = astar(graph, "A", "A", "12:00")
        self.assertEqual(result.path, ("A",))
        self.assertEqual(result.travel_seconds, 0)
        disconnected = CampusGraph()
        disconnected.add_location("A", 0, 0)
        disconnected.add_location("B", 1, 0)
        self.assertIsNone(astar(disconnected, "A", "B", "12:00"))

    def test_invalid_input_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Departure time"):
            astar(self.graph, "Gate", "Library", "25:00")
        with self.assertRaisesRegex(ValueError, "known locations"):
            astar(self.graph, "Missing", "Library", "12:00")
        with self.assertRaises(ValueError):
            self.graph.add_road("Gate", "Library", 1.0, 100)
        for seed in (-1, 100000, 2.5, "abc"):
            with self.subTest(seed=seed), self.assertRaises(ValueError):
                generate_map(seed)
        for invalid in (float("nan"), float("inf")):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    self.graph.add_road("Gate", "Library", invalid, 200)
                with self.assertRaises(ValueError):
                    self.graph.add_location("Bad", invalid, 0)
        with self.assertRaises(ValueError):
            astar(self.graph, "Gate", "Library", None)

    def test_astar_matches_dijkstra_on_many_unseen_inputs(self) -> None:
        # 43,120 start/goal/time/closure combinations, including period boundaries.
        times = ("06:59", "07:00", "08:30", "09:59", "10:00", "12:00", "15:59", "16:00", "18:59", "19:00", "23:59")
        closure_cases = (set(), {WEST_TUNNEL}, {EAST_TUNNEL}, {WEST_TUNNEL, EAST_TUNNEL})
        checked = 0
        for seed in (0, 1, 7, 17, 42):
            graph, _ = generate_map(seed)
            names = tuple(graph.coordinates)
            for time in times:
                for closures in closure_cases:
                    for start in names:
                        for goal in names:
                            a = astar(graph, start, goal, time, closures)
                            d = dijkstra(graph, start, goal, time, closures)
                            self.assertEqual(a is None, d is None, (seed, time, closures, start, goal))
                            if a is not None:
                                self.assertAlmostEqual(a.travel_seconds, d.travel_seconds, places=7,
                                                       msg=f"{seed} {time} {closures} {start} -> {goal}")
                            checked += 1
        self.assertEqual(checked, 5 * 11 * 4 * 14 * 14)


if __name__ == "__main__":
    unittest.main()
