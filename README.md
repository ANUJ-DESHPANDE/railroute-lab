# VIT Shuttle Lab

An interactive, campus-inspired shuttle routing simulator with a Python AI core
and a local 3D browser view. **Python 3.10+ is enough to run it.** The Three.js
files required by the browser are bundled under `web/vendor`, so the map does
not need an internet connection. The optional Google font does.

## Run the demo

From this folder:

```powershell
python app.py
```

Open **http://127.0.0.1:8000**. Select two stops, a departure time, and
optional tunnel closures. Press **Calculate Route**. Switch between Fastest
and Reliable to see whether the recommended path changes. Drag the 3D map to
orbit it, scroll to zoom, and click Replay Shuttle to watch the route.

For a code-first demonstration without the visualizer:

```powershell
python review_demo.py --start "Technology Tower" --goal "Hostel Q Block" --time 12:00
python review_demo.py --start "Technology Tower" --goal "Hostel Q Block" --time 08:30
python review_demo.py --start "Technology Tower" --goal "Hostel Q Block" --time 12:00 --close west
python -m unittest -v
```

Optional browser interaction check (requires Microsoft Edge and Node.js):

```powershell
npm install
npm run check:browser
```

Keep `python app.py` running in another terminal for this check.

The first two runs can take different tunnels because the road costs change
with time. Closing the west tunnel forces another route. The program prints
the search trace and verifies A* against Dijkstra for each run.

## How the AI core works

`routing.py` contains our own priority-queue search implementation. The campus
is a graph: intersections and candidate shuttle stops are nodes; roads are
edges. For each road, free-flow time is multiplied by a congestion factor.
The road traversal model integrates progress as the period changes, so entering
an edge at 09:59 can finish after the 10:00 peak ends.

A* prioritizes the smallest **f = g + h**, where `g` is elapsed travel time
and `h` is the straight-line distance to the goal divided by the assumed
15 km/h maximum shuttle speed. Dijkstra uses the same search with `h = 0`.
Road lengths and free-flow times are validated so `h` cannot overestimate;
congestion factors must be at least 1. The browser and CLI show expansion
order and `g`, `h`, `f` values. Both algorithms must return the same fastest
ETA under the same scenario.

For the optional Reliable objective, `reliable_route` enumerates simple paths
in this **small** network and chooses the lowest estimated 90th-percentile ETA.
It assumes independent, approximately normal road-delay variation around the
deterministic ETA. The road uncertainty values are hypothetical. The method
is exact for its declared simple-path model here, but enumeration grows
exponentially; a larger map would need a different candidate-route search.

## Data honesty and limits

The VIT Vellore landmark names and the railway split come from the user's
annotated screenshots and VIT's [campus layout](https://vit.ac.in/files/sustainability-initiatives/Green-Audit-Report.pdf).
VIT's [campus guide](https://blogs.vit.ac.in/vit-vellore-campus-facilities-a-students-complete-guide/)
also identifies major academic and hostel landmarks. **Stop choices, exact
positions, road links, directions, crossing permissions, travel times,
congestion, and uncertainty are schematic assumptions**, not live or surveyed
campus data. Edit `vit_demo.py` after field verification.

The graph treats the two modeled underpasses as the only railway crossings.
Roads currently allow travel in both directions; `CampusGraph.add_road` can
represent one-way roads, but no one-way restriction is claimed without
verification. The model excludes shuttle schedules, passenger wait time,
capacity, turns, and live traffic. Its period boundaries are 07:00–10:00 and
16:00–19:00, chosen for the experiment.

The basic five-node graph in `demo.py` remains as a minimal algorithm example.
