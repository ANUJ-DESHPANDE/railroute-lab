import * as THREE from './vendor/three.module.js';

const $ = (selector) => document.querySelector(selector);
// Short, stable display IDs make the search trace and the map easy to match.
// The Python graph continues to use full location names as its node keys.
const NODE_ORDER = [
  'Science Hall', 'West Tunnel South', 'West Tunnel North', 'North Library',
  'East Lecture Hall', 'East Tunnel South', 'East Tunnel North', 'Birch Residence',
  'Design Studio', 'West Entrance', 'Innovation Lab', 'Admin Center',
  'Maple Residence', 'Cedar Residence',
];
const NODE_IDS = new Map(NODE_ORDER.map((name, index) => [name, String.fromCharCode(65 + index)]));
const nodeId = (name) => NODE_IDS.get(name) || '?';
const nodeLabel = (name) => `${nodeId(name)} · ${name}`;
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
let searchGroup = null;
let edgeLabels = [];
let viewMode = 'search';
let walkthroughTimer = null;

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
  for (const {name} of graph.locations) {
    const element = document.createElement('div');
    element.className = 'map-label map-node-label';
    const letter = document.createElement('b'); letter.textContent = nodeId(name);
    const label = document.createElement('span'); label.textContent = name;
    const role = document.createElement('small');
    element.append(letter, label, role);
    mapFrame.appendChild(element);
    mapLabels.push({element, name});
  }
  refreshMapRoles();
}
function refreshMapRoles() {
  const start = routeData?.input.start || $('#start').value;
  const goal = routeData?.input.goal || $('#goal').value;
  const now = viewMode === 'search' ? routeData?.astar_trace?.[currentTrace]?.node : null;
  for (const {element, name} of mapLabels) {
    element.classList.toggle('is-start', name === start);
    element.classList.toggle('is-goal', name === goal);
    element.classList.toggle('is-current', name === now);
    element.querySelector('small').textContent = name === now ? 'NOW' : name === start ? 'START' : name === goal ? 'GOAL' : '';
  }
}

function positionMapLabels() {
  if (!graph) return;
  const width = mapFrame.clientWidth, height = mapFrame.clientHeight;
  const entries = mapLabels.map(({element, name}) => {
    const p = point(name, 0.25).project(camera);
    return {element, name, p, x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2};
  }).sort((a, b) =>
    Number(b.element.classList.contains('is-current')) - Number(a.element.classList.contains('is-current')) ||
    Number(b.element.classList.contains('is-goal')) - Number(a.element.classList.contains('is-goal')) ||
    Number(b.element.classList.contains('is-start')) - Number(a.element.classList.contains('is-start')));
  const placed = [];
  for (const {element, p, x, y} of entries) {
    if (p.z > 1 || p.z < -1 || x < 0 || x > width || y < 0 || y > height) {
      element.hidden = true;
      continue;
    }
    const w = element.offsetWidth || 95, h = element.offsetHeight || 22;
    const candidates = [
      [x + 8, y - h - 6], [x - w - 8, y - h - 6],
      [x + 8, y + 5], [x - w - 8, y + 5],
      [x - w / 2, y - h - 11], [x - w / 2, y + 9],
    ];
    let chosen = candidates.find(([left, top]) =>
      left >= 4 && left + w <= width - 4 && top >= 39 && top + h <= height - 31 &&
      placed.every(([px, py, pw, ph]) => left > px + pw + 2 || left + w + 2 < px || top > py + ph + 2 || top + h + 2 < py));
    if (!chosen) chosen = [Math.max(4, Math.min(width - w - 4, x + 7)), Math.max(39, Math.min(height - h - 31, y - h - 5))];
    element.style.left = `${chosen[0]}px`;
    element.style.top = `${chosen[1]}px`;
    element.hidden = false;
    placed.push([chosen[0], chosen[1], w, h]);
  }
  for (const {element, position} of edgeLabels) {
    const p = position.clone().project(camera);
    element.style.left = `${(p.x + 1) * width / 2}px`;
    element.style.top = `${(1 - p.y) * height / 2}px`;
    element.hidden = p.z > 1 || p.z < -1 || Math.abs(p.x) > 0.94 || Math.abs(p.y) > 0.83;
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
    (routeData?.input.closed.includes(name) ?? $('#close-' + name).checked) && ((start === a && end === b) || (start === b && end === a)));
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
function clearEdgeLabels() {
  edgeLabels.forEach(({element}) => element.remove());
  edgeLabels = [];
}
function addEdgeLabel(start, end, label, kind, height = 0.22) {
  const element = document.createElement('div');
  element.className = `edge-cost edge-cost-${kind}`;
  element.textContent = label;
  mapFrame.appendChild(element);
  edgeLabels.push({element, position: roadCurve(start, end, height).getPoint(0.54)});
}
function clearSearchHighlights() {
  if (searchGroup) scene.remove(searchGroup);
  searchGroup = null;
  clearEdgeLabels();
}
function drawSearchStep(item) {
  clearSearchHighlights();
  searchGroup = new THREE.Group();
  for (const choice of item.neighbors || []) {
    const kind = choice.outcome;
    const color = kind === 'queued' ? 0x167f7c : kind === 'closed' ? 0xb8684f : 0x98a5a2;
    const curve = roadCurve(item.node, choice.destination, 0.19);
    searchGroup.add(makeTube(curve, kind === 'queued' ? 0.11 : 0.07, color, kind === 'queued' ? 1 : 0.8));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), new THREE.MeshBasicMaterial({color}));
    dot.position.copy(point(choice.destination, 0.23));
    searchGroup.add(dot);
    const label = kind === 'closed' ? 'CLOSED' : choice.road_seconds == null ? kind : `+${minutes(choice.road_seconds)} min`;
    addEdgeLabel(item.node, choice.destination, label, kind);
  }
  scene.add(searchGroup);
  focusRing.position.copy(point(item.node, 0.15));
  focusRing.scale.setScalar(1.45);
  focusRing.visible = true;
  routeGroup.visible = false;
  bus.visible = false;
  playing = false;
  $('#map-stage').textContent = `SEARCH ${currentTrace + 1}/${routeData.astar_trace.length} · Checking roads from ${nodeLabel(item.node)}`;
  refreshMapRoles();
  $('#legend-highlight').classList.add('is-search');
  $('#legend-label').textContent = 'Road checked now';
  $('#playback-label').textContent = 'Search explores possible roads';
  $('#progress-fill').style.width = `${Math.round((currentTrace + 1) / routeData.astar_trace.length * 100)}%`;
  $('#playback-time').textContent = `${currentTrace + 1}/${routeData.astar_trace.length}`;
}
function showFinalRoute(autoplay = true) {
  if (!routeData?.astar) return;
  if (currentTrace !== routeData.astar_trace.length - 1) selectTrace(routeData.astar_trace.length - 1, true);
  stopWalkthrough();
  viewMode = 'route';
  clearSearchHighlights();
  focusRing.visible = false;
  routeGroup.visible = true;
  bus.visible = currentPath.length > 0;
  $('#walkthrough-state').textContent = 'FINAL ROUTE';
  $('#map-stage').textContent = `${displayedMode === 'reliable' ? 'RELIABILITY ROUTE' : 'FINAL FASTEST ROUTE'} · ${nodeLabel(routeData.input.start)} → ${nodeLabel(routeData.input.goal)}`;
  refreshMapRoles();
  $('#legend-highlight').classList.remove('is-search');
  $('#legend-label').textContent = 'Chosen route';
  for (const step of currentSteps) addEdgeLabel(step.start, step.end, `${minutes(step.seconds)} min`, 'route', 0.25);
  if (autoplay) {
    animationTime = 0;
    playing = currentPath.length > 1;
    placeBus(0);
  } else {
    playing = false;
    placeBus(1);
  }
  $('#previous-step').disabled = false;
  $('#next-step').disabled = true;
  $('#next-step').textContent = 'Route shown';
}
function stopWalkthrough() {
  if (walkthroughTimer) clearInterval(walkthroughTimer);
  walkthroughTimer = null;
  $('#play-search').textContent = 'Play search → shuttle';
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
      option.value = stop.name; option.textContent = nodeLabel(stop.name);
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
function selectTrace(index, fromPlayback = false) {
  const entries = routeData?.astar_trace || [];
  if (!entries.length) return;
  if (!fromPlayback) stopWalkthrough();
  viewMode = 'search';
  currentTrace = Math.max(0, Math.min(entries.length - 1, index));
  const item = entries[currentTrace];
  $('#walkthrough-state').textContent = 'SEARCH IN PROGRESS';
  $('#step-count').textContent = `${currentTrace + 1} OF ${entries.length}`;
  $('#step-node').textContent = nodeLabel(item.node);
  $('#step-g').textContent = `${minutes(item.g_seconds)} min`;
  $('#step-h').textContent = `${minutes(item.h_seconds)} min`;
  $('#step-f').textContent = `${minutes(item.f_seconds)} min`;
  const here = graph.locations.find((location) => location.name === item.node);
  const goal = graph.locations.find((location) => location.name === routeData.input.goal);
  const straightKm = Math.hypot(here.east_km - goal.east_km, here.north_km - goal.north_km);
  $('#heuristic-working').textContent = `${straightKm.toFixed(2)} km ÷ ${graph.max_speed_kmh} km/h = ${minutes(item.h_seconds)} min`;
  $('#heuristic-explanation').textContent = item.node === routeData.input.goal
    ? ' The estimate is zero at the destination.'
    : ' Straight-line time is safe: actual roads cannot be shorter or faster.';
  const choices = item.neighbors || [];
  const queued = choices.filter((choice) => choice.outcome === 'queued').length;
  const closed = choices.filter((choice) => choice.outcome === 'closed').length;
  $('#roads-from').textContent = nodeLabel(item.node).toUpperCase();
  $('#candidate-explanation').textContent = item.node === routeData.input.goal
    ? 'The goal was picked from the queue. No further roads need checking.'
    : `The h above belongs to ${item.node}. Each destination below gets its own h to ${routeData.input.goal}; new g includes this road, and f = g + h.`;
  $('#decision-text').textContent = item.node === routeData.input.goal
    ? `${routeData.input.goal} is the goal. It now has the lowest f, so A* stops and follows saved parent links to recover the route.`
    : !routeData.astar && currentTrace === entries.length - 1
      ? `A* chose ${item.node}; after checking its roads, nothing remained in the queue. The goal cannot be reached.`
      : currentTrace === 0
        ? `Start at ${item.node}. Check its ${choices.length} outgoing roads and place useful destinations in the waiting queue.`
        : `Among the waiting locations, ${item.node} had the lowest f (${minutes(item.f_seconds)} min). A* checks its outgoing roads now.`;
  $('#neighbor-summary').textContent = item.node === routeData.input.goal
    ? 'Search complete'
    : `${choices.length} connected road${choices.length === 1 ? '' : 's'}`;
  $('#neighbor-list').replaceChildren();
  if (!choices.length) {
    const empty = document.createElement('div');
    empty.className = 'neighbor-empty candidate-empty';
    empty.textContent = item.node === routeData.input.goal ? 'No more roads need checking.' : 'No outgoing roads.';
    $('#neighbor-list').appendChild(empty);
  }
  const orderedChoices = [...choices].sort((a, b) =>
    (a.candidate_f_seconds ?? Infinity) - (b.candidate_f_seconds ?? Infinity));
  for (const choice of orderedChoices) {
    const row = document.createElement('div'); row.className = `neighbor-row candidate-card outcome-${choice.outcome}`;
    const head = document.createElement('div'); head.className = 'candidate-head';
    const name = document.createElement('strong'); name.textContent = `→ ${nodeLabel(choice.destination)}`;
    const outcome = document.createElement('b');
    outcome.textContent = ({queued: 'Add to queue', closed: 'Closed', settled: 'Already checked', not_better: 'No improvement'})[choice.outcome] || choice.outcome;
    head.append(name, outcome);
    const edge = document.createElement('p'); edge.className = 'candidate-road';
    edge.textContent = choice.road_seconds == null
      ? 'This road is closed.'
      : `Road travel time: +${minutes(choice.road_seconds)} min`;
    row.append(head, edge);
    if (choice.candidate_f_seconds != null) {
      const math = document.createElement('div'); math.className = 'candidate-math';
      const destination = graph.locations.find((location) => location.name === choice.destination);
      const km = Math.hypot(destination.east_km - goal.east_km, destination.north_km - goal.north_km);
      const metrics = [
        ['g so far', minutes(choice.candidate_g_seconds), `${minutes(item.g_seconds)} + ${minutes(choice.road_seconds)}`],
        ['h to goal', minutes(choice.candidate_h_seconds), `${km.toFixed(2)} km ÷ 15 km/h`],
        ['f priority', minutes(choice.candidate_f_seconds), `${minutes(choice.candidate_g_seconds)} + ${minutes(choice.candidate_h_seconds)}`],
      ];
      for (const [label, value, calculation] of metrics) {
        const metric = document.createElement('div'); metric.className = `candidate-metric ${label === 'f priority' ? 'candidate-total' : ''}`;
        const title = document.createElement('span'); title.textContent = label;
        const number = document.createElement('strong'); number.textContent = `${value} min`;
        const work = document.createElement('small'); work.textContent = calculation;
        metric.append(title, number, work);
        math.appendChild(metric);
      }
      row.appendChild(math);
    }
    const reason = document.createElement('p'); reason.className = 'candidate-reason';
    reason.textContent = choice.outcome === 'queued'
      ? 'Better arrival → added to queue.'
      : choice.outcome === 'closed' ? 'No scores are calculated for a blocked road.'
        : choice.outcome === 'settled' ? 'Already fully explored.'
          : 'A faster arrival is already known.';
    row.appendChild(reason);
    $('#neighbor-list').appendChild(row);
  }
  const pending = item.frontier_after || [];
  $('#frontier-list').replaceChildren();
  $('#frontier-list').title = '';
  $('#frontier-next').textContent = pending.length ? `${pending.length} waiting` : 'Queue empty';
  $('#next-reason').textContent = item.node === routeData.input.goal
    ? `The goal was selected. A* is done; its saved parent links give the ${minutes(routeData.astar.travel_seconds)} minute route.`
    : pending.length
      ? `Next: ${nodeLabel(pending[0].node)}. Its f = ${minutes(pending[0].f_seconds)} min is the smallest among all ${pending.length} waiting location${pending.length === 1 ? '' : 's'}.`
      : 'Nothing is left waiting, so A* cannot reach the destination from this start.';
  if (!pending.length) {
    $('#frontier-list').textContent = item.node === routeData.input.goal
      ? 'The chosen path appears in Route evidence.'
      : 'The search has exhausted the reachable part of the map.';
  } else {
    const other = pending.slice(1);
    const displayed = other.slice(0, 3).map((candidate) => `${nodeLabel(candidate.node)} (f ${minutes(candidate.f_seconds)})`);
    $('#frontier-list').textContent = other.length
      ? `Still waiting: ${displayed.join(', ')}${other.length > 3 ? `, and ${other.length - 3} more` : ''}.`
      : 'No other locations are waiting.';
    $('#frontier-list').title = other.map((candidate) =>
      `${candidate.node}: g ${minutes(candidate.g_seconds)} + h ${minutes(candidate.h_seconds)} = f ${minutes(candidate.f_seconds)}`).join('\n');
  }
  document.querySelectorAll('#trace-list button').forEach((button, i) => button.classList.toggle('active', i === currentTrace));
  $('#previous-step').disabled = currentTrace === 0;
  $('#next-step').disabled = currentTrace === entries.length - 1 && !routeData.astar;
  $('#next-step').textContent = currentTrace === entries.length - 1 ? 'Show route →' : 'Next →';
  drawSearchStep(item);
}
function updateAlgorithm() {
  const entries = routeData?.astar_trace || [];
  $('.jump-steps').open = false;
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
    $('#next-reason').textContent = 'Run a search to see which location A* will choose next.';
    $('#roads-from').textContent = 'THIS LOCATION';
    $('#candidate-explanation').textContent = 'Each destination gets its own g, h and f values.';
    $('#heuristic-working').textContent = 'straight-line distance ÷ 15 km/h';
    focusRing.visible = false;
    clearSearchHighlights();
    return;
  }
  entries.forEach((entry, index) => {
    const button = document.createElement('button');
    const number = document.createElement('b'); number.textContent = `${index + 1}`;
    const name = document.createElement('small'); name.textContent = nodeLabel(entry.node);
    button.append(number, name);
    button.title = `${entry.node}: g ${minutes(entry.g_seconds)} + h ${minutes(entry.h_seconds)} = f ${minutes(entry.f_seconds)} min`;
    button.addEventListener('click', () => selectTrace(index));
    $('#trace-list').appendChild(button);
  });
  selectTrace(0);
}
function showPath(mode, autoFinal = true) {
  if (!routeData) return;
  displayedMode = mode;
  const result = mode === 'reliable' ? routeData.reliable : routeData.astar;
  currentSteps = mode === 'reliable' ? routeData.reliable_steps : routeData.steps;
  drawRoute(result?.path || []);
  if (autoFinal && result?.path?.length) showFinalRoute(true);
  $('#show-reliable').textContent = mode === 'reliable' ? 'Return to fastest route on map' : 'Show reliability route on map';
}
function updateResults() {
  const a = routeData.astar, d = routeData.dijkstra, r = routeData.reliable;
  if (!a) {
    $('#show-final').disabled = true;
    $('#replay').disabled = true;
    showError('No route exists with these tunnel closures. Reopen a crossing or choose stops on the same side of the railway.');
    $('#eta').textContent = '—';
    $('#verified').textContent = 'No reachable route';
    $('#verified').classList.add('failed');
    $('#route-path').textContent = 'No connected route under these conditions.';
    $('#route-reason').textContent = 'A* exhausted every reachable road without reaching the destination.';
    for (const id of ['#astar-time', '#dijkstra-time']) $(id).textContent = '—';
    $('#astar-nodes').textContent = routeData.astar_trace.length;
    $('#dijkstra-nodes').textContent = routeData.dijkstra_trace.length;
    $('#comparison-insight').textContent = 'Both methods explored the reachable part of the network and found no path.';
    $('#legs').replaceChildren();
    $('#reliable-values').textContent = 'No candidate route is available.';
    showPath('fastest', false);
    $('#playback-label').textContent = 'No shuttle route';
    $('#progress-fill').style.width = '0%';
    $('#playback-time').textContent = '0%';
    return;
  }
  $('#show-final').disabled = false;
  $('#replay').disabled = false;
  showError('');
  $('#eta').textContent = minutes(a.travel_seconds);
  $('#verified').textContent = routeData.verified_optimum ? '✓ A* and Dijkstra agree on the optimum' : 'Search mismatch: inspect the core';
  $('#verified').classList.toggle('failed', !routeData.verified_optimum);
  $('#route-path').replaceChildren();
  a.path.forEach((name, index) => {
    if (index) {
      const arrow = document.createElement('span'); arrow.className = 'route-arrow'; arrow.textContent = '→';
      $('#route-path').appendChild(arrow);
    }
    const stop = document.createElement('span'); stop.className = 'route-stop'; stop.textContent = nodeLabel(name);
    $('#route-path').appendChild(stop);
  });
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
  showPath('fastest', false);
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
    updateResults();
    updateAlgorithm();
  } catch (error) { showError(error.message); }
}

$('#route-form').addEventListener('submit', (event) => { event.preventDefault(); calculate(); });
$('#randomize').addEventListener('click', () => { $('#seed').value = String(Math.floor(Math.random() * 100000)); calculate(); });
$('#previous-step').addEventListener('click', () => selectTrace(viewMode === 'route' ? routeData.astar_trace.length - 1 : currentTrace - 1));
$('#next-step').addEventListener('click', () => {
  if (currentTrace === routeData.astar_trace.length - 1) showFinalRoute(true);
  else selectTrace(currentTrace + 1);
});
$('#show-final').addEventListener('click', () => showFinalRoute(true));
$('#play-search').addEventListener('click', () => {
  if (walkthroughTimer) { stopWalkthrough(); return; }
  if (!routeData?.astar_trace?.length) return;
  if (viewMode === 'route') selectTrace(0);
  $('#play-search').textContent = 'Pause walkthrough';
  walkthroughTimer = setInterval(() => {
    if (currentTrace < routeData.astar_trace.length - 1) selectTrace(currentTrace + 1, true);
    else {
      stopWalkthrough();
      if (routeData.astar) showFinalRoute(true);
    }
  }, 950);
});
$('#show-reliable').addEventListener('click', () => showPath(displayedMode === 'reliable' ? 'fastest' : 'reliable'));
$('#replay').addEventListener('click', () => showFinalRoute(true));
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
