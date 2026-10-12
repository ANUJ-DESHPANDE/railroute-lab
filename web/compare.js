const $ = (selector) => document.querySelector(selector);
const svgNS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const input = {
  start: params.get('start') || 'A',
  goal: params.get('goal') || 'D',
  departure: params.get('departure') || '12:00',
  seed: params.get('seed') || '17',
  closed: params.getAll('closed'),
};
let graph, run, frame = 0, timer = null;
const minutes = (seconds) => (seconds / 60).toFixed(1);

function svg(tag, attributes = {}) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function coordinates() {
  const east = graph.locations.map((node) => node.east_km);
  const north = graph.locations.map((node) => node.north_km);
  const minX = Math.min(...east) - 0.08, maxX = Math.max(...east) + 0.08;
  const minY = Math.min(...north) - 0.08, maxY = Math.max(...north) + 0.08;
  // Keep one pixels-per-kilometre scale on both axes so the visual distances
  // remain faithful to the coordinates used by the heuristic.
  const scale = Math.min(516 / (maxX - minX), 352 / (maxY - minY));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const place = new Map(graph.locations.map((node) => [node.name, {
    x: 300 + (node.east_km - centerX) * scale,
    y: 210 + (centerY - node.north_km) * scale,
  }]));
  const railY = 210 + (centerY - 0.1) * scale;
  return {place, railY};
}

function roadKey(start, end) { return [start, end].sort().join('|'); }

function drawMap(selector, trace, result, selected) {
  const host = $(selector);
  host.replaceChildren();
  const {place, railY} = coordinates();
  host.append(svg('line', {class: 'railway', x1: 20, x2: 580, y1: railY, y2: railY}));
  host.append(svg('line', {class: 'rail-tie', x1: 20, x2: 580, y1: railY, y2: railY}));
  const count = Math.min(selected + 1, trace.length);
  const current = trace[count - 1];
  const visited = new Set(trace.slice(0, count).map((entry) => entry.node));
  const checked = new Set((current?.neighbors || []).map((choice) => roadKey(current.node, choice.destination)));
  const closed = new Set(input.closed.map((name) => roadKey(...graph.tunnels[name])));
  for (const road of graph.roads) {
    const a = place.get(road.start), b = place.get(road.end);
    const key = roadKey(road.start, road.end);
    const tunnel = Object.values(graph.tunnels).some(([first, second]) => key === roadKey(first, second));
    host.append(svg('line', {
      class: `road${tunnel ? ' tunnel' : ''}${checked.has(key) && !closed.has(key) ? ' checked' : ''}${closed.has(key) ? ' closed' : ''}`,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    }));
  }
  if (selected >= trace.length - 1 && result?.path) {
    for (let i = 0; i < result.path.length - 1; i++) {
      const a = place.get(result.path[i]), b = place.get(result.path[i + 1]);
      host.append(svg('line', {class: 'road route', x1: a.x, y1: a.y, x2: b.x, y2: b.y}));
    }
  }
  for (const node of graph.locations) {
    const p = place.get(node.name);
    const group = svg('g', {class: `node${visited.has(node.name) ? ' visited' : ''}${current?.node === node.name ? ' current' : ''}${node.name === input.goal ? ' goal' : ''}`, 'data-node': node.name});
    group.append(svg('circle', {cx: p.x, cy: p.y, r: 15}));
    const letter = svg('text', {x: p.x, y: p.y + 1});
    letter.textContent = node.name;
    group.append(letter);
    host.append(group);
  }
}

function renderMethod(name, trace, result) {
  const count = Math.min(frame + 1, trace.length);
  const current = trace[count - 1];
  const done = frame >= trace.length - 1;
  $(`#${name}-count`).textContent = `${count}/${trace.length}`;
  $(`#${name}-current`).textContent = done
    ? result ? `Goal reached after ${count} checks. Best time: ${minutes(result.travel_seconds)} min.` : `No route found after ${count} checks.`
    : name === 'astar'
      ? `Checking ${current.node} · f = ${minutes(current.g_seconds)} + ${minutes(current.h_seconds)} = ${minutes(current.f_seconds)} min`
      : `Checking ${current.node} · g = ${minutes(current.g_seconds)} min (h is always 0)`;
  $(`#${name}-path`).textContent = done && result ? `Chosen route: ${result.path.join(' → ')}` : '';
  drawMap(`#${name}-map`, trace, result, frame);
}

function render() {
  const max = Math.max(run.astar_trace.length, run.dijkstra_trace.length) - 1;
  $('#step').max = String(max);
  $('#step').value = String(frame);
  $('#frame-label').textContent = `Decision ${frame + 1} / ${max + 1}`;
  $('#back').disabled = frame === 0;
  $('#forward').disabled = frame === max;
  renderMethod('astar', run.astar_trace, run.astar);
  renderMethod('dijkstra', run.dijkstra_trace, run.dijkstra);
  const a = run.astar, d = run.dijkstra;
  if ($('#crossing-values').hidden) {
    $('#takeaway-text').textContent = a && d
      ? `Both find ${minutes(a.travel_seconds)} min. A* checks ${a.nodes_expanded} locations; Dijkstra checks ${d.nodes_expanded}. Colored circles show search decisions, not a moving shuttle. At each decision, A* uses g + h; Dijkstra uses g alone.`
      : 'Both methods search the reachable roads. If the goal is cut off, neither can produce a route.';
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  $('#play').textContent = 'Play';
}
function changeTime(time) {
  const next = new URLSearchParams(location.search);
  next.set('start', input.start);
  next.set('goal', input.goal);
  next.set('seed', input.seed);
  next.set('departure', time);
  location.href = `/compare.html?${next}`;
}

async function crossingComparison() {
  if (input.start !== 'A' || input.goal !== 'D' || input.closed.length) return;
  const base = new URLSearchParams({start: 'A', goal: 'D', departure: input.departure, seed: input.seed});
  const onlyWest = new URLSearchParams(base); onlyWest.append('closed', 'east');
  const onlyEast = new URLSearchParams(base); onlyEast.append('closed', 'west');
  const responses = await Promise.all([fetch(`/api/route?${onlyWest}`), fetch(`/api/route?${onlyEast}`)]);
  if (responses.some((response) => !response.ok)) return;
  const [west, east] = await Promise.all(responses.map((response) => response.json()));
  if (!west.astar || !east.astar) return;
  const values = $('#crossing-values');
  values.replaceChildren();
  const options = [
    ['B–C crossing', west.astar],
    ['F–G crossing', east.astar],
  ];
  for (const [label, result] of options) {
    const card = document.createElement('div');
    if (result.travel_seconds === Math.min(west.astar.travel_seconds, east.astar.travel_seconds)) card.className = 'best';
    const heading = document.createElement('strong'); heading.textContent = label;
    const detail = document.createElement('span');
    detail.textContent = `${result.distance_km.toFixed(2)} km · ${minutes(result.travel_seconds)} min`;
    card.append(heading, detail);
    values.append(card);
  }
  values.hidden = false;
  $('#takeaway-title').textContent = 'Why a longer route can win';
  $('#takeaway-text').textContent = input.departure === '08:30'
    ? 'The F–G route covers more distance, yet reaches D sooner. Morning congestion makes the shorter B–C route slower. Both search methods choose by travel time, not by visual straightness.'
    : `At ${input.departure}, compare distance and travel time below. Change to 08:30 to see the longer F–G route win under morning congestion.`;
}

async function load() {
  const routeQuery = new URLSearchParams({start: input.start, goal: input.goal, departure: input.departure, seed: input.seed});
  for (const closure of input.closed) routeQuery.append('closed', closure);
  const responses = await Promise.all([fetch(`/api/graph?seed=${input.seed}`), fetch(`/api/route?${routeQuery}`)]);
  const [graphResponse, runResponse] = responses;
  const [graphData, runData] = await Promise.all(responses.map((response) => response.json()));
  if (!graphResponse.ok || !runResponse.ok) throw new Error(runData.error || graphData.error || 'The comparison could not load.');
  graph = graphData; run = runData;
  $('#trip-label').textContent = `${input.start} → ${input.goal} · ${input.departure} · map seed ${input.seed}${input.closed.length ? ` · closed: ${input.closed.join(', ')}` : ''}`;
  $('#midday').classList.toggle('active', input.departure === '12:00');
  $('#morning').classList.toggle('active', input.departure === '08:30');
  render();
  await crossingComparison();
}

$('#back').addEventListener('click', () => { stop(); frame = Math.max(0, frame - 1); render(); });
$('#forward').addEventListener('click', () => { stop(); frame = Math.min(Number($('#step').max), frame + 1); render(); });
$('#step').addEventListener('input', () => { stop(); frame = Number($('#step').value); render(); });
$('#play').addEventListener('click', () => {
  if (timer) { stop(); return; }
  if (frame >= Number($('#step').max)) frame = 0;
  $('#play').textContent = 'Pause';
  render();
  timer = setInterval(() => {
    if (frame >= Number($('#step').max)) { stop(); return; }
    frame += 1;
    render();
  }, 750);
});
$('#midday').addEventListener('click', () => changeTime('12:00'));
$('#morning').addEventListener('click', () => changeTime('08:30'));
load().catch((error) => { $('#compare-error').hidden = false; $('#compare-error').textContent = error.message; });
