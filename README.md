# RailRoute Lab

A self-implemented, time-aware A* route finder on a reproducible fictional campus. The browser makes the search decisions visible; the AI core runs entirely in Python and can be demonstrated without the browser.

## Start the demo

Python 3.10+ is sufficient for the core and browser app. Three.js is bundled locally for the 3D view.

```powershell
python app.py
```

Open **http://127.0.0.1:8000**. Choose start, destination, departure time, map seed, and tunnel closures, then select **Run A* search**. The workspace shows exact inputs, a large route map with synchronized shuttle close-up, the A* expansion trace with `g + h = f`, and the Dijkstra comparison. **View source** displays the actual Python search code.

Code-first review examples:

```powershell
python review_demo.py
python review_demo.py --time 08:30
python review_demo.py --close west
python review_demo.py --start "Design Studio" --goal "Birch Residence" --time 09:59 --seed 42
python -m unittest -v
```

The default seed (`17`) makes three different decisions easy to show. `Science Hall` to `North Library` at 12:00 uses the west tunnel. At 08:30, the modeled morning congestion favors the east tunnel. Closing west at 12:00 also forces east. Closing both tunnels disconnects a north/south trip, and the app retains the partial A* trace. Try any listed stops, time, and seed from `0` to `99999`; the chosen seed reproduces the same map.

Optional browser interaction check (Microsoft Edge and Node.js required):

```powershell
npm install
npm run check:browser
```

Keep `python app.py` running in a second terminal. The check covers the default route, trace controls, source view, reliability view, morning reroute, closures, unreachable goal, and alternate seed.

## AI formulation and implementation

**Problem:** Find the open-road shuttle path with minimum modeled in-vehicle travel time for the specified departure time.

| Item | Definition |
| --- | --- |
| State | Current road-graph location and its arrival time |
| Initial state | Chosen start at the requested departure time |
| Action | Traverse one connected, open road |
| Transition | Move to its other endpoint and advance time by its time-dependent traversal cost |
| Goal test | Current location equals the destination |
| Path cost | Sum of road travel seconds |

`routing.py` implements A* with `heapq`, best-known arrival times, parent links, and a recorded expansion trace. At each step it expands the node with the lowest `f = g + h`: `g` is elapsed travel time and `h` is straight-line distance to the goal divided by an assumed maximum shuttle speed of 15 km/h. The graph validates that road lengths cannot be shorter than straight-line distance, free-flow times cannot imply a higher speed, and congestion factors are at least one. Thus `h` is an optimistic, consistent lower bound under this model. Dijkstra runs the same core with `h = 0` and serves as a cost baseline. A* and Dijkstra need not take the same path when multiple routes tie, but must agree on the optimum modeled cost and reachability.

Each road's progress is integrated through any congestion-period boundary it crosses. This avoids an artificial jump in arrival time for a road entered just before 10:00 or 19:00 and retains the FIFO property required by the label-setting search. Morning peak is 07:00–10:00; evening peak is 16:00–19:00. These periods are experiment assumptions.

`sample_map.py` generates 14 nodes and 17 bidirectional roads. The railway divides north and south; only two graph edges represent road tunnels across it. The seed changes locations, road lengths, speed, congestion, and delay spread while retaining this topology. `app.py` provides the local API and detailed road-cost breakdown. `review_demo.py` prints the algorithm trace directly in the terminal. `demo.py` is a tiny hand-checkable example.

The optional reliability experiment in `routing.py` enumerates simple paths on this **small** network and chooses the lowest modeled 90th-percentile ETA. It assumes independent, approximately normal road delays, using generated standard deviations. This is a separate objective, not the A* heuristic or the syllabus algorithm. Enumerating all simple paths does not scale to a large network.

## Evidence and limits

`test_routing.py` checks 43,120 combinations across five seeds, 11 departure times, all 14-by-14 start/goal pairs, and four tunnel states. It verifies A* and Dijkstra have equal reachability and minimum cost. Additional tests cover boundary crossing, invalid inputs, same start/goal, disconnected graphs, and the default route changes.

This is a **fictional test network**. Locations, stop names, distances, directions, traffic multipliers, and uncertainty are generated or modeled. It is not a VIT map, a surveyed road graph, a real shuttle timetable, or a live ETA service. Passenger waiting time, capacity, turns, and other operational constraints are outside the current cost function. The guide [RailRoute_Project_Understanding_and_Viva.pdf](RailRoute_Project_Understanding_and_Viva.pdf) explains the model and likely viva questions.

To regenerate the guide, install ReportLab and run `python make_understanding_pdf.py`. ReportLab is used only to produce the PDF, never for route decisions.

**AI assistance disclosure:** An AI assistant helped draft/refine synthetic data, code, tests, UI, and study material. The route decisions are performed by the local, inspectable Python implementation, without an external AI API. Include this disclosure in the final course report and verify the code as a team.
