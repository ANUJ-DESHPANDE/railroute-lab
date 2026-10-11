import * as THREE from './vendor/three.module.js';

const $ = (selector) => document.querySelector(selector);
let graph = null;
let routeData = null;
let seedLoaded = null;
let displayedMode = 'fastest';
let currentPath = [];
let currentSteps = [];
let currentTrace = 0;
let animationTime = 0;
let playing = false;
let roadGroup = null;
let routeGroup = null;
let landmarkGroup = null;

const sceneHost = $('#scene');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe5e9e5);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneHost.appendChild(renderer.domElement);
const mapFrame = document.querySelector('.map-frame');
const mapLabels = [];

function setMapLabels() {
  mapLabels.forEach(({element}) => element.remove());
  mapLabels.length = 0;
  if (!graph) return;
  const stops = [
    [$('#start').value, 'START'],
    [$('#goal').value, 'GOAL'],
    ['West Tunnel North', 'WEST TUNNEL'],
    ['East Tunnel North', 'EAST TUNNEL'],
  ];
  for (const [name, role] of stops) {
    const element = document.createElement('div');
    element.className = `map-label ${role === 'START' || role === 'GOAL' ? 'map-label-stop' : ''}`;
    element.innerHTML = `<small>${role}</small><strong></strong>`;
    element.querySelector('strong').textContent = role === 'START' || role === 'GOAL' ? name : '';
    mapFrame.appendChild(element);
    mapLabels.push({element, name});
  }
}

function positionMapLabels() {
  if (!graph) return;
  const width = mapFrame.clientWidth, height = mapFrame.clientHeight;
  for (const {element, name} of mapLabels) {
    const p = point(name, 0.35).project(camera);
    element.style.left = `${(p.x + 1) * width / 2}px`;
    element.style.top = `${(1 - p.y) * height / 2}px`;
    element.hidden = p.z > 1 || p.z < -1 || Math.abs(p.x) > 0.96 || Math.abs(p.y) > 0.90;
  }
}

const target = new THREE.Vector3(0, 0, 0);
let orbitAngle = 0.42;
let orbitElevation = 1.04;
let orbitDistance = 23;
function positionCamera() {
  camera.position.set(
    Math.sin(orbitAngle) * Math.cos(orbitElevation) * orbitDistance,
    Math.sin(orbitElevation) * orbitDistance,
    Math.cos(orbitAngle) * Math.cos(orbitElevation) * orbitDistance,
  );
  camera.lookAt(target);
}
positionCamera();

scene.add(new THREE.AmbientLight(0xffffff, 1.75));
const sun = new THREE.DirectionalLight(0xffffff, 2.25);
sun.position.set(-5, 13, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
scene.add(sun);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(22, 18),
  new THREE.MeshStandardMaterial({color: 0xdbe2df, roughness: 1}),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.18;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(22, 32, 0xc6d1cd, 0xcbd5d0);
grid.position.y = -0.16;
scene.add(grid);

// Rail embankment. Vehicle roads cross it only through the graph's tunnel edges.
const railBed = new THREE.Mesh(
  new THREE.BoxGeometry(18, 0.22, 0.66),
  new THREE.MeshStandardMaterial({color: 0x53616a, roughness: 0.85}),
);
railBed.position.set(0, 0.11, -1.0);
railBed.castShadow = true;
railBed.receiveShadow = true;
scene.add(railBed);
for (const offset of [-0.17, 0.17]) {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.045, 0.034),
    new THREE.MeshStandardMaterial({color: 0x9ba6a6, metalness: 0.65, roughness: 0.38}),
  );
  rail.position.set(0, 0.25, -1.0 + offset);
  scene.add(rail);
}
for (let x = -8.7; x <= 8.7; x += 0.42) {
  const sleeper = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.02, 0.56),
    new THREE.MeshStandardMaterial({color: 0x3d4950}),
  );
  sleeper.position.set(x, 0.24, -1);
  scene.add(sleeper);
}

// A deliberately legible bus, scaled slightly above the road geometry.
const bus = new THREE.Group();
const busBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.72, 0.38, 1.12),
  new THREE.MeshStandardMaterial({color: 0xf2f2e9, metalness: 0.15, roughness: 0.45}),
);
busBody.position.y = 0.31;
busBody.castShadow = true;
bus.add(busBody);
const busRoof = new THREE.Mesh(
  new THREE.BoxGeometry(0.72, 0.12, 0.94),
  new THREE.MeshStandardMaterial({color: 0x29434e, metalness: 0.12, roughness: 0.55}),
);
busRoof.position.set(0, 0.56, -0.03);
busRoof.castShadow = true;
bus.add(busRoof);
const stripe = new THREE.Mesh(
  new THREE.BoxGeometry(0.73, 0.075, 1.02),
  new THREE.MeshStandardMaterial({color: 0xb4805c}),
);
stripe.position.set(0, 0.20, 0);
bus.add(stripe);
for (const side of [-1, 1]) {
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.17, 0.78),
    new THREE.MeshStandardMaterial({color: 0x56717a, metalness: 0.3, roughness: 0.22}),
  );
  windows.position.set(side * 0.367, 0.43, -0.02);
  bus.add(windows);
  for (const z of [-0.22, 0.23]) {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.19, 0.032),
      new THREE.MeshStandardMaterial({color: 0xe5e8e2, roughness: 0.6}),
    );
    pillar.position.set(side * 0.379, 0.43, z);
    bus.add(pillar);
  }
  for (const z of [-0.35, 0.35]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.075, 16),
      new THREE.MeshStandardMaterial({color: 0x263139, roughness: 0.9}),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.38, 0.12, z);
    bus.add(wheel);
  }
}
const windshield = new THREE.Mesh(
  new THREE.BoxGeometry(0.56, 0.18, 0.018),
  new THREE.MeshStandardMaterial({color: 0x395e68, metalness: 0.28, roughness: 0.2}),
);
windshield.position.set(0, 0.44, 0.565);
bus.add(windshield);
for (const x of [-0.25, 0.25]) {
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), new THREE.MeshBasicMaterial({color: 0xffe9b8}));
  lamp.position.set(x, 0.28, 0.575);
  bus.add(lamp);
}
bus.scale.setScalar(1.75);
bus.visible = false;
scene.add(bus);

const focusRing = new THREE.Mesh(
  new THREE.RingGeometry(0.27, 0.35, 32),
  new THREE.MeshBasicMaterial({color: 0x2a5964, side: THREE.DoubleSide, transparent: true, opacity: 0.85}),
);
focusRing.rotation.x = -Math.PI / 2;
focusRing.visible = false;
scene.add(focusRing);

function point(name, height = 0.07) {
  const item = graph.locations.find((location) => location.name === name);
  return new THREE.Vector3(item.east_km * 10 - 7.1, height, -item.north_km * 10);
}
function isTunnel(start, end) {
  return Object.values(graph.tunnels).some(([a, b]) =>
    (start === a && end === b) || (start === b && end === a));
}
function isClosed(start, end) {
  return Object.entries(graph.tunnels).some(([name, [a, b]]) =>
    $('#close-' + name).checked && ((start === a && end === b) || (start === b && end === a)));
}
function roadCurve(start, end, height = 0.09) {
  const a = point(start, height), b = point(end, height);
  if (!isTunnel(start, end)) return new THREE.LineCurve3(a, b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y = -0.27;
  return new THREE.CatmullRomCurve3([a, mid, b]);
}
function makeTube(curve, radius, color, opacity = 1) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 18, radius, 8, false),
    new THREE.MeshStandardMaterial({color, transparent: opacity < 1, opacity, roughness: 0.75}),
  );
}
function buildRoads() {
  if (roadGroup) scene.remove(roadGroup);
  roadGroup = new THREE.Group();
  for (const road of graph.roads) {
    const closed = isClosed(road.start, road.end);
    roadGroup.add(makeTube(
      roadCurve(road.start, road.end),
      isTunnel(road.start, road.end) ? 0.085 : 0.065,
      closed ? 0xbca49c : isTunnel(road.start, road.end) ? 0x5d7883 : 0x879d9e,
      closed ? 0.5 : 1,
    ));
  }
  scene.add(roadGroup);
}
function buildLandmarks() {
  if (landmarkGroup) scene.remove(landmarkGroup);
  landmarkGroup = new THREE.Group();
  graph.locations.forEach((location, index) => {
    const position = point(location.name);
    const junction = location.kind === 'junction';
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(junction ? 0.10 : 0.16, junction ? 0.10 : 0.16, 0.055, 24),
      new THREE.MeshStandardMaterial({color: junction ? 0x6d8588 : 0x3b5963, roughness: 0.8}),
    );
    marker.position.copy(position);
    landmarkGroup.add(marker);
    if (junction) return;
    const residence = location.name.includes('Residence');
    const width = 0.48 + (index % 3) * 0.10;
    const depth = 0.43 + (index % 2) * 0.10;
    const height = 0.42 + (index % 4) * 0.13;
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({color: residence ? 0x9caeaa : 0xaab9b6, roughness: 0.86}),
    );
    building.position.set(position.x + 0.38, height / 2 - 0.12, position.z + 0.34);
    building.castShadow = true;
    building.receiveShadow = true;
    landmarkGroup.add(building);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.035, 0.025, depth + 0.035),
      new THREE.MeshStandardMaterial({color: residence ? 0x536b6f : 0x667d80}),
    );
    roof.position.set(building.position.x, building.position.y + height / 2 + 0.014, building.position.z);
    landmarkGroup.add(roof);
  });
  scene.add(landmarkGroup);
}
function drawRoute(path) {
  if (routeGroup) scene.remove(routeGroup);
  routeGroup = new THREE.Group();
  for (let i = 0; i < path.length - 1; i++) {
    const curve = roadCurve(path[i], path[i + 1], 0.16);
    routeGroup.add(makeTube(curve, 0.15, 0xb4805c, 0.18));
    routeGroup.add(makeTube(curve, 0.077, 0xaa704d));
  }
  scene.add(routeGroup);
  currentPath = path;
  bus.visible = path.length > 0;
  animationTime = 0;
  playing = path.length > 1;
  placeBus(0);
}
function placeBus(progress) {
  if (!currentPath.length) return;
  if (currentPath.length === 1) {
    bus.position.copy(point(currentPath[0], 0.23));
    $('#playback-label').textContent = `At ${currentPath[0]}`;
    return;
  }
  const total = currentSteps.reduce((sum, step) => sum + step.seconds, 0) || 1;
  let remaining = progress * total;
  let index = currentSteps.length - 1;
  let fraction = 1;
  for (let i = 0; i < currentSteps.length; i++) {
    if (remaining <= currentSteps[i].seconds) {
      index = i;
      fraction = remaining / currentSteps[i].seconds;
      break;
    }
    remaining -= currentSteps[i].seconds;
  }
  const curve = roadCurve(currentPath[index], currentPath[index + 1], 0.17);
  const p = curve.getPoint(Math.min(1, Math.max(0, fraction)));
  const tangent = curve.getTangent(Math.min(0.999, Math.max(0.001, fraction)));
  bus.position.copy(p);
  bus.position.y += 0.06;
  bus.rotation.y = Math.atan2(tangent.x, tangent.z);
  $('#playback-label').textContent = `${currentPath[index]} → ${currentPath[index + 1]}`;
  $('#progress-fill').style.width = `${Math.round(progress * 100)}%`;
  $('#playback-time').textContent = `${Math.round(progress * 100)}%`;
}
function resize() {
  const width = sceneHost.clientWidth, height = sceneHost.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(sceneHost);
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true; lastX = event.clientX; lastY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  orbitAngle -= (event.clientX - lastX) * 0.006;
  orbitElevation = Math.max(0.30, Math.min(1.48, orbitElevation + (event.clientY - lastY) * 0.005));
  lastX = event.clientX; lastY = event.clientY;
  positionCamera();
});
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  orbitDistance = Math.max(15, Math.min(39, orbitDistance + event.deltaY * 0.015));
  positionCamera();
}, {passive: false});
const timer = new THREE.Clock();
function render() {
  requestAnimationFrame(render);
  const delta = Math.min(timer.getDelta(), 0.05);
  if (playing) {
    animationTime += delta;
    placeBus(Math.min(animationTime / 10, 1));
    if (animationTime >= 10) playing = false;
  }
  renderer.render(scene, camera);
  positionMapLabels();
}
render();

const minutes = (seconds) => (seconds / 60).toFixed(1);
function showError(message) {
  $('#error').hidden = !message;
  $('#error').textContent = message || '';
}
function populateStops(preserve = true) {
  const formerStart = preserve ? $('#start').value : '';
  const formerGoal = preserve ? $('#goal').value : '';
  const stops = graph.locations.filter((item) => item.kind === 'stop');
  for (const select of [$('#start'), $('#goal')]) {
    select.replaceChildren();
    for (const stop of stops) {
      const option = document.createElement('option');
      option.value = stop.name; option.textContent = stop.name;
      select.appendChild(option);
    }
  }
  $('#start').value = stops.some((item) => item.name === formerStart) ? formerStart : 'Science Hall';
  $('#goal').value = stops.some((item) => item.name === formerGoal) ? formerGoal : 'North Library';
}
async function loadMap(seed, preserve = true) {
  const response = await fetch(`/api/graph?seed=${seed}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Map could not be generated');
  graph = data;
  seedLoaded = seed;
  populateStops(preserve);
  buildLandmarks();
  buildRoads();
  setMapLabels();
  resize();
}
function selectTrace(index) {
  const entries = routeData?.astar_trace || [];
  if (!entries.length) return;
  currentTrace = Math.max(0, Math.min(entries.length - 1, index));
  const item = entries[currentTrace];
  $('#step-count').textContent = `${currentTrace + 1} OF ${entries.length}`;
  $('#step-node').textContent = item.node;
  $('#step-g').textContent = `${minutes(item.g_seconds)} min`;
  $('#step-h').textContent = `${minutes(item.h_seconds)} min`;
  $('#step-f').textContent = `${minutes(item.f_seconds)} min`;
  const here = graph.locations.find((location) => location.name === item.node);
  const goal = graph.locations.find((location) => location.name === routeData.input.goal);
  const straightKm = Math.hypot(here.east_km - goal.east_km, here.north_km - goal.north_km);
  $('#heuristic-working').textContent = `${straightKm.toFixed(2)} km ÷ ${graph.max_speed_kmh} km/h = ${minutes(item.h_seconds)} min`;
  const choices = item.neighbors || [];
  const queued = choices.filter((choice) => choice.outcome === 'queued').length;
  const closed = choices.filter((choice) => choice.outcome === 'closed').length;
  $('#decision-text').textContent = item.node === routeData.input.goal
    ? 'The goal was removed from the queue. Follow saved parent links backward to reconstruct the minimum-cost path.'
    : !routeData.astar && currentTrace === entries.length - 1
      ? 'After checking these roads, the queue emptied before the goal was reached. No connected route exists.'
      : `A* removed ${item.node}, the lowest-f waiting location. ${queued} road${queued === 1 ? '' : 's'} gave a better arrival${closed ? `; ${closed} closed road${closed === 1 ? ' was' : 's were'} ignored` : ''}.`;
  $('#neighbor-summary').textContent = item.node === routeData.input.goal
    ? 'Goal reached; search stops'
    : `${queued} added to queue · ${choices.length - queued} skipped`;
  $('#neighbor-list').replaceChildren();
  if (!choices.length) {
    const empty = document.createElement('p');
    empty.className = 'neighbor-empty';
    empty.textContent = item.node === routeData.input.goal ? 'No more roads need checking.' : 'No outgoing roads.';
    $('#neighbor-list').appendChild(empty);
  }
  for (const choice of choices) {
    const row = document.createElement('div'); row.className = `neighbor-row outcome-${choice.outcome}`;
    const name = document.createElement('strong'); name.textContent = choice.destination;
    const edge = document.createElement('span'); edge.textContent = choice.road_seconds == null ? '—' : `${minutes(choice.road_seconds)} min`;
    const score = document.createElement('span');
    score.textContent = choice.candidate_f_seconds == null ? '—' : `${minutes(choice.candidate_f_seconds)} min`;
    if (choice.candidate_f_seconds != null) score.title = `g ${minutes(choice.candidate_g_seconds)} + h ${minutes(choice.candidate_h_seconds)}`;
    const outcome = document.createElement('b');
    outcome.textContent = ({queued: 'Added', closed: 'Closed', settled: 'Settled', not_better: 'No gain'})[choice.outcome] || choice.outcome;
    row.append(name, edge, score, outcome);
    $('#neighbor-list').appendChild(row);
  }
  const pending = item.frontier_after || [];
  $('#frontier-list').replaceChildren();
  $('#frontier-next').textContent = pending.length ? `${pending.length} waiting · lowest f next` : 'Queue empty';
  if (!pending.length) {
    const empty = document.createElement('p'); empty.className = 'frontier-empty';
    empty.textContent = item.node === routeData.input.goal ? 'Goal reached. Search complete.' : 'No other location is waiting.';
    $('#frontier-list').appendChild(empty);
  }
  pending.forEach((candidate, rank) => {
    const row = document.createElement('div'); row.className = `frontier-row ${rank === 0 ? 'next' : ''}`;
    const order = document.createElement('b'); order.textContent = rank === 0 ? 'NEXT' : `#${rank + 1}`;
    const name = document.createElement('span'); name.textContent = candidate.node;
    const arithmetic = document.createElement('small'); arithmetic.textContent = `${minutes(candidate.g_seconds)} + ${minutes(candidate.h_seconds)}`;
    const score = document.createElement('strong'); score.textContent = `${minutes(candidate.f_seconds)} min`;
    row.append(order, name, arithmetic, score);
    $('#frontier-list').appendChild(row);
  });
  document.querySelectorAll('#trace-list button').forEach((button, i) => button.classList.toggle('active', i === currentTrace));
  focusRing.position.copy(point(item.node, 0.15));
  focusRing.visible = true;
}
function updateAlgorithm() {
  const entries = routeData?.astar_trace || [];
  $('#trace-list').replaceChildren();
  if (!entries.length) {
    $('#step-count').textContent = '—';
    $('#step-node').textContent = 'No nodes explored';
    for (const id of ['#step-g', '#step-h', '#step-f']) $(id).textContent = '—';
    $('#decision-text').textContent = 'Change the inputs and run the search again.';
    $('#neighbor-summary').textContent = 'No roads checked';
    $('#neighbor-list').replaceChildren();
    $('#frontier-list').replaceChildren();
    $('#frontier-next').textContent = 'No queue';
    $('#heuristic-working').textContent = 'straight-line distance ÷ 15 km/h';
    focusRing.visible = false;
    return;
  }
  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    const number = document.createElement('b'); number.textContent = `#${index + 1}`;
    const name = document.createElement('small'); name.textContent = entry.node;
    const score = document.createElement('span'); score.textContent = `f ${minutes(entry.f_seconds)}`;
    button.append(number, name, score);
    button.title = `${entry.node}: g ${minutes(entry.g_seconds)} + h ${minutes(entry.h_seconds)} = f ${minutes(entry.f_seconds)} min`;
    button.addEventListener('click', () => selectTrace(index));
    $('#trace-list').appendChild(button);
  });
  selectTrace(0);
}
function showPath(mode) {
  if (!routeData) return;
  displayedMode = mode;
  const result = mode === 'reliable' ? routeData.reliable : routeData.astar;
  currentSteps = mode === 'reliable' ? routeData.reliable_steps : routeData.steps;
  drawRoute(result?.path || []);
  $('#show-reliable').textContent = mode === 'reliable' ? 'Return to fastest route on map' : 'Show reliability route on map';
}
function updateResults() {
  const a = routeData.astar, d = routeData.dijkstra, r = routeData.reliable;
  if (!a) {
    showError('No route exists with these tunnel closures. Reopen a crossing or choose stops on the same side of the railway.');
    $('#eta').textContent = '—';
    $('#verified').textContent = 'No reachable route';
    $('#verified').classList.add('failed');
    $('#route-path').textContent = 'The graph has no open connection between these locations.';
    $('#route-reason').textContent = 'A* exhausted every reachable road without reaching the destination.';
    for (const id of ['#astar-time', '#dijkstra-time']) $(id).textContent = '—';
    $('#astar-nodes').textContent = routeData.astar_trace.length;
    $('#dijkstra-nodes').textContent = routeData.dijkstra_trace.length;
    $('#comparison-insight').textContent = 'Both methods explored the reachable part of the network and found no path.';
    $('#legs').replaceChildren();
    $('#reliable-values').textContent = 'No candidate route is available.';
    showPath('fastest');
    $('#playback-label').textContent = 'No shuttle route';
    $('#progress-fill').style.width = '0%';
    $('#playback-time').textContent = '0%';
    return;
  }
  showError('');
  $('#eta').textContent = minutes(a.travel_seconds);
  $('#verified').textContent = routeData.verified_optimum ? '✓ A* and Dijkstra agree on the optimum' : 'Search mismatch: inspect the core';
  $('#verified').classList.toggle('failed', !routeData.verified_optimum);
  $('#route-path').textContent = a.path.join('  →  ');
  const tunnel = a.path.includes('West Tunnel South') ? 'west tunnel' : a.path.includes('East Tunnel South') ? 'east tunnel' : null;
  $('#route-reason').textContent = tunnel
    ? `Uses the ${tunnel}. Its ${routeData.steps.length} road times add to ${minutes(a.travel_seconds)} minutes.`
    : `This trip stays on one side of the railway. ${routeData.steps.length} road times add to ${minutes(a.travel_seconds)} minutes.`;
  $('#astar-time').textContent = `${minutes(a.travel_seconds)} min`;
  $('#astar-nodes').textContent = a.nodes_expanded;
  $('#dijkstra-time').textContent = `${minutes(d.travel_seconds)} min`;
  $('#dijkstra-nodes').textContent = d.nodes_expanded;
  const saved = d.nodes_expanded - a.nodes_expanded;
  $('#comparison-insight').textContent = saved > 0
    ? `Both found the same best time. A* expanded ${saved} fewer location${saved === 1 ? '' : 's'} because h guided the queue.`
    : saved === 0
      ? 'Both found the same best time and expanded the same number of locations for this input.'
      : `Both found the same best time. Here A* expanded ${-saved} more location${saved === -1 ? '' : 's'}; the heuristic did not help on this input.`;
  $('#legs').replaceChildren();
  for (const step of routeData.steps) {
    const row = document.createElement('div'); row.className = 'leg';
    const name = document.createElement('strong'); name.textContent = `${step.start} → ${step.end}`;
    const detail = document.createElement('small');
    detail.textContent = `entered ${step.entry_time} · free flow ${minutes(step.free_flow_seconds)} min · effective ×${step.effective_multiplier.toFixed(2)}`;
    const cost = document.createElement('b'); cost.textContent = `${minutes(step.seconds)} min`;
    row.append(name, detail, cost); $('#legs').appendChild(row);
  }
  $('#reliable-values').textContent = r
    ? `Fastest path: ${minutes(routeData.fastest_p90_seconds)} min estimated P90. Reliability path: ${minutes(r.expected_seconds)} min usual time, ${minutes(r.estimated_p90_seconds)} min estimated P90. ${r.paths_evaluated} simple paths evaluated.`
    : 'No candidate route is available.';
  showPath('fastest');
}
async function calculate() {
  const seed = Number($('#seed').value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 99999) {
    showError('Map seed must be a whole number from 0 to 99999.');
    return;
  }
  try {
    if (seed !== seedLoaded) await loadMap(seed);
    const query = new URLSearchParams({
      start: $('#start').value,
      goal: $('#goal').value,
      departure: $('#departure').value,
      seed: String(seed),
    });
    if ($('#close-west').checked) query.append('closed', 'west');
    if ($('#close-east').checked) query.append('closed', 'east');
    const response = await fetch(`/api/route?${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The search could not run');
    routeData = data;
    buildRoads();
    setMapLabels();
    updateAlgorithm();
    updateResults();
  } catch (error) { showError(error.message); }
}

$('#route-form').addEventListener('submit', (event) => { event.preventDefault(); calculate(); });
$('#randomize').addEventListener('click', () => { $('#seed').value = String(Math.floor(Math.random() * 100000)); calculate(); });
$('#previous-step').addEventListener('click', () => selectTrace(currentTrace - 1));
$('#next-step').addEventListener('click', () => selectTrace(currentTrace + 1));
$('#show-reliable').addEventListener('click', () => showPath(displayedMode === 'reliable' ? 'fastest' : 'reliable'));
$('#replay').addEventListener('click', () => { animationTime = 0; playing = currentPath.length > 1; placeBus(0); });
$('#view-source').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/source');
    if (!response.ok) throw new Error('Source code could not be loaded');
    $('#source-code').textContent = await response.text();
    $('#source-modal').showModal();
    const source = $('#source-code');
    source.scrollTop = Math.max(0, source.textContent.indexOf('def _search(') / source.textContent.length * source.scrollHeight - 70);
  } catch (error) { showError(error.message); }
});
$('#close-source').addEventListener('click', () => $('#source-modal').close());

try {
  await loadMap(Number($('#seed').value), false);
  await calculate();
} catch (error) { showError(error.message); }
