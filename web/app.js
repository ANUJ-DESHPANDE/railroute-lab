import * as THREE from './vendor/three.module.js';

const $ = (selector) => document.querySelector(selector);
const sceneHost = $('#scene');
const labelsHost = $('#labels');
let graph = null;
let routeData = null;
let mode = 'fastest';
let selectedPath = [];
let selectedSteps = [];
let animationClock = 0;
let animating = false;
let roadGroup = null;
let routeGroup = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1725);
scene.fog = new THREE.FogExp2(0x0a1725, 0.019);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneHost.appendChild(renderer.domElement);
const target = new THREE.Vector3(0, 0, 0);
let orbitAngle = 0.48;
let orbitElevation = 0.95;
let orbitDistance = 27;
function positionCamera() {
  camera.position.set(
    target.x + Math.sin(orbitAngle) * Math.cos(orbitElevation) * orbitDistance,
    target.y + Math.sin(orbitElevation) * orbitDistance,
    target.z + Math.cos(orbitAngle) * Math.cos(orbitElevation) * orbitDistance,
  );
  camera.lookAt(target);
}
positionCamera();
scene.add(new THREE.AmbientLight(0xa9d6e7, 1.35));
const sunlight = new THREE.DirectionalLight(0xcbefff, 2.0);
sunlight.position.set(-5, 14, 10);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -18;
sunlight.shadow.camera.right = 18;
sunlight.shadow.camera.top = 18;
sunlight.shadow.camera.bottom = -18;
scene.add(sunlight);
const cyanLight = new THREE.PointLight(0x36e0dc, 45, 22);
cyanLight.position.set(-4, 5, 0);
scene.add(cyanLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(22, 20),
  new THREE.MeshStandardMaterial({color: 0x102334, roughness: 1}),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.18;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(22, 36, 0x315064, 0x1a3445);
grid.position.y = -0.16;
grid.material.transparent = true;
grid.material.opacity = 0.42;
scene.add(grid);

// The raised railway visually separates the two halves of this schematic.
const railBed = new THREE.Mesh(
  new THREE.BoxGeometry(18, 0.17, 0.63),
  new THREE.MeshStandardMaterial({color: 0x2d2c46, roughness: 0.75}),
);
railBed.position.set(0, 0.12, -1.0);
railBed.receiveShadow = true;
scene.add(railBed);
for (const offset of [-0.16, 0.16]) {
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.045, 0.035),
    new THREE.MeshStandardMaterial({color: 0xbaa9f7, metalness: 0.65, roughness: 0.25, emissive: 0x5b477e, emissiveIntensity: 0.35}),
  );
  rail.position.set(0, 0.23, -1.0 + offset);
  scene.add(rail);
}
for (let x = -8.7; x <= 8.7; x += 0.42) {
  const sleeper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.55), new THREE.MeshStandardMaterial({color: 0x6a5d7d}));
  sleeper.position.set(x, 0.21, -1.0);
  scene.add(sleeper);
}

const bus = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 1.04), new THREE.MeshStandardMaterial({color: 0xffb34f, metalness: 0.2, roughness: 0.4, emissive: 0x5f2d08, emissiveIntensity: 0.17}));
body.position.y = 0.28;
body.castShadow = true;
bus.add(body);
const roof = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.17, 0.71), new THREE.MeshStandardMaterial({color: 0xf1f0e8, roughness: 0.55}));
roof.position.set(0, 0.51, -0.05);
roof.castShadow = true;
bus.add(roof);
for (const side of [-1, 1]) {
  const window = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.62), new THREE.MeshStandardMaterial({color: 0x193445, metalness: 0.35, roughness: 0.2}));
  window.position.set(side * 0.347, 0.42, -0.05);
  bus.add(window);
  for (const z of [-0.32, 0.35]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.06, 14), new THREE.MeshStandardMaterial({color: 0x101923}));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.37, 0.11, z);
    bus.add(wheel);
  }
}
const frontGlass = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.015), new THREE.MeshStandardMaterial({color: 0x17435a, metalness: 0.3}));
frontGlass.position.set(0, 0.42, 0.523);
bus.add(frontGlass);
bus.visible = false;
scene.add(bus);

function point(name, height = 0.06) {
  const loc = graph.locations.find((item) => item.name === name);
  return new THREE.Vector3(loc.east_km * 10 - 7.1, height, -loc.north_km * 10);
}
function tunnelKey(a, b) {
  return Object.values(graph.tunnels).some(([u, v]) => (a === u && b === v) || (a === v && b === u));
}
function isClosed(a, b) {
  return Object.entries(graph.tunnels).some(([name, [u, v]]) =>
    $('#close-' + name).checked && ((a === u && b === v) || (a === v && b === u)));
}
function roadCurve(a, b, height = 0.06) {
  const p1 = point(a, height), p2 = point(b, height);
  if (tunnelKey(a, b)) {
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mid.y = -0.22;
    return new THREE.CatmullRomCurve3([p1, mid, p2]);
  }
  return new THREE.LineCurve3(p1, p2);
}
function tube(curve, radius, color, opacity = 1) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, 16, radius, 7, false),
    new THREE.MeshStandardMaterial({color, transparent: opacity < 1, opacity, emissive: color, emissiveIntensity: opacity === 1 ? 0.3 : 0.1, roughness: 0.48}),
  );
}
function buildNetwork() {
  if (roadGroup) scene.remove(roadGroup);
  roadGroup = new THREE.Group();
  graph.roads.forEach((road) => {
    const closed = isClosed(road.start, road.end);
    const curve = roadCurve(road.start, road.end);
    roadGroup.add(tube(curve, tunnelKey(road.start, road.end) ? 0.085 : 0.06, closed ? 0xe06360 : tunnelKey(road.start, road.end) ? 0x5684db : 0x4f8aa2, closed ? 0.55 : 1));
  });
  scene.add(roadGroup);
}
function addLandmarks() {
  graph.locations.forEach((loc, index) => {
    const pos = point(loc.name);
    const isJunction = loc.kind === 'junction';
    if (!isJunction) {
      const hostel = loc.name.includes('Hostel');
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(0.5 + (index % 3) * 0.10, 0.45 + (index % 4) * 0.11, 0.43 + (index % 2) * 0.16),
        new THREE.MeshStandardMaterial({color: hostel ? 0x274761 : 0x2d5c6a, roughness: 0.7, metalness: 0.1, emissive: hostel ? 0x102b43 : 0x11343b, emissiveIntensity: 0.25}),
      );
      building.position.set(pos.x + 0.30, 0.13, pos.z + 0.33);
      building.castShadow = true;
      building.receiveShadow = true;
      scene.add(building);
      const top = new THREE.Mesh(new THREE.BoxGeometry(building.geometry.parameters.width + 0.04, 0.025, building.geometry.parameters.depth + 0.04), new THREE.MeshStandardMaterial({color: 0x7ca8aa, emissive: 0x41686a, emissiveIntensity: 0.25}));
      top.position.set(building.position.x, building.position.y + building.geometry.parameters.height / 2 + 0.015, building.position.z);
      scene.add(top);
    }
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(isJunction ? 0.10 : 0.17, isJunction ? 0.145 : 0.23, 24),
      new THREE.MeshBasicMaterial({color: isJunction ? 0x719db2 : 0x64ece1, side: THREE.DoubleSide, transparent: true, opacity: isJunction ? 0.6 : 0.95}),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    ring.position.y = 0.085;
    scene.add(ring);
    const label = document.createElement('div');
    label.className = 'place-label' + (isJunction ? ' junction' : '');
    label.dataset.name = loc.name;
    label.innerHTML = `<span>${loc.name}</span>`;
    labelsHost.appendChild(label);
  });
}
function highlightRoute(path) {
  if (routeGroup) scene.remove(routeGroup);
  routeGroup = new THREE.Group();
  for (let i = 0; i < path.length - 1; i++) {
    const curve = roadCurve(path[i], path[i + 1], 0.13);
    routeGroup.add(tube(curve, 0.17, 0xffae55, 0.16));
    routeGroup.add(tube(curve, 0.075, 0xffbd67));
  }
  scene.add(routeGroup);
  document.querySelectorAll('.place-label').forEach((label) => label.classList.toggle('selected', path.includes(label.dataset.name)));
  selectedPath = path;
  bus.visible = path.length > 0;
  animationClock = 0;
  animating = path.length > 1;
  placeBus(0);
}
function placeBus(progress) {
  if (!selectedPath.length) return;
  if (selectedPath.length === 1) {
    bus.position.copy(point(selectedPath[0], 0.15));
    return;
  }
  const total = selectedSteps.reduce((sum, step) => sum + step.seconds, 0) || 1;
  let remaining = progress * total;
  let index = selectedSteps.length - 1;
  let fraction = 1;
  for (let i = 0; i < selectedSteps.length; i++) {
    if (remaining <= selectedSteps[i].seconds) {
      index = i;
      fraction = remaining / selectedSteps[i].seconds;
      break;
    }
    remaining -= selectedSteps[i].seconds;
  }
  const curve = roadCurve(selectedPath[index], selectedPath[index + 1], 0.12);
  const p = curve.getPoint(Math.min(1, Math.max(0, fraction)));
  const tangent = curve.getTangent(Math.min(0.999, Math.max(0.001, fraction)));
  bus.position.copy(p);
  bus.position.y += 0.12;
  bus.rotation.y = Math.atan2(tangent.x, tangent.z);
}
function updateLabels() {
  if (!graph) return;
  const width = sceneHost.clientWidth, height = sceneHost.clientHeight;
  for (const label of labelsHost.children) {
    const pos = point(label.dataset.name, 0.95);
    pos.project(camera);
    label.style.left = `${(pos.x * 0.5 + 0.5) * width}px`;
    label.style.top = `${(-pos.y * 0.5 + 0.5) * height}px`;
    label.style.visibility = pos.z > 1 || Math.abs(pos.x) > 1.05 || Math.abs(pos.y) > 1.05 ? 'hidden' : 'visible';
  }
}
function resize() {
  const width = sceneHost.clientWidth, height = sceneHost.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', (event) => {dragging = true; lastX = event.clientX; lastY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId);});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  orbitAngle -= (event.clientX - lastX) * 0.006;
  orbitElevation = Math.max(0.28, Math.min(1.38, orbitElevation + (event.clientY - lastY) * 0.005));
  lastX = event.clientX; lastY = event.clientY;
  positionCamera();
});
renderer.domElement.addEventListener('pointerup', () => {dragging = false;});
renderer.domElement.addEventListener('wheel', (event) => {event.preventDefault(); orbitDistance = Math.max(12, Math.min(34, orbitDistance + event.deltaY * 0.015)); positionCamera();}, {passive: false});
const timer = new THREE.Clock();
function render() {
  requestAnimationFrame(render);
  const delta = Math.min(timer.getDelta(), 0.05);
  if (animating) {
    animationClock += delta;
    placeBus(Math.min(animationClock / 9, 1));
    if (animationClock >= 9) animating = false;
  }
  updateLabels();
  renderer.render(scene, camera);
}
render();

function minutes(seconds) {return (seconds / 60).toFixed(1);}
function showError(message) {$('#error').hidden = !message; $('#error').textContent = message || '';}
function populateStops() {
  const stops = graph.locations.filter((loc) => loc.kind === 'stop');
  for (const select of [$('#start'), $('#goal')]) {
    stops.forEach((stop) => {
      const option = document.createElement('option'); option.value = stop.name; option.textContent = stop.name; select.appendChild(option);
    });
  }
  $('#start').value = 'Technology Tower'; $('#goal').value = 'Hostel Q Block';
}
function updateReport() {
  if (!routeData) return;
  const fastest = routeData.astar;
  const reliable = routeData.reliable;
  const chosen = mode === 'reliable' ? reliable : fastest;
  const steps = mode === 'reliable' ? routeData.reliable_steps : routeData.steps;
  if (!chosen) {
    showError('No route is available with the selected closures.');
    selectedSteps = [];
    highlightRoute([]);
    $('#eta').textContent = '—';
    $('#route-name').textContent = 'Try reopening one underpass or selecting stops on the same side.';
    for (const id of ['#distance', '#expanded', '#p90', '#paths', '#astar-nodes', '#dijkstra-nodes']) $(id).textContent = '—';
    $('#astar-bar').style.width = '0%';
    $('#dijkstra-bar').style.width = '0%';
    $('#verification').textContent = 'NO ROUTE UNDER CURRENT CONDITIONS';
    $('#verification').classList.add('failed');
    $('#steps').replaceChildren();
    $('#trace').replaceChildren();
    return;
  }
  showError('');
  selectedSteps = steps;
  highlightRoute(chosen.path);
  $('#period-pill').textContent = chosen.period.replace('_', ' ').toUpperCase();
  $('#eta').textContent = minutes(mode === 'reliable' ? chosen.expected_seconds : chosen.travel_seconds);
  $('#route-name').textContent = `${chosen.path[0]}  →  ${chosen.path.at(-1)} · ${mode === 'reliable' ? 'reliability route' : 'fastest route'}`;
  $('#distance').textContent = `${chosen.distance_km.toFixed(2)} km`;
  $('#expanded').textContent = fastest ? fastest.nodes_expanded : '—';
  const selectedP90 = mode === 'reliable' ? reliable?.estimated_p90_seconds : routeData.fastest_p90_seconds;
  $('#p90').textContent = selectedP90 == null ? '—' : `${minutes(selectedP90)} min`;
  $('#paths').textContent = reliable ? reliable.paths_evaluated : '—';
  $('#astar-nodes').textContent = fastest ? fastest.nodes_expanded : '—';
  $('#dijkstra-nodes').textContent = routeData.dijkstra ? routeData.dijkstra.nodes_expanded : '—';
  const largest = Math.max(fastest?.nodes_expanded || 0, routeData.dijkstra?.nodes_expanded || 1);
  $('#astar-bar').style.width = `${(fastest?.nodes_expanded || 0) / largest * 100}%`;
  $('#dijkstra-bar').style.width = `${(routeData.dijkstra?.nodes_expanded || 0) / largest * 100}%`;
  $('#verification').textContent = routeData.verified_optimum ? '✓ VERIFIED: A* AND DIJKSTRA AGREE ON THE FASTEST ETA' : 'SEARCH RESULT NEEDS VERIFICATION';
  $('#verification').classList.toggle('failed', !routeData.verified_optimum);
  $('#trace').replaceChildren();
  (fastest?.expansions || []).forEach((entry, i) => {
    const row = document.createElement('div');
    const name = document.createElement('span'); name.textContent = `${i + 1}. ${entry.node}`;
    const score = document.createElement('b'); score.textContent = `${minutes(entry.g_seconds)} + ${minutes(entry.h_seconds)} = ${minutes(entry.f_seconds)}`;
    row.append(name, score); $('#trace').appendChild(row);
  });
  $('#steps').replaceChildren();
  steps.forEach((step, i) => {
    const li = document.createElement('li');
    const icon = document.createElement('span'); icon.className = 'step-icon'; icon.textContent = String(i + 1);
    const body = document.createElement('span'); body.className = 'step-body';
    const title = document.createElement('b'); title.textContent = `${step.start} → ${step.end}`;
    const detail = document.createElement('small'); detail.textContent = `${step.distance_km.toFixed(2)} km${step.start.includes('Tunnel') || step.end.includes('Tunnel') ? ' · rail crossing area' : ''}`;
    body.append(title, detail);
    const time = document.createElement('span'); time.className = 'step-time'; time.textContent = `${minutes(step.seconds)} min`;
    li.append(icon, body, time); $('#steps').appendChild(li);
  });
}
async function calculate() {
  const query = new URLSearchParams({start: $('#start').value, goal: $('#goal').value, departure: $('#departure').value});
  if ($('#close-west').checked) query.append('closed', 'west');
  if ($('#close-east').checked) query.append('closed', 'east');
  try {
    const response = await fetch(`/api/route?${query}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Route request failed');
    routeData = data;
    buildNetwork();
    updateReport();
  } catch (error) {showError(error.message);}
}
$('#route-form').addEventListener('submit', (event) => {event.preventDefault(); calculate();});
document.querySelectorAll('.mode').forEach((button) => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('.mode').forEach((item) => item.classList.toggle('active', item === button));
  $('#mode-explainer').textContent = mode === 'fastest' ? 'Minimize expected travel time with time-dependent A*.' : 'Minimize modeled 90th-percentile ETA across simple routes.';
  updateReport();
}));
$('#replay').addEventListener('click', () => {animationClock = 0; animating = selectedPath.length > 1; placeBus(0);});

try {
  const response = await fetch('/api/graph');
  if (!response.ok) throw new Error('Network data failed to load');
  graph = await response.json();
  populateStops();
  addLandmarks();
  buildNetwork();
  resize();
  calculate();
} catch (error) {showError(error.message);}
