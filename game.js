import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js";

(() => {
  "use strict";

  const W = 32, H = 24;
  const canvas = document.querySelector("#scene");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#080a09");
  scene.fog = new THREE.FogExp2("#101512", .045);
  const camera = new THREE.PerspectiveCamera(72, 1, .05, 44);
  camera.rotation.order = "YXZ";
  const clock = new THREE.Clock();
  const dungeon = new THREE.Group();
  scene.add(dungeon);
  const actorLayer = new THREE.Group();
  scene.add(actorLayer);
  const actorMeshes = new Map();
  const scratchObject = new THREE.Object3D();
  const scratchColor = new THREE.Color();
  const solids = [];
  let wallInstances, ceilingInstances;
  const torch = new THREE.SpotLight("#f0dfb8", 74, 20, Math.PI / 4.2, .44, 1.1);
  torch.castShadow = false;
  const torchTarget = new THREE.Object3D();
  scene.add(torch, torchTarget);
  torch.target = torchTarget;
  scene.add(new THREE.HemisphereLight("#8a9991", "#332b20", 1.55));
  scene.add(camera);
  const headLamp = new THREE.PointLight("#dfd5ba", 7, 7.5, 1.45);
  camera.add(headLamp);
  const caveFill = new THREE.PointLight("#789087", 6, 9, 2);
  caveFill.castShadow = false;
  scene.add(caveFill);
  const mapCanvas = document.querySelector("#map");
  const mapCtx = mapCanvas.getContext("2d");
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    start: $("#start-screen"), end: $("#end-screen"), pause: $("#pause-screen"),
    toast: $("#toast"), prompt: $("#interact-prompt"), alert: $("#alert-pill"),
    location: $("#location-name"), hint: $("#objective-hint"),
    frag: $("#frag-count"), craft: $("#craft-count"), exit: $("#exit-count"),
    craftStatus: $("#craft-status"), keyState: $("#key-state"),
    cricket: $("#cricket-count"), flash: $("#flash-count"),
    threatBar: $("#threat-bar"), threatLabel: $("#threat-label"),
    noiseBar: $("#noise-bar"), noiseLabel: $("#noise-label"),
    healthBar: $("#health-bar"), healthLabel: $("#health-label"),
    map: $("#map-overlay")
  };
  const keysDown = new Set();
  const keys = new Set();
  const ignoredKeysUntilRelease = new Set();
  const heldControlKeys = new Set(["w", "a", "s", "d", "arrowleft", "arrowright"]);
  let lastHeldControlInputAt = 0;
  let mouseLookPointer = null;
  const world = [];
  const wanderNodes = [];
  const fragments = [];
  const pickups = [];
  let audio = null;
  let started = false, paused = false, ended = false, soundOn = true, mapOpen = false;
  let selectedItem = "cricket", toastTimer = 0, lastTime = 0, gameTime = 0;
  let player, dragon, bench, exitDoor, cricketDrop;
  let wallMaterial, floorMaterial, roofMaterial;

  const rooms = [
    { x: 2, y: 16, w: 7, h: 6, name: "입구 동굴" },
    { x: 9, y: 10, w: 8, h: 8, name: "갈림길" },
    { x: 2, y: 3, w: 8, h: 8, name: "수정 회랑" },
    { x: 10, y: 2, w: 9, h: 8, name: "울음 동굴" },
    { x: 20, y: 7, w: 9, h: 8, name: "검은 연못" },
    { x: 19, y: 16, w: 10, h: 6, name: "봉인된 출구" }
  ];

  function carveRect(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      if (xx > 0 && yy > 0 && xx < W - 1 && yy < H - 1) world[yy][xx] = 0;
    }
  }
  function carvePath(points) {
    for (let p = 1; p < points.length; p++) {
      let [x, y] = points[p - 1], [tx, ty] = points[p];
      while (x !== tx) {
        carveRect(Math.min(x, tx), y, Math.abs(tx - x) + 1, 1);
        x += Math.sign(tx - x);
      }
      while (y !== ty) {
        carveRect(x, Math.min(y, ty), 1, Math.abs(ty - y) + 1);
        y += Math.sign(ty - y);
      }
    }
  }
  function carveMazeRoom(x, y, width, height, startColumn, startRow) {
    for (let yy = y; yy < y + height; yy++) {
      for (let xx = x; xx < x + width; xx++) world[yy][xx] = 1;
    }
    const columns = Math.floor((width - 1) / 2);
    const rows = Math.floor((height - 1) / 2);
    const visited = new Set();
    let seed = 19373;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const visit = (column, row) => {
      visited.add(`${column},${row}`);
      const cellX = x + 1 + column * 2, cellY = y + 1 + row * 2;
      carveRect(cellX, cellY, 1, 1);
      const shuffledDirections = directions.slice();
      for (let i = shuffledDirections.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffledDirections[i], shuffledDirections[j]] = [shuffledDirections[j], shuffledDirections[i]];
      }
      for (const [dx, dy] of shuffledDirections) {
        const nextX = column + dx, nextY = row + dy;
        const key = `${nextX},${nextY}`;
        if (nextX < 0 || nextY < 0 || nextX >= columns || nextY >= rows || visited.has(key)) continue;
        carveRect(cellX + dx, cellY + dy, 1, 1);
        visit(nextX, nextY);
      }
    };
    visit(startColumn, startRow);
  }
  function buildWorld() {
    for (let y = 0; y < H; y++) world[y] = Array(W).fill(1);
    rooms.forEach(r => carveRect(r.x, r.y, r.w, r.h));
    carveMazeRoom(2, 16, 7, 6, 1, 1);
    carveMazeRoom(2, 3, 8, 8, 2, 2);
    carveMazeRoom(10, 2, 9, 8, 2, 2);
    carveMazeRoom(9, 10, 8, 8, 2, 1);
    carveMazeRoom(20, 7, 9, 8, 1, 2);
    carveMazeRoom(19, 16, 10, 6, 0, 0);

    carvePath([[5, 19], [8, 19], [9, 16], [10, 15]]);
    carvePath([[7, 8], [9, 8], [10, 11]]);
    carvePath([[7, 8], [11, 7]]);
    carvePath([[17, 7], [18, 7], [18, 8], [21, 8]]);
    carvePath([[14, 13], [17, 13], [17, 11], [21, 11], [21, 12]]);
    carvePath([[14, 15], [17, 15], [17, 17], [20, 17]]);
    carvePath([[25, 12], [25, 14], [24, 14], [24, 17]]);
    carveRect(13, 14, 1, 1);
    carveRect(25, 17, 1, 1);
    carveRect(26, 10, 1, 1);

    wanderNodes.length = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (world[y][x] === 0) wanderNodes.push({ x: x + .5, y: y + .5 });
    }

    player = {
      x: 5.5, y: 19.5, dx: 1, dy: 0, angle: 0, pitch: 0,
      health: 100, noise: 0, hurt: 0, footsteps: 0, bob: 0
    };
    dragon = {
      x: 15.5, y: 5.5, dx: 0, dy: 1, state: "patrol", suspicion: 0,
      searchTime: 0, pathTimer: 0, path: null, wanderTarget: null, stun: 0, eatTimer: 0, bite: 0
    };
    dragon.wanderTarget = chooseDragonWanderTarget(dragon);
    bench = { x: 13.7, y: 14.4 };
    exitDoor = { x: 26.6, y: 19.1 };
    cricketDrop = null;
    fragments.length = 0;
    fragments.push(
      { x: 5.2, y: 6.7, found: false },
      { x: 17.1, y: 5.6, found: false },
      { x: 26.3, y: 10.1, found: false }
    );
    pickups.length = 0;
    pickups.push(
      { type: "cricket", x: 4, y: 17.3, taken: false },
      { type: "flash", x: 10.3, y: 15.2, taken: false },
      { type: "cricket", x: 11.3, y: 7.3, taken: false },
      { type: "flash", x: 17.3, y: 7.3, taken: false },
      { type: "cricket", x: 23, y: 12.1, taken: false },
      { type: "flash", x: 25.8, y: 17.3, taken: false }
    );
  }
  buildWorld();
  buildDungeon();
  buildActors();

  function makeRockTexture(base, seed) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 512; textureCanvas.height = 512;
    const textureContext = textureCanvas.getContext("2d");
    textureContext.fillStyle = base;
    textureContext.fillRect(0, 0, 512, 512);
    let value = seed;
    const random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
    for (let i = 0; i < 14500; i++) {
      const shade = Math.floor(random() * 62);
      textureContext.fillStyle = `rgba(${shade + 43},${shade + 47},${shade + 39},${.05 + random() * .24})`;
      const x = random() * 512, y = random() * 512, size = 1 + random() * 11;
      textureContext.beginPath();
      textureContext.ellipse(x, y, size * (1 + random()), size * (.35 + random()), random() * Math.PI, 0, Math.PI * 2);
      textureContext.fill();
    }
    for (let i = 0; i < 75; i++) {
      const x = random() * 512, y = random() * 512;
      textureContext.strokeStyle = `rgba(4,7,5,${.06 + random() * .16})`;
      textureContext.lineWidth = 1 + random() * 4;
      textureContext.beginPath(); textureContext.moveTo(x, y);
      textureContext.lineTo(x + (random() - .5) * 20, y + random() * 70);
      textureContext.lineTo(x + (random() - .5) * 50, y + random() * 95);
      textureContext.stroke();
    }
    for (let i = 0; i < 145; i++) {
      const x = random() * 512, y = random() * 512, radius = 8 + random() * 52;
      const wet = random() > .5;
      const patch = textureContext.createRadialGradient(x, y, 0, x, y, radius);
      patch.addColorStop(0, wet ? "rgba(91,115,112,.25)" : "rgba(157,137,101,.18)");
      patch.addColorStop(1, "rgba(40,44,40,0)");
      textureContext.fillStyle = patch;
      textureContext.beginPath(); textureContext.ellipse(x, y, radius, radius * (.3 + random() * .4), random() * Math.PI, 0, Math.PI * 2); textureContext.fill();
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    return texture;
  }
  function makeRockBumpTexture(seed) {
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = 256; bumpCanvas.height = 256;
    const bumpContext = bumpCanvas.getContext("2d");
    const image = bumpContext.createImageData(256, 256);
    let value = seed;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      value = (value * 1664525 + 1013904223) >>> 0;
      const fine = (value >>> 24) / 255;
      const ridge = (Math.sin(x * .11 + Math.sin(y * .035) * 2) + 1) * .5;
      const shade = Math.round(92 + fine * 80 + ridge * 48);
      const index = (y * 256 + x) * 4;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = shade;
      image.data[index + 3] = 255;
    }
    bumpContext.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(bumpCanvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    return texture;
  }
  function makeScaleTexture(seed) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 512; textureCanvas.height = 512;
    const textureContext = textureCanvas.getContext("2d");
    textureContext.fillStyle = "#d9d4c7";
    textureContext.fillRect(0, 0, 512, 512);
    let value = seed;
    const random = () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
    const rows = 34, columns = 34;
    for (let row = -1; row <= rows; row++) for (let column = -1; column <= columns; column++) {
      const x = column * 16 + (row % 2) * 8, y = row * 15;
      const shade = Math.floor(random() * 18);
      textureContext.fillStyle = `rgb(${205 + shade},${199 + shade},${182 + shade})`;
      textureContext.strokeStyle = `rgba(88,80,68,${.35 + random() * .22})`;
      textureContext.lineWidth = .8 + random() * .45;
      textureContext.beginPath();
      textureContext.moveTo(x - 7, y - 5);
      textureContext.quadraticCurveTo(x, y - 10, x + 7, y - 5);
      textureContext.quadraticCurveTo(x + 9, y + 1, x, y + 8);
      textureContext.quadraticCurveTo(x - 9, y + 1, x - 7, y - 5);
      textureContext.fill(); textureContext.stroke();
      textureContext.fillStyle = "rgba(255,250,231,.24)";
      textureContext.beginPath(); textureContext.arc(x - 2, y - 3, 1.1, 0, Math.PI * 2); textureContext.fill();
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }
  function buildDungeon() {
    wallMaterial = new THREE.MeshStandardMaterial({
      color: "#bcb8a9", map: makeRockTexture("#494940", 344), bumpMap: makeRockBumpTexture(344),
      bumpScale: .16, roughness: .94, metalness: .02,
      vertexColors: true
    });
    floorMaterial = new THREE.MeshStandardMaterial({
      color: "#b8b2a1", map: makeRockTexture("#47483f", 883), bumpMap: makeRockBumpTexture(883),
      bumpScale: .1, roughness: .92, metalness: .04,
      vertexColors: true
    });
    roofMaterial = new THREE.MeshStandardMaterial({
      color: "#96948b", map: makeRockTexture("#333733", 992), bumpMap: makeRockBumpTexture(992),
      bumpScale: .2, roughness: .98, metalness: 0,
      vertexColors: true, side: THREE.DoubleSide
    });

    const floors = [], walls = [], roofs = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (world[z][x] === 0) floors.push({ x, z });
      else walls.push({ x, z });
    }
    const floorInstances = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.02, 1.02), floorMaterial, floors.length);
    floorInstances.receiveShadow = true;
    floors.forEach((tile, index) => {
      scratchObject.position.set(tile.x + .5, 0, tile.z + .5);
      scratchObject.rotation.set(-Math.PI / 2, 0, 0);
      scratchObject.updateMatrix();
      floorInstances.setMatrixAt(index, scratchObject.matrix);
      const shade = .76 + ((tile.x * 17 + tile.z * 31) % 11) / 40;
      floorInstances.setColorAt(index, scratchColor.setRGB(shade, shade * .98, shade * .9));
      roofs.push(tile);
    });
    floorInstances.instanceMatrix.needsUpdate = true;
    dungeon.add(floorInstances);

    wallInstances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMaterial, walls.length);
    wallInstances.castShadow = true; wallInstances.receiveShadow = true;
    walls.forEach((tile, index) => {
      const height = 3.4 + ((tile.x * 9 + tile.z * 13) % 8) * .17;
      scratchObject.position.set(tile.x + .5, height / 2, tile.z + .5);
      scratchObject.scale.set(1.025, height, 1.025);
      scratchObject.rotation.set(0, ((tile.x * 7 + tile.z) % 4) * .025, 0);
      scratchObject.updateMatrix();
      wallInstances.setMatrixAt(index, scratchObject.matrix);
      const shade = .65 + ((tile.x * 19 + tile.z * 23) % 12) / 30;
      wallInstances.setColorAt(index, scratchColor.setRGB(shade, shade * .98, shade * .92));
      solids.push({ x: tile.x + .5, z: tile.z + .5, radius: .68 });
    });
    wallInstances.instanceMatrix.needsUpdate = true;
    dungeon.add(wallInstances);

    const rockFaces = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(.72, 1),
      wallMaterial,
      walls.length
    );
    rockFaces.castShadow = true;
    rockFaces.receiveShadow = true;
    walls.forEach((tile, index) => {
      const height = 1.65 + ((tile.x * 11 + tile.z * 3) % 8) * .12;
      scratchObject.position.set(tile.x + .5, height, tile.z + .5);
      scratchObject.scale.set(.74 + (tile.x % 3) * .04, 1.05 + (tile.z % 3) * .08, .74 + ((tile.x + tile.z) % 3) * .04);
      scratchObject.rotation.set(((tile.x * 5) % 5) * .08, ((tile.z * 7) % 7) * .1, ((tile.x + tile.z) % 5) * .06);
      scratchObject.updateMatrix();
      rockFaces.setMatrixAt(index, scratchObject.matrix);
      const shade = .64 + ((tile.x * 7 + tile.z * 17) % 13) / 34;
      rockFaces.setColorAt(index, scratchColor.setRGB(shade, shade * .99, shade * .92));
    });
    rockFaces.instanceMatrix.needsUpdate = true;
    dungeon.add(rockFaces);

    ceilingInstances = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), roofMaterial, roofs.length);
    ceilingInstances.castShadow = true;
    roofs.forEach((tile, index) => {
      const scale = .68 + ((tile.x * 7 + tile.z * 11) % 5) * .09;
      scratchObject.position.set(tile.x + .5, 4.12 + ((tile.x + tile.z) % 3) * .12, tile.z + .5);
      scratchObject.scale.set(scale * 1.05, .38 + scale * .16, scale * 1.05);
      scratchObject.rotation.set(((tile.x * 3) % 8) * .03, ((tile.z * 5) % 8) * .04, 0);
      scratchObject.updateMatrix();
      ceilingInstances.setMatrixAt(index, scratchObject.matrix);
      const shade = .62 + ((tile.x * 13 + tile.z * 3) % 10) / 40;
      ceilingInstances.setColorAt(index, scratchColor.setRGB(shade, shade * 1.02, shade * .96));
    });
    ceilingInstances.instanceMatrix.needsUpdate = true;
    dungeon.add(ceilingInstances);

    const crystalMaterial = new THREE.MeshStandardMaterial({
      color: "#758c75", emissive: "#304c36", emissiveIntensity: .65,
      roughness: .48, metalness: .12
    });
    const crystals = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.2, 0), crystalMaterial, 35);
    let crystalIndex = 0;
    for (const room of rooms) {
      const positions = [
        [room.x + .5, room.y + .5], [room.x + room.w - .5, room.y + .7],
        [room.x + .8, room.y + room.h - .7], [room.x + room.w - .8, room.y + room.h - .7]
      ];
      for (const [x, z] of positions) {
        if (wallAt(x, z) || crystalIndex >= crystals.count) continue;
        const height = .6 + (crystalIndex % 4) * .2;
        scratchObject.position.set(x, height / 2, z);
        scratchObject.scale.set(.55, height / .4, .55);
        scratchObject.rotation.set(0, crystalIndex * .7, .12);
        scratchObject.updateMatrix();
        crystals.setMatrixAt(crystalIndex++, scratchObject.matrix);
      }
    }
    crystals.count = crystalIndex;
    crystals.instanceMatrix.needsUpdate = true;
    dungeon.add(crystals);

    const stalactiteMaterial = new THREE.MeshStandardMaterial({ color: "#55594d", roughness: .98 });
    const stalagmiteMaterial = new THREE.MeshStandardMaterial({ color: "#57594c", roughness: .97 });
    let seed = 7943;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let z = 2; z < H - 2; z++) for (let x = 2; x < W - 2; x++) {
      if (wallAt(x + .5, z + .5) || random() > .045) continue;
      if (Math.hypot(x + .5 - 5.2, z + .5 - 19.2) < 2.2 ||
        Math.hypot(x + .5 - bench.x, z + .5 - bench.y) < 1.8 ||
        Math.hypot(x + .5 - exitDoor.x, z + .5 - exitDoor.y) < 1.8) continue;
      const height = .28 + random() * .62;
      const radius = .11 + random() * .16;
      const floorRock = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 5), stalagmiteMaterial);
      floorRock.position.set(x + .5 + (random() - .5) * .4, height / 2, z + .5 + (random() - .5) * .4);
      floorRock.rotation.y = random() * 5;
      floorRock.castShadow = true;
      dungeon.add(floorRock);
      if (random() > .45) {
        const hanging = new THREE.Mesh(new THREE.ConeGeometry(radius * .75, height * 1.5, 5), stalactiteMaterial);
        hanging.position.set(floorRock.position.x + .18, 3.75, floorRock.position.z - .16);
        hanging.rotation.x = Math.PI;
        hanging.castShadow = true;
        dungeon.add(hanging);
      }
    }
    const glow = new THREE.PointLight("#78956b", 1.7, 7, 2);
    glow.position.set(6, 1.5, 7);
    scene.add(glow);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 32),
      new THREE.MeshPhysicalMaterial({
        color: "#145b72", roughness: .16, metalness: .2, transparent: true, opacity: .87,
        clearcoat: .9, clearcoatRoughness: .12, emissive: "#062433", emissiveIntensity: .65
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(24.4, .025, 10.4);
    dungeon.add(water);
    const rippleMaterial = new THREE.MeshBasicMaterial({ color: "#62b4c1", transparent: true, opacity: .27, side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const ripple = new THREE.Mesh(new THREE.TorusGeometry(.35 + i * .32, .012, 4, 48), rippleMaterial.clone());
      ripple.rotation.x = Math.PI / 2;
      ripple.position.set(24.4, .04 + i * .003, 10.4);
      dungeon.add(ripple);
    }
    const waterLight = new THREE.PointLight("#547f82", 2.2, 5, 2);
    waterLight.position.set(24.3, .4, 10.2);
    scene.add(waterLight);
  }
  function createBeardedDragon() {
    const group = new THREE.Group();
    const scales = makeScaleTexture(734);
    const scaleMat = new THREE.MeshStandardMaterial({
      color: "#e5ddcb", map: scales, bumpMap: makeRockBumpTexture(734), bumpScale: .025, roughness: .82
    });
    const paleMat = new THREE.MeshStandardMaterial({ color: "#f0e9d8", map: scales, roughness: .8 });
    const limbMat = new THREE.MeshStandardMaterial({ color: "#c2b9a7", map: scales, roughness: .86 });
    const spikeMat = new THREE.MeshStandardMaterial({ color: "#d8d1c0", roughness: .72 });
    const darkMat = new THREE.MeshStandardMaterial({ color: "#292520", roughness: .6 });
    const irisMat = new THREE.MeshStandardMaterial({ color: "#bf8060", roughness: .36, emissive: "#713d2d", emissiveIntensity: .25 });
    const blackMat = new THREE.MeshStandardMaterial({ color: "#10100e", roughness: .28 });
    const mouthMat = new THREE.MeshStandardMaterial({ color: "#542b28", roughness: .85 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), scaleMat);
    body.scale.set(.66, .39, .86); body.position.set(0, .66, -.12); body.castShadow = true; group.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), paleMat);
    belly.scale.set(.58, .2, .65); belly.position.set(0, .49, -.08); group.add(belly);
    const head = new THREE.Group(); head.position.set(0, .9, .51); group.add(head);
    const outline = new THREE.Shape();
    outline.moveTo(-.29, -.3);
    outline.quadraticCurveTo(-.46, -.15, -.43, .02);
    outline.quadraticCurveTo(-.41, .18, -.25, .3);
    outline.quadraticCurveTo(0, .57, .25, .3);
    outline.quadraticCurveTo(.41, .18, .43, .02);
    outline.quadraticCurveTo(.46, -.15, .29, -.3);
    outline.quadraticCurveTo(0, -.38, -.29, -.3);
    const skullGeometry = new THREE.ExtrudeGeometry(outline, {
      depth: .28, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .065, bevelThickness: .055
    });
    skullGeometry.translate(0, 0, -.14);
    skullGeometry.rotateX(Math.PI / 2);
    const skull = new THREE.Mesh(skullGeometry, paleMat);
    skull.position.y = .035; skull.castShadow = true; head.add(skull);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), scaleMat);
    snout.scale.set(.34, .18, .35); snout.position.set(0, -.035, .34); head.add(snout);
    const jaw = new THREE.Group(); jaw.position.set(0, -.13, .22); head.add(jaw);
    const lowerJaw = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mouthMat);
    lowerJaw.scale.set(.29, .065, .29); lowerJaw.position.set(0, -.045, .18); jaw.add(lowerJaw);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), paleMat);
    chin.scale.set(.31, .075, .29); chin.position.set(0, -.095, .18); jaw.add(chin);
    for (const side of [-1, 1]) {
      const eyeRidge = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), scaleMat);
      eyeRidge.scale.set(.12, .105, .17); eyeRidge.position.set(side * .31, .085, .1); head.add(eyeRidge);
      const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshStandardMaterial({ color: "#eee9dc", roughness: .35 }));
      eyeWhite.scale.set(.085, .08, .08); eyeWhite.position.set(side * .375, .07, .13); head.add(eyeWhite);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), irisMat);
      iris.scale.set(.048, .052, .052); iris.position.set(side * .415, .07, .142); head.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), blackMat);
      pupil.scale.set(.018, .039, .035); pupil.position.set(side * .444, .07, .147); head.add(pupil);
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 8), darkMat);
      nostril.position.set(side * .16, .025, .617); head.add(nostril);
      for (let i = 0; i < 9; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(.055 + (i % 3) * .012, .16 + (i % 3) * .035, 5), spikeMat);
        spike.position.set(side * (.39 - i * .013), -.005 + (i % 2) * .025, -.14 + i * .077);
        spike.rotation.z = side * -.32; spike.rotation.x = -.3; spike.castShadow = true; head.add(spike);
      }
      for (let i = 0; i < 7; i++) {
        const beardSpike = new THREE.Mesh(new THREE.ConeGeometry(.045, .14 + (i % 2) * .04, 5), spikeMat);
        beardSpike.position.set(side * (.24 + (i % 3) * .04), -.18 - (i % 2) * .035, .12 + i * .055);
        beardSpike.rotation.x = .8; beardSpike.rotation.z = side * .4; head.add(beardSpike);
      }
    }
    const tailSegments = [];
    for (let i = 0; i < 11; i++) {
      const radius = .23 * (1 - i / 11);
      const segment = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), i % 2 ? scaleMat : paleMat);
      segment.scale.set(radius, radius * .63, .28 - i * .015);
      segment.position.set(0, .63 - i * .01, -.88 - i * .23);
      segment.rotation.x = -.08;
      segment.castShadow = true; group.add(segment); tailSegments.push(segment);
    }
    const tailTip = new THREE.Mesh(new THREE.ConeGeometry(.045, .34, 9), paleMat);
    tailTip.position.set(0, .52, -3.48); tailTip.rotation.x = -Math.PI / 2; group.add(tailTip);
    const legs = [];
    for (const side of [-1, 1]) for (const fore of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * .54, .35, fore ? .52 : -.72);
      const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 12), limbMat);
      upper.scale.set(.21, .17, .25); upper.castShadow = true; leg.add(upper);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .2, 4, 8), limbMat);
      lower.position.set(side * .11, -.19, .11); lower.rotation.z = side * -.42; lower.rotation.x = .43; lower.castShadow = true; leg.add(lower);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), limbMat);
      foot.scale.set(.21, .075, .19); foot.position.set(side * .15, -.31, .21); foot.castShadow = true; leg.add(foot);
      for (let toe = -2; toe <= 2; toe++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(.025, .12, 5), spikeMat);
        claw.position.set(side * (.15 + toe * .05), -.315, .32 + Math.abs(toe) * .015);
        claw.rotation.x = Math.PI / 2; claw.rotation.z = side * -.3 + toe * .07; leg.add(claw);
      }
      group.add(leg); legs.push(leg);
    }
    const scaleGeometry = new THREE.SphereGeometry(.044, 8, 6);
    const bodyScales = new THREE.InstancedMesh(scaleGeometry, paleMat, 240);
    let scaleIndex = 0;
    for (let row = 0; row <= 10; row++) {
      const z = -.78 + row * .135, zNorm = (z + .12) / .86;
      const ring = Math.sqrt(Math.max(0, 1 - zNorm * zNorm));
      for (let column = 0; column < 24; column++) {
        const angle = column / 24 * Math.PI * 2;
        const x = .66 * ring * Math.cos(angle), y = .66 + .39 * ring * Math.sin(angle);
        scratchObject.position.set(x, y, z);
        scratchObject.scale.set(.78, .5, 1);
        scratchObject.rotation.set(0, angle, -Math.cos(angle) * .35);
        scratchObject.updateMatrix();
        bodyScales.setMatrixAt(scaleIndex++, scratchObject.matrix);
      }
    }
    bodyScales.count = scaleIndex; bodyScales.castShadow = true; group.add(bodyScales);
    group.scale.set(.52, .84, .68);
    group.userData = { head, jaw, legs, tailSegments };
    return group;
  }
  function createCricketModel() {
    const cricket = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: "#69764b", emissive: "#202713", emissiveIntensity: .35, roughness: .75 });
    const legMaterial = new THREE.MeshStandardMaterial({ color: "#827753", roughness: .82 });
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: "#d8b576", emissive: "#6d4c22", emissiveIntensity: .65 });
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), shell);
    abdomen.scale.set(.095, .065, .18); abdomen.position.set(0, .13, -.045); cricket.add(abdomen);
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(.073, 12, 10), shell);
    thorax.scale.set(.9, .8, .8); thorax.position.set(0, .145, .105); cricket.add(thorax);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.052, 12, 10), shell);
    head.position.set(0, .155, .18); cricket.add(head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.012, 8, 6), eyeMaterial);
      eye.position.set(side * .04, .174, .204); cricket.add(eye);
    }
    const up = new THREE.Vector3(0, 1, 0);
    const addSegment = (start, end, radius) => {
      const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end);
      const direction = to.clone().sub(from);
      const segment = new THREE.Mesh(new THREE.CylinderGeometry(radius * .7, radius, direction.length(), 5), legMaterial);
      segment.position.copy(from).add(to).multiplyScalar(.5);
      segment.quaternion.setFromUnitVectors(up, direction.normalize());
      cricket.add(segment);
    };
    for (const side of [-1, 1]) {
      for (const z of [.085, -.015]) {
        const start = [side * .055, .12, z];
        const knee = [side * .16, .08, z + (z > 0 ? .045 : -.035)];
        const foot = [side * .19, .025, z + (z > 0 ? .12 : -.1)];
        addSegment(start, knee, .012); addSegment(knee, foot, .009);
      }
      const hip = [side * .055, .12, -.095];
      const thigh = [side * .22, .17, -.265];
      const shin = [side * .285, .018, -.085];
      addSegment(hip, thigh, .022); addSegment(thigh, shin, .012);
      addSegment([side * .285, .018, -.085], [side * .27, .018, .035], .008);
      addSegment([side * .025, .19, .19], [side * .105, .255, .39], .006);
      addSegment([side * .105, .255, .39], [side * .16, .22, .59], .005);
    }
    const glow = new THREE.PointLight("#a2a568", .22, 1.6, 2);
    glow.position.y = .22; cricket.add(glow);
    return cricket;
  }
  function buildActors() {
    actorLayer.clear();
    actorMeshes.clear();
    for (const fragment of fragments) {
      const shard = new THREE.Group();
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(.17, 0),
        new THREE.MeshStandardMaterial({ color: "#d7efb1", emissive: "#a7d178", emissiveIntensity: 2.1, roughness: .22 })
      );
      crystal.scale.set(.75, 1.35, .7); crystal.castShadow = true; shard.add(crystal);
      const light = new THREE.PointLight("#c6e697", 2.4, 3, 2);
      light.position.y = .3; shard.add(light);
      actorLayer.add(shard); actorMeshes.set(fragment, shard);
    }
    for (const pickup of pickups) {
      const isCricket = pickup.type === "cricket";
      const item = isCricket ? createCricketModel() : new THREE.Group();
      const color = isCricket ? "#a3ad67" : "#e4d59a";
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: .32, metalness: .25 });
      if (!isCricket) {
        const core = new THREE.Mesh(new THREE.OctahedronGeometry(.2, 0), material);
        core.position.y = .3; core.castShadow = true; item.add(core);
      }
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.24, .025, 5, 22), material);
      halo.rotation.x = Math.PI / 2; halo.position.y = .15; item.add(halo);
      const light = new THREE.PointLight(color, isCricket ? .7 : 1.2, 2.5, 2); light.position.y = .35; item.add(light);
      actorLayer.add(item); actorMeshes.set(pickup, item);
    }
    const table = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: "#51402e", roughness: .9 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, .15, .82), wood);
    top.position.y = .95; top.castShadow = true; table.add(top);
    for (const x of [-.57, .57]) for (const z of [-.27, .27]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.12, .92, .12), wood);
      leg.position.set(x, .46, z); leg.castShadow = true; table.add(leg);
    }
    table.position.set(bench.x, 0, bench.y); actorLayer.add(table); actorMeshes.set(bench, table);

    const exit = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: "#72776a", roughness: .98 });
    for (const x of [-.83, .83]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(.32, .44, 3.25, 7), stone);
      pillar.position.set(x, 1.6, 0); pillar.castShadow = true; exit.add(pillar);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(.83, .33, 7, 12, Math.PI), stone);
    arch.position.y = 3.02; arch.rotation.z = Math.PI; arch.castShadow = true; exit.add(arch);
    const sealed = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 2.45), new THREE.MeshStandardMaterial({
      color: "#181e19", roughness: .92, emissive: "#10150f", emissiveIntensity: .3
    }));
    sealed.position.set(0, 1.25, -.04); exit.add(sealed);
    exit.position.set(exitDoor.x, 0, exitDoor.y); actorLayer.add(exit); actorMeshes.set(exitDoor, exit);

    const cricket = createCricketModel();
    actorLayer.add(cricket); actorMeshes.set("cricket", cricket);

    const monster = createBeardedDragon();
    actorLayer.add(monster); actorMeshes.set(dragon, monster);
  }
  function syncActors() {
    camera.position.set(player.x, 1.58 + (player.bob || 0) * .012, player.y);
    camera.rotation.set(player.pitch || 0, -player.angle - Math.PI / 2, 0);
    camera.updateMatrixWorld();
    const look = camera.getWorldDirection(new THREE.Vector3());
    torch.position.copy(camera.position);
    torchTarget.position.copy(camera.position).addScaledVector(look, 5);
    caveFill.position.set(player.x + 1.4, 1.8, player.y - 1.2);
    for (const fragment of fragments) {
      const mesh = actorMeshes.get(fragment);
      if (!mesh) continue;
      mesh.position.set(fragment.x, .48 + Math.sin(gameTime * 2.4) * .06, fragment.y);
      mesh.visible = !fragment.found;
    }
    pickups.forEach(item => {
      const mesh = actorMeshes.get(item);
      if (!mesh) return;
      mesh.position.set(item.x, .02 + Math.sin(gameTime * 2 + item.x) * .045, item.y);
      mesh.visible = !item.taken;
      mesh.rotation.y += .008;
    });
    const table = actorMeshes.get(bench);
    if (table) table.rotation.y = Math.sin(gameTime * .6) * .025;
    const exit = actorMeshes.get(exitDoor);
    if (exit) {
      exit.children.forEach(child => {
        if (child.material?.emissive) child.material.emissive.set(player.crafted ? "#587441" : "#10150f");
      });
    }
    const cricket = actorMeshes.get("cricket");
    if (cricket) {
      cricket.visible = !!cricketDrop && dragon.state !== "eating";
      if (cricketDrop) {
        cricket.position.set(cricketDrop.x, 0, cricketDrop.y);
        cricket.rotation.y = Math.sin(gameTime * 8) * .08;
      }
    }
    const monster = actorMeshes.get(dragon);
    if (monster) {
      monster.position.set(dragon.x, dragon.state === "stunned" ? -.08 : Math.sin(gameTime * 5) * .025, dragon.y);
      monster.rotation.y = Math.atan2(dragon.dx, dragon.dy);
      const { head, jaw, legs, tailSegments } = monster.userData;
      head.rotation.x = dragon.state === "chase" ? -.06 + Math.sin(gameTime * 10) * .04 :
        dragon.state === "eating" ? .1 + Math.sin(gameTime * 15) * .06 : Math.sin(gameTime * 2) * .025;
      jaw.position.y = dragon.state === "chase" ? -.13 - (.09 + Math.max(0, Math.sin(gameTime * 11)) * .13) :
        dragon.state === "eating" ? -.13 - Math.max(0, Math.sin(gameTime * 16)) * .13 : -.13;
      legs.forEach((leg, index) => { leg.rotation.x = dragon.state === "stunned" ? .75 : Math.sin(gameTime * (dragon.state === "chase" ? 13 : 4) + index * Math.PI / 2) * .25; });
      tailSegments.forEach((segment, index) => { segment.rotation.y = Math.sin(gameTime * 3 - index * .35) * (.04 + index * .012); });
    }
  }
  function drawWorld() {
    syncActors();
    renderer.render(scene, camera);
    drawMap();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
    const mapRect = mapCanvas.getBoundingClientRect();
    if (mapRect.width) {
      mapCanvas.width = Math.round(mapRect.width * dpr);
      mapCanvas.height = Math.round(mapRect.height * dpr);
      mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  window.addEventListener("resize", resize);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  function wallAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    return tx < 0 || ty < 0 || tx >= W || ty >= H || world[ty][tx] !== 0;
  }
  function canOccupy(x, y, radius = .22) {
    return !wallAt(x - radius, y - radius) && !wallAt(x + radius, y - radius) &&
      !wallAt(x - radius, y + radius) && !wallAt(x + radius, y + radius);
  }
  function moveEntity(entity, vx, vy, dt, speed, radius) {
    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len * speed * dt, ny = vy / len * speed * dt;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(nx), Math.abs(ny)) / .1));
    const stepX = nx / steps, stepY = ny / steps;
    for (let i = 0; i < steps; i++) {
      if (canOccupy(entity.x + stepX, entity.y, radius)) entity.x += stepX;
      if (canOccupy(entity.x, entity.y + stepY, radius)) entity.y += stepY;
    }
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function chooseDragonWanderTarget(from) {
    const distantNodes = wanderNodes.filter(node => dist(from, node) >= 7);
    const choices = distantNodes.length ? distantNodes : wanderNodes;
    return choices[Math.floor(Math.random() * choices.length)] || { x: from.x, y: from.y };
  }
  function angleDiff(a, b) {
    let d = (a - b + Math.PI) % (Math.PI * 2);
    if (d < 0) d += Math.PI * 2;
    return Math.abs(d - Math.PI);
  }
  function lineClear(ax, ay, bx, by) {
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(length * 7);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (wallAt(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }
  function nextPathPoint(start, target) {
    const startX = Math.floor(start.x), startY = Math.floor(start.y);
    const targetX = Math.floor(target.x), targetY = Math.floor(target.y);
    const startId = startY * W + startX, targetId = targetY * W + targetX;
    const previous = new Int16Array(W * H).fill(-2);
    const queue = new Int16Array(W * H);
    let head = 0, tail = 0;
    queue[tail++] = startId; previous[startId] = -1;
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < tail && previous[targetId] === -2) {
      const current = queue[head++], x = current % W, y = Math.floor(current / W);
      for (const [dx, dy] of directions) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || world[ny][nx] !== 0) continue;
        const id = ny * W + nx;
        if (previous[id] !== -2) continue;
        previous[id] = current; queue[tail++] = id;
      }
    }
    if (previous[targetId] === -2) return null;
    let step = targetId;
    while (previous[step] !== startId && previous[step] !== -1) step = previous[step];
    return { x: step % W + .5, y: Math.floor(step / W) + .5 };
  }
  function visibleToDragon() {
    const d = dist(player, dragon);
    const angle = Math.atan2(player.y - dragon.y, player.x - dragon.x);
    const facing = Math.atan2(dragon.dy, dragon.dx);
    return d < 9 && angleDiff(angle, facing) < 1.16 && lineClear(dragon.x, dragon.y, player.x, player.y);
  }
  function notice(text, danger = false) {
    ui.toast.textContent = text;
    ui.toast.classList.toggle("danger", danger);
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 2300);
  }
  function playTone(freq, duration, type = "sine", volume = .1) {
    if (!audio || !soundOn) return;
    const osc = audio.context.createOscillator(), gain = audio.context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audio.context.currentTime);
    gain.gain.setValueAtTime(volume, audio.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.context.currentTime + duration);
    osc.connect(gain); gain.connect(audio.master); osc.start(); osc.stop(audio.context.currentTime + duration);
  }
  function audioDistanceGain(distance) {
    const proximity = THREE.MathUtils.clamp(1 - distance / 14, 0, 1);
    return .1 + .9 * proximity * proximity;
  }
  function setupAudio() {
    if (audio) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = soundOn ? .72 : 0;
    master.connect(context.destination);
    const low = context.createOscillator(), lowGain = context.createGain();
    low.type = "sine"; low.frequency.value = 48; lowGain.gain.value = .045;
    low.connect(lowGain); lowGain.connect(master); low.start();
    const hum = context.createOscillator(), humGain = context.createGain();
    hum.type = "triangle"; hum.frequency.value = 73; humGain.gain.value = .009;
    hum.connect(humGain); humGain.connect(master); hum.start();
    const threat = context.createOscillator(), threatGain = context.createGain();
    threat.type = "sawtooth"; threat.frequency.value = 58; threatGain.gain.value = 0;
    threat.connect(threatGain); threatGain.connect(master); threat.start();
    const beat = context.createOscillator(), beatGain = context.createGain();
    beat.type = "sine"; beat.frequency.value = 38; beatGain.gain.value = 0;
    beat.connect(beatGain); beatGain.connect(master); beat.start();
    audio = { context, master, threatGain, beatGain, lastBeat: 0 };
  }
  function showStartupError(message, error) {
    console.error(message, error);
    const errorBox = $("#startup-error");
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    $("#start-button").disabled = true;
  }
  function startGame() {
    if (started && !ended) return;
    try {
      buildWorld();
      buildActors();
    } catch (error) {
      showStartupError("3D 동굴을 시작하지 못했습니다. 페이지를 새로고침해 다시 시도하세요.", error);
      return;
    }
    started = true; paused = false; ended = false; gameTime = 0;
    document.body.classList.add("game-active");
    document.body.classList.remove("game-ended");
    clearHeldInput();
    ui.start.classList.add("hidden"); ui.end.classList.add("hidden"); ui.pause.classList.add("hidden");
    $("#crosshair").classList.add("visible");
    try {
      setupAudio();
      if (audio) audio.context.resume().catch(error => console.warn("Game audio is unavailable", error));
    } catch (error) {
      console.warn("Game audio is unavailable", error);
    }
    document.querySelectorAll(".key-piece").forEach(piece => piece.classList.remove("found"));
    document.querySelectorAll(".key-join").forEach(join => join.classList.remove("active"));
    document.querySelectorAll(".objective-row").forEach(row => row.classList.remove("done"));
    ui.frag.textContent = "0/3"; ui.craft.textContent = "○"; ui.exit.textContent = "○";
    ui.cricket.textContent = "0"; ui.flash.textContent = "0";
    ui.craftStatus.className = "craft-status"; ui.craftStatus.innerHTML = "<span>⌁</span> 조각을 모은 뒤 작업대에서 조합하세요";
    ui.keyState.textContent = "미완성";
    ui.hint.textContent = "동굴 어딘가에 흩어진 열쇠 조각 3개를 찾으세요.";
    ui.healthBar.style.width = "100%"; ui.healthLabel.textContent = "건강함";
    ui.alert.classList.remove("alerted"); ui.alert.querySelector("b").textContent = "안전";
    player.inventory = { cricket: 0, flash: 0 }; player.fragments = 0; player.crafted = false; player.noise = 0;
    selectedItem = "cricket"; updateInventorySelection();
    lastTime = performance.now();
    notice("조각 3개를 찾아 작업대에서 열쇠를 조립하세요.");
  }
  function endGame(won) {
    ended = true; paused = false; ui.pause.classList.add("hidden");
    document.body.classList.add("game-ended");
    $("#crosshair").classList.remove("visible");
    mouseLookPointer = null;
    canvas.classList.remove("look-active");
    ui.end.classList.remove("hidden");
    $("#end-eyebrow").innerHTML = won ? "<span></span> 생존 기록 · 탈출 성공" : "<span></span> 생존 기록 · 탐험 종료";
    $("#end-title").textContent = won ? "동굴을 빠져나왔습니다" : "삐돌이에게 붙잡혔습니다";
    $("#end-copy").textContent = won
      ? "차가운 바깥 공기가 폐를 채운다. 삐돌이의 울음은 저 아래, 어둠 속에 남았다."
      : "어둠이 다시 조용해졌다. 열쇠 조각은 그대로 동굴에 남아 있다.";
    if (audio) audio.threatGain.gain.setTargetAtTime(0, audio.context.currentTime, .35);
    playTone(won ? 440 : 62, won ? 1.1 : .8, won ? "sine" : "triangle", .12);
  }
  function togglePause(force) {
    if (!started || ended) return;
    paused = typeof force === "boolean" ? force : !paused;
    clearHeldInput();
    ui.pause.classList.toggle("hidden", !paused);
    if (paused) audio?.context.suspend(); else audio?.context.resume();
  }
  function toggleMap() {
    mapOpen = !mapOpen;
    ui.map.classList.toggle("visible", mapOpen);
    if (mapOpen) drawMap();
  }
  function updateInventorySelection() {
    document.querySelectorAll(".item-card").forEach(card => card.classList.toggle("selected", card.dataset.item === selectedItem));
  }
  function chooseItem(type) {
    selectedItem = type;
    updateInventorySelection();
    const name = type === "cricket" ? "귀뚜라미 미끼" : "섬광탄";
    notice(`${name} 선택됨`);
  }
  function useItem() {
    if (!started || paused || ended) return;
    const type = selectedItem;
    if (player.inventory[type] <= 0) { notice("사용할 도구가 없습니다. 동굴을 살펴보세요.", true); return; }
    if (type === "cricket") {
      const distances = [1.8, 1.3, .8, 0];
      let point = null;
      for (const distance of distances) {
        const x = player.x + player.dx * distance, y = player.y + player.dy * distance;
        if (!wallAt(x, y)) { point = { x, y }; break; }
      }
      if (!point) { notice("귀뚜라미를 놓을 바닥이 없습니다.", true); return; }
      player.inventory.cricket--;
      cricketDrop = { ...point, time: 20 };
      notice("귀뚜라미를 던졌습니다. 삐돌이가 먹이를 쫓아갑니다.");
      playTone(1650, .07, "sine", .025); setTimeout(() => playTone(1920, .07, "sine", .025), 110);
    } else {
      if (dist(player, dragon) > 5.4 || !lineClear(player.x, player.y, dragon.x, dragon.y)) {
        notice("삐돌이가 너무 멀거나 시야 밖에 있습니다.", true); return;
      }
      player.inventory.flash--;
      dragon.stun = 3.4; dragon.state = "stunned"; dragon.suspicion = 0; dragon.searchTime = 0;
      notice("섬광탄이 터졌습니다. 지금 도망치세요!", true);
      playTone(1040, .12, "square", .09); setTimeout(() => playTone(720, .3, "sine", .06), 100);
    }
    updateUI();
  }
  function nearbyInteraction() {
    if (!started || paused || ended) return null;
    const choices = [];
    const reachable = (target, range) => {
      const dx = target.x - player.x, dy = target.y - player.y;
      return Math.hypot(dx, dy) < range && dx * player.dx + dy * player.dy > -.2 && lineClear(player.x, player.y, target.x, target.y);
    };
    fragments.forEach((f, index) => { if (!f.found && reachable(f, .85)) choices.push({ d: dist(player, f), type: "fragment", target: f, index }); });
    pickups.forEach(p => { if (!p.taken && reachable(p, .82)) choices.push({ d: dist(player, p), type: "pickup", target: p }); });
    if (reachable(bench, 1.25)) choices.push({ d: dist(player, bench), type: "bench", target: bench });
    if (reachable(exitDoor, 1.35)) choices.push({ d: dist(player, exitDoor), type: "exit", target: exitDoor });
    choices.sort((a, b) => a.d - b.d);
    return choices[0] || null;
  }
  function interact() {
    const target = nearbyInteraction();
    if (!target) { notice("주변에 상호작용할 것이 없습니다."); return; }
    if (target.type === "fragment") {
      target.target.found = true; player.fragments++;
      document.querySelector(`[data-piece="${target.index}"]`).classList.add("found");
      document.querySelectorAll(".key-join")[target.index < 2 ? target.index : 1].classList.add("active");
      playTone(660 + player.fragments * 90, .28, "sine", .08);
      notice(`열쇠 조각 ${player.fragments}/3 획득`);
      ui.hint.textContent = player.fragments === 3 ? "조각을 모두 찾았습니다. 갈림길의 작업대에서 조합하세요." : `열쇠 조각 ${player.fragments}/3. 나머지 조각의 빛을 찾아보세요.`;
    } else if (target.type === "pickup") {
      const item = target.target;
      item.taken = true; player.inventory[item.type]++;
      playTone(item.type === "cricket" ? 420 : 800, .16, "sine", .06);
      notice(item.type === "cricket" ? "귀뚜라미 미끼를 챙겼습니다." : "섬광탄을 챙겼습니다.");
    } else if (target.type === "bench") {
      if (player.fragments < 3) {
        notice(`열쇠 조각이 ${3 - player.fragments}개 더 필요합니다.`, true);
      } else if (!player.crafted) {
        player.crafted = true;
        ui.hint.textContent = "열쇠가 완성됐습니다. 남동쪽 출구로 향하세요.";
        notice("열쇠 조각을 맞췄습니다. 출구를 찾아 탈출하세요!");
        ui.craftStatus.className = "craft-status done";
        ui.craftStatus.innerHTML = "<span>✦</span> 오래된 열쇠가 완성되었습니다";
        playTone(392, .18, "sine", .08); setTimeout(() => playTone(523, .35, "sine", .07), 120);
      } else {
        notice("열쇠가 완성됐습니다. 출구를 찾아가세요.");
      }
    } else if (target.type === "exit") {
      if (!player.crafted) notice("봉인을 풀려면 완성된 열쇠가 필요합니다.", true);
      else { ui.exit.textContent = "✓"; document.querySelectorAll(".objective-row")[2].classList.add("done"); endGame(true); }
    }
    updateUI();
  }
  function updateUI() {
    ui.frag.textContent = `${player.fragments}/3`;
    ui.craft.textContent = player.crafted ? "✓" : player.fragments === 3 ? "!" : "○";
    ui.exit.textContent = player.crafted ? "!" : "○";
    document.querySelectorAll(".objective-row")[0].classList.toggle("done", player.fragments === 3);
    document.querySelectorAll(".objective-row")[1].classList.toggle("done", player.crafted);
    if (player.fragments === 3 && !player.crafted) {
      ui.craftStatus.className = "craft-status ready";
      ui.craftStatus.innerHTML = "<span>✦</span> 작업대에서 조각을 조합할 수 있습니다";
      ui.keyState.textContent = "조합 가능";
    } else if (player.crafted) {
      ui.keyState.textContent = "완성";
      ui.hint.textContent = "남동쪽 출구에서 E를 눌러 탈출하세요.";
    }
    ui.cricket.textContent = player.inventory.cricket;
    ui.flash.textContent = player.inventory.flash;
  }

  function update(dt) {
    if (!started || paused || ended) return;
    gameTime += dt;
    const now = performance.now();
    // Share one lease so holding a diagonal doesn't expire either key independently.
    if (lastHeldControlInputAt && now - lastHeldControlInputAt > 2500) {
      heldControlKeys.forEach(key => { keys.delete(key); keysDown.delete(key); });
      lastHeldControlInputAt = 0;
    }
    player.hurt = Math.max(0, player.hurt - dt);
    if (keys.has("arrowleft")) player.angle -= 2.15 * dt;
    if (keys.has("arrowright")) player.angle += 2.15 * dt;
    player.dx = Math.cos(player.angle); player.dy = Math.sin(player.angle);
    let forward = (keys.has("w") ? 1 : 0) - (keys.has("s") ? 1 : 0);
    let strafe = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
    const moving = Math.hypot(forward, strafe) > 0;
    const running = moving && (keys.has("shift") || keys.has("shiftleft") || keys.has("shiftright"));
    player.bob = moving ? Math.sin(gameTime * (running ? 12 : 8)) * (running ? 5 : 2.5) : player.bob * .8;
    if (moving) {
      const n = Math.hypot(forward, strafe); forward /= n; strafe /= n;
      const vx = player.dx * forward - player.dy * strafe;
      const vy = player.dy * forward + player.dx * strafe;
      moveEntity(player, vx, vy, dt, running ? 4.5 : 2.8, .23);
      player.footsteps += dt * (running ? 2.6 : 1.55);
      if (player.footsteps > 1) {
        player.footsteps = 0;
        if (audio && soundOn) playTone(running ? 62 : 83, .06, "triangle", running ? .035 : .014);
      }
    }
    if (cricketDrop && dragon.state !== "lured" && dragon.state !== "eating") {
      cricketDrop.time -= dt;
      if (cricketDrop.time <= 0) cricketDrop = null;
    }
    const cricketAttracts = !!cricketDrop && dist(dragon, cricketDrop) < 11;
    const sees = !cricketAttracts && visibleToDragon();
    const runningNoise = running && dist(player, dragon) < 11 && lineClear(player.x, player.y, dragon.x, dragon.y);
    const distractedByCricket = cricketAttracts || dragon.state === "lured" || dragon.state === "eating";
    player.noise += ((running ? 1 : moving ? .2 : 0) - player.noise) * Math.min(1, dt * 3);
    let threat = Math.max(0, 1 - dist(player, dragon) / 10);
    if (!distractedByCricket && (sees || runningNoise)) dragon.suspicion = Math.min(1, dragon.suspicion + dt * (runningNoise ? .48 : .34));
    else if (!distractedByCricket) dragon.suspicion = Math.max(0, dragon.suspicion - dt * .12);
    if (dragon.suspicion > .75 && dragon.state !== "chase" && dragon.state !== "stunned" &&
      dragon.state !== "lured" && dragon.state !== "eating") {
      dragon.state = "chase"; dragon.searchTime = 7; dragon.path = null; dragon.pathTimer = 0;
      notice("삐돌이가 당신을 발견했습니다. 도망치세요!", true);
      playTone(155, .8, "sawtooth", .09 * audioDistanceGain(dist(player, dragon)));
    }
    if (dragon.state === "stunned") {
      dragon.stun -= dt;
      if (dragon.stun <= 0) {
        dragon.state = "patrol"; dragon.suspicion = 0; dragon.path = null; dragon.pathTimer = 0;
        notice("삐돌이가 다시 움직입니다.", true);
      }
    } else if (dragon.state === "eating") {
      dragon.eatTimer -= dt;
      if (dragon.eatTimer <= 0) {
        dragon.state = "patrol"; dragon.suspicion = 0; dragon.path = null; dragon.pathTimer = 0;
        notice("삐돌이가 귀뚜라미를 다 먹고 다시 움직입니다.");
      }
    } else if (cricketAttracts) {
      if (dragon.state !== "lured") { dragon.path = null; dragon.pathTimer = 0; }
      dragon.state = "lured";
      dragon.dx = cricketDrop.x - dragon.x; dragon.dy = cricketDrop.y - dragon.y;
      if (Math.floor(dragon.x) === Math.floor(cricketDrop.x) && Math.floor(dragon.y) === Math.floor(cricketDrop.y)) {
        moveEntity(dragon, dragon.dx, dragon.dy, dt, 2.6, .28);
      } else {
        dragon.pathTimer -= dt;
        if (dragon.pathTimer <= 0 || !dragon.path) {
          dragon.path = nextPathPoint(dragon, cricketDrop);
          dragon.pathTimer = .35;
        }
        if (dragon.path) {
          moveEntity(dragon, dragon.path.x - dragon.x, dragon.path.y - dragon.y, dt, 2.6, .28);
          if (dist(dragon, dragon.path) < .16) { dragon.path = null; dragon.pathTimer = 0; }
        }
      }
      if (dist(dragon, cricketDrop) < .55) {
        dragon.state = "eating"; dragon.eatTimer = 1.8; dragon.path = null;
        cricketDrop = null;
        notice("삐돌이가 귀뚜라미를 먹고 있습니다. 조용히 지나가세요.");
        playTone(110, .1, "triangle", .035);
      }
      dragon.suspicion = Math.max(0, dragon.suspicion - dt * .5);
    } else if (dragon.state === "chase") {
      dragon.searchTime -= dt;
      dragon.pathTimer -= dt;
      if (sees || runningNoise) dragon.searchTime = 6;
      const tx = player.x - dragon.x, ty = player.y - dragon.y;
      dragon.dx = tx; dragon.dy = ty;
      if (lineClear(dragon.x, dragon.y, player.x, player.y)) {
        dragon.path = null;
        moveEntity(dragon, tx, ty, dt, running ? 3.65 : 3.35, .29);
      } else {
        if (dragon.pathTimer <= 0 || !dragon.path) {
          dragon.path = nextPathPoint(dragon, player);
          dragon.pathTimer = .45;
        }
        if (dragon.path) moveEntity(dragon, dragon.path.x - dragon.x, dragon.path.y - dragon.y, dt, 2.8, .29);
      }
      if (dragon.searchTime <= 0 && !sees) {
        dragon.state = "patrol"; dragon.suspicion = .2; dragon.path = null; dragon.pathTimer = 0;
        notice("발소리가 멀어졌습니다. 숨을 고르세요.");
      }
    } else {
      dragon.state = "patrol";
      if (!dragon.wanderTarget || dist(dragon, dragon.wanderTarget) < .5) {
        dragon.wanderTarget = chooseDragonWanderTarget(dragon);
        dragon.path = null; dragon.pathTimer = 0;
      }
      const target = dragon.wanderTarget;
      dragon.pathTimer -= dt;
      if (dragon.pathTimer <= 0 || !dragon.path) {
        dragon.path = nextPathPoint(dragon, target);
        dragon.pathTimer = .35;
      }
      if (dragon.path) {
        dragon.dx = dragon.path.x - dragon.x; dragon.dy = dragon.path.y - dragon.y;
        moveEntity(dragon, dragon.dx, dragon.dy, dt, 1.35, .29);
        if (dist(dragon, dragon.path) < .16) { dragon.path = null; dragon.pathTimer = 0; }
      } else {
        dragon.wanderTarget = chooseDragonWanderTarget(dragon);
      }
    }
    const d = dist(player, dragon);
    if (d < .74 && dragon.state !== "stunned" && dragon.state !== "eating") {
      if (player.hurt <= 0) {
        player.health -= 34; player.hurt = 1.15;
        notice("삐돌이의 발톱에 긁혔습니다!", true);
        playTone(84, .24, "sawtooth", .1 * audioDistanceGain(d));
        if (player.health <= 0) endGame(false);
      }
    }
    ui.healthBar.style.width = `${Math.max(0, player.health)}%`;
    ui.healthLabel.textContent = player.health > 65 ? "건강함" : player.health > 30 ? "부상" : "위험";
    threat = Math.max(threat, dragon.state === "chase" ? .75 : dragon.suspicion * .8);
    ui.threatBar.style.width = `${Math.round(threat * 100)}%`;
    ui.threatBar.style.background = threat > .55 ? "#d16d62" : threat > .25 ? "#c39a61" : "#91aa7f";
    ui.threatLabel.textContent = dragon.state === "chase" ? "추격 중" : threat > .55 ? "가까이 있음" : threat > .2 ? "접근 중" : "멀리 있음";
    ui.noiseBar.style.width = `${Math.round(player.noise * 100)}%`;
    ui.noiseLabel.textContent = running ? "큼" : moving ? "작음" : "낮음";
    const alert = dragon.state === "chase" || dragon.suspicion > .45;
    ui.alert.classList.toggle("alerted", alert);
    ui.alert.querySelector("b").textContent = dragon.state === "chase" ? "발견됨" : alert ? "의심 중" : "안전";
    if (audio) {
      const distanceGain = audioDistanceGain(d);
      audio.threatGain.gain.setTargetAtTime((dragon.state === "chase" ? .045 : alert ? .018 : 0) * distanceGain, audio.context.currentTime, .3);
      audio.beatGain.gain.setTargetAtTime((dragon.state === "chase" ? .05 : 0) * distanceGain, audio.context.currentTime, .12);
      if (dragon.state === "chase" && gameTime - audio.lastBeat > .72) {
        audio.lastBeat = gameTime;
        playTone(49, .15, "sine", .12 * distanceGain);
      }
    }
    const prompt = nearbyInteraction();
    ui.prompt.classList.toggle("visible", !!prompt);
    if (prompt) {
      ui.prompt.querySelector("span").textContent = prompt.type === "fragment" ? "열쇠 조각 줍기" :
        prompt.type === "pickup" ? (prompt.target.type === "cricket" ? "귀뚜라미 미끼 줍기" : "섬광탄 줍기") :
        prompt.type === "bench" ? "열쇠 조합하기" : "출구 열기";
    }
    let zone = rooms.find(r => player.x >= r.x && player.x < r.x + r.w && player.y >= r.y && player.y < r.y + r.h);
    ui.location.textContent = zone ? zone.name : "어두운 통로";
  }

  const FIELD_OF_VIEW = .94;
  function castRay(cameraX, angle) {
    const planeLength = Math.tan(FIELD_OF_VIEW / 2);
    const dirX = Math.cos(angle), dirY = Math.sin(angle);
    const rayX = dirX - dirY * planeLength * cameraX;
    const rayY = dirY + dirX * planeLength * cameraX;
    let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
    const deltaX = Math.abs(1 / (rayX || .000001)), deltaY = Math.abs(1 / (rayY || .000001));
    const stepX = rayX < 0 ? -1 : 1, stepY = rayY < 0 ? -1 : 1;
    let sideX = (rayX < 0 ? player.x - mapX : mapX + 1 - player.x) * deltaX;
    let sideY = (rayY < 0 ? player.y - mapY : mapY + 1 - player.y) * deltaY;
    let side = 0, loops = 0;
    while (loops++ < 64) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (wallAt(mapX, mapY)) break;
    }
    const distance = Math.max(.08, side === 0 ? (mapX - player.x + (1 - stepX) / 2) / rayX : (mapY - player.y + (1 - stepY) / 2) / rayY);
    const hit = side === 0 ? player.y + distance * rayY : player.x + distance * rayX;
    return { distance: Math.abs(distance), side, mapX, mapY, wallX: hit - Math.floor(hit), rayX, rayY, dirX, dirY };
  }
  function drawLegacyWorld() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resolution = Math.max(2, Math.round(2 / dpr));
    const horizon = height * .49 + (player.bob || 0);
    const projection = width / (2 * Math.tan(FIELD_OF_VIEW / 2));
    ctx.clearRect(0, 0, width, height);
    const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
    ceiling.addColorStop(0, "#080b0a"); ceiling.addColorStop(.75, "#171b17"); ceiling.addColorStop(1, "#252a23");
    ctx.fillStyle = ceiling; ctx.fillRect(0, 0, width, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, height);
    floor.addColorStop(0, "#45483c"); floor.addColorStop(.14, "#33372e"); floor.addColorStop(1, "#111512");
    ctx.fillStyle = floor; ctx.fillRect(0, horizon, width, height - horizon);

    ctx.strokeStyle = "#b8b69312"; ctx.lineWidth = 1;
    for (let distance = 1.1; distance < 15; distance += .75) {
      const y = horizon + projection * .48 / distance;
      if (y > height) break;
      ctx.globalAlpha = Math.max(.08, .42 - distance * .025);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const rayCount = Math.ceil(width / resolution);
    const depth = new Float32Array(rayCount);
    for (let i = 0; i < rayCount; i++) {
      const x = i * resolution;
      const cameraX = (2 * x / width) - 1;
      const ray = castRay(cameraX, player.angle);
      depth[i] = ray.distance;
      const wallHeight = Math.min(height * 2, projection / ray.distance);
      const top = Math.max(0, horizon - wallHeight * .56);
      const bottom = Math.min(height, horizon + wallHeight * .44);
      const fog = Math.max(.12, 1 - ray.distance / 13);
      const beam = Math.max(0, 1 - Math.abs(cameraX) * 1.3);
      const faceShade = ray.side ? .74 : 1;
      const tex = Math.floor(ray.wallX * 8);
      const variation = ((ray.mapX * 17 + ray.mapY * 31 + tex * 7) % 13 + 13) % 13;
      const light = (.17 + beam * .46) * fog * faceShade;
      const r = Math.round((23 + variation * 1.1) * (1 - fog * .2) + 45 * light);
      const g = Math.round((29 + variation * .9) * (1 - fog * .2) + 49 * light);
      const b = Math.round((25 + variation * .7) * (1 - fog * .2) + 36 * light);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, top, resolution + 1, bottom - top);
      if (wallHeight > 23) {
        ctx.fillStyle = `rgba(195, 190, 163, ${.035 * fog})`;
        const seam = top + wallHeight * (.31 + (ray.mapY % 3) * .08);
        ctx.fillRect(x, seam, resolution + 1, Math.max(1, wallHeight * .006));
        if (ray.wallX < .04 || ray.wallX > .96) {
          ctx.fillStyle = `rgba(5, 8, 6, ${.19 * fog})`;
          ctx.fillRect(x, top, 1, bottom - top);
        }
      }
      ctx.fillStyle = `rgba(4, 7, 5, ${Math.min(.48, ray.distance * .036)})`;
      ctx.fillRect(x, 0, resolution + 1, height);
    }

    const objects = [];
    fragments.forEach((item, index) => { if (!item.found) objects.push({ ...item, kind: "shard", index }); });
    pickups.forEach(item => { if (!item.taken) objects.push({ ...item, kind: "pickup" }); });
    objects.push({ ...bench, kind: "bench" }, { ...exitDoor, kind: "exit" }, { ...dragon, kind: "dragon" });
    if (cricketDrop) objects.push({ ...cricketDrop, kind: "cricket" });
    objects.sort((a, b) => Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y));
    objects.forEach(object => drawSprite(object, width, height, horizon, projection, resolution, depth));

    const vignette = ctx.createRadialGradient(width / 2, height * .48, height * .16, width / 2, height * .48, width * .73);
    vignette.addColorStop(0, "#00000000"); vignette.addColorStop(.72, "#03050414"); vignette.addColorStop(1, "#030504bb");
    ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
    if (dragon.state === "chase") {
      ctx.fillStyle = `rgba(115, 26, 22, ${.045 + Math.sin(gameTime * 8) * .018})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (player.hurt > 0) {
      ctx.fillStyle = `rgba(145, 30, 21, ${.18 * player.hurt})`; ctx.fillRect(0, 0, width, height);
    }
    drawMap();
  }
  function drawSprite(object, width, height, horizon, projection, resolution, depth) {
    const dx = object.x - player.x, dy = object.y - player.y;
    const forward = dx * player.dx + dy * player.dy;
    if (forward <= .18) return;
    const side = dx * -player.dy + dy * player.dx;
    const centerX = width / 2 + side * projection / forward;
    if (centerX < -width * .2 || centerX > width * 1.2) return;
    const rayIndex = Math.min(depth.length - 1, Math.max(0, Math.floor(centerX / resolution)));
    if (forward > depth[rayIndex] + .25) return;
    const scale = projection / forward;
    const ground = horizon + projection * .48 / forward;
    const alpha = Math.min(1, Math.max(.28, 1.1 - forward / 15));
    ctx.save(); ctx.globalAlpha = alpha;
    if (object.kind === "dragon") drawDragonSprite(centerX, ground, scale);
    if (object.kind === "shard") drawShardSprite(centerX, ground, scale, object.index);
    if (object.kind === "pickup") drawPickupSprite(centerX, ground, scale, object.type);
    if (object.kind === "bench") drawBenchSprite(centerX, ground, scale);
    if (object.kind === "exit") drawExitSprite(centerX, ground, scale);
    if (object.kind === "cricket") drawCricketSprite(centerX, ground, scale);
    ctx.restore();
  }
  function drawDragonSprite(x, ground, scale) {
    const size = Math.min(scale, canvas.clientHeight * 1.35);
    const headY = ground - size * .82;
    const bob = dragon.state === "chase" ? Math.sin(gameTime * 12) * size * .018 : Math.sin(gameTime * 2.4) * size * .012;
    const glow = ctx.createRadialGradient(x, ground - size * .48, 1, x, ground - size * .48, size * .85);
    glow.addColorStop(0, dragon.state === "chase" ? "#c43a3247" : "#d9e3c92b"); glow.addColorStop(1, "#cad9b000");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(x, ground - size * .5, size * .75, size * .75, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#080a09aa"; ctx.beginPath(); ctx.ellipse(x, ground - size * .04, size * .48, size * .09, 0, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = "#c7c8bb"; ctx.lineCap = "round"; ctx.lineWidth = size * .075;
    ctx.beginPath(); ctx.moveTo(x - size * .2, ground - size * .35 + bob); ctx.quadraticCurveTo(x - size * .58, ground - size * .22, x - size * .73, ground - size * .33); ctx.quadraticCurveTo(x - size * .84, ground - size * .39, x - size * .78, ground - size * .47); ctx.stroke();
    ctx.fillStyle = "#d8d7ca";
    for (let i = 0; i < 9; i++) {
      const sx = x - size * .36 + i * size * .09, sy = ground - size * (.56 + (i % 3) * .028) + bob;
      ctx.beginPath(); ctx.moveTo(sx - size * .045, sy + size * .05); ctx.lineTo(sx, sy - size * (.08 + (i % 2) * .025)); ctx.lineTo(sx + size * .05, sy + size * .055); ctx.fill();
    }
    ctx.fillStyle = "#bfc0b4"; ctx.beginPath(); ctx.ellipse(x, ground - size * .35 + bob, size * .4, size * .24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e5e2d6"; ctx.beginPath(); ctx.ellipse(x, headY + bob, size * .27, size * .22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9c8bb";
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + side * size * .13, headY + size * .08 + bob);
      ctx.lineTo(x + side * size * .31, headY + size * .22 + bob);
      ctx.lineTo(x + side * size * .37, headY + size * .1 + bob);
      ctx.lineTo(x + side * size * .26, headY - size * .04 + bob); ctx.fill();
    }
    for (const side of [-1, 1]) {
      ctx.fillStyle = "#2a2925"; ctx.beginPath(); ctx.ellipse(x + side * size * .115, headY - size * .025 + bob, size * .052, size * .065, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d5a076"; ctx.beginPath(); ctx.arc(x + side * size * .105, headY - size * .025 + bob, size * .021, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#10110f"; ctx.beginPath(); ctx.arc(x + side * size * .105, headY - size * .025 + bob, size * .009, 0, Math.PI * 2); ctx.fill();
    }
    const open = dragon.state === "chase" ? .16 + Math.max(0, Math.sin(gameTime * 11)) * .14 :
      dragon.state === "eating" ? .07 + Math.max(0, Math.sin(gameTime * 16)) * .1 : .035;
    ctx.fillStyle = "#f0ede2"; ctx.beginPath(); ctx.ellipse(x, headY + size * .105 + bob, size * .18, size * .09, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dragon.state === "chase" ? "#28100f" : dragon.state === "eating" ? "#4b3027" : "#7c4c43";
    ctx.beginPath(); ctx.ellipse(x, headY + size * .14 + bob, size * .125, size * open, 0, 0, Math.PI * 2); ctx.fill();
    if (dragon.state === "chase") {
      ctx.fillStyle = "#f2eade";
      for (let i = 0; i < 5; i++) {
        const toothX = x - size * .09 + i * size * .045;
        ctx.beginPath(); ctx.moveTo(toothX, headY + size * .105 + bob); ctx.lineTo(toothX + size * .018, headY + size * .155 + bob); ctx.lineTo(toothX + size * .036, headY + size * .105 + bob); ctx.fill();
      }
      ctx.strokeStyle = "#b8584e"; ctx.lineWidth = Math.max(1, size * .01);
      ctx.beginPath(); ctx.moveTo(x - size * .09, headY + size * .25 + bob); ctx.quadraticCurveTo(x, headY + size * .32 + bob, x + size * .09, headY + size * .25 + bob); ctx.stroke();
    }
    ctx.strokeStyle = "#dedbd0"; ctx.lineWidth = size * .035;
    for (let i = 0; i < 7; i++) {
      const bx = x - size * .25 + i * size * .083;
      ctx.beginPath(); ctx.moveTo(bx, headY + size * .1 + bob); ctx.lineTo(bx - size * .018, headY + size * (.19 + (i % 2) * .03) + bob); ctx.stroke();
    }
    ctx.strokeStyle = "#d0cfc2"; ctx.lineWidth = size * .06;
    ctx.beginPath(); ctx.moveTo(x - size * .2, ground - size * .3); ctx.lineTo(x - size * .28, ground - size * .06); ctx.moveTo(x + size * .2, ground - size * .3); ctx.lineTo(x + size * .28, ground - size * .06); ctx.stroke();
    if (dragon.state === "stunned") {
      ctx.strokeStyle = "#e6ce82"; ctx.lineWidth = Math.max(1, size * .012);
      for (let i = 0; i < 3; i++) { const a = gameTime * 3 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * size * .2, headY - size * .2 + Math.sin(a) * size * .04, size * .035, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
  function drawShardSprite(x, ground, scale, index) {
    const size = Math.max(4, Math.min(scale * .11, canvas.clientHeight * .12));
    const float = Math.sin(gameTime * 3 + index) * size * .14;
    ctx.fillStyle = "#c8ed9e"; ctx.shadowColor = "#b9e490"; ctx.shadowBlur = size;
    ctx.beginPath(); ctx.moveTo(x, ground - size * 2 + float); ctx.lineTo(x + size * .54, ground - size + float);
    ctx.lineTo(x, ground + float); ctx.lineTo(x - size * .54, ground - size + float); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }
  function drawPickupSprite(x, ground, scale, type) {
    const size = Math.max(5, Math.min(scale * .09, canvas.clientHeight * .1));
    const color = type === "cricket" ? "#a3ad67" : "#ead89a";
    ctx.fillStyle = "#090b09"; ctx.beginPath(); ctx.ellipse(x, ground, size, size * .3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = size * .7;
    if (type === "cricket") { ctx.beginPath(); ctx.arc(x, ground - size * .45, size * .4, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.moveTo(x, ground - size * 1.2); ctx.lineTo(x + size * .45, ground - size * .7); ctx.lineTo(x, ground - size * .2); ctx.lineTo(x - size * .45, ground - size * .7); ctx.closePath(); ctx.fill(); }
    ctx.shadowBlur = 0;
  }
  function drawBenchSprite(x, ground, scale) {
    const size = Math.max(12, Math.min(scale * .46, canvas.clientHeight * .55));
    ctx.fillStyle = "#16140f"; ctx.fillRect(x - size * .4, ground - size * .2, size * .8, size * .2);
    ctx.fillStyle = "#594b39"; ctx.fillRect(x - size * .38, ground - size * .7, size * .76, size * .48);
    ctx.fillStyle = "#9c8360"; ctx.fillRect(x - size * .46, ground - size * .81, size * .92, size * .14);
    ctx.fillStyle = "#353025"; ctx.fillRect(x - size * .32, ground - size * .23, size * .09, size * .23); ctx.fillRect(x + size * .23, ground - size * .23, size * .09, size * .23);
    if (player.fragments === 3 && !player.crafted) { ctx.fillStyle = "#d8e6ab"; ctx.shadowColor = "#d8e6ab"; ctx.shadowBlur = size * .4; ctx.fillRect(x - 2, ground - size * .9, 4, 3); ctx.shadowBlur = 0; }
  }
  function drawExitSprite(x, ground, scale) {
    const size = Math.max(18, Math.min(scale * .95, canvas.clientHeight * .9));
    ctx.fillStyle = "#070908"; ctx.beginPath(); ctx.ellipse(x, ground, size * .48, size * .12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#727568"; ctx.beginPath(); ctx.moveTo(x - size * .48, ground); ctx.lineTo(x - size * .48, ground - size * .62);
    ctx.quadraticCurveTo(x, ground - size * 1.35, x + size * .48, ground - size * .62); ctx.lineTo(x + size * .48, ground); ctx.closePath(); ctx.fill();
    ctx.fillStyle = player.crafted ? "#a7bd82" : "#181d19";
    ctx.beginPath(); ctx.moveTo(x - size * .34, ground); ctx.lineTo(x - size * .34, ground - size * .55);
    ctx.quadraticCurveTo(x, ground - size * 1.05, x + size * .34, ground - size * .55); ctx.lineTo(x + size * .34, ground); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#c1c3a566"; ctx.lineWidth = Math.max(1, size * .025);
    ctx.beginPath(); ctx.moveTo(x - size * .48, ground); ctx.lineTo(x - size * .48, ground - size * .62); ctx.quadraticCurveTo(x, ground - size * 1.35, x + size * .48, ground - size * .62); ctx.lineTo(x + size * .48, ground); ctx.stroke();
  }
  function drawCricketSprite(x, ground, scale) {
    const size = Math.max(7, Math.min(scale * .07, canvas.clientHeight * .12));
    const twitch = Math.sin(gameTime * 14) * size * .035;
    ctx.strokeStyle = "#a7ad72"; ctx.lineWidth = Math.max(1, size * .035);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * size * .12, ground - size * .38);
      ctx.lineTo(x + side * size * .28, ground - size * .58 + twitch);
      ctx.lineTo(x + side * size * .42, ground - size * .48 + twitch);
      ctx.moveTo(x + side * size * .05, ground - size * .35);
      ctx.lineTo(x + side * size * .24, ground - size * .16);
      ctx.moveTo(x + side * size * .08, ground - size * .35);
      ctx.lineTo(x + side * size * .29, ground - size * .12);
      ctx.moveTo(x + side * size * .01, ground - size * .57);
      ctx.quadraticCurveTo(x + side * size * .1, ground - size * .9, x + side * size * .22, ground - size * .95);
      ctx.stroke();
    }
    ctx.fillStyle = "#4c5c37"; ctx.beginPath(); ctx.ellipse(x, ground - size * .43, size * .21, size * .13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#879456"; ctx.beginPath(); ctx.ellipse(x, ground - size * .47, size * .1, size * .1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e0c27b";
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(x + side * size * .055, ground - size * .49, Math.max(1, size * .025), 0, Math.PI * 2); ctx.fill(); }
  }
  function drawMap() {
    if (!mapCanvas.clientWidth) return;
    const width = mapCanvas.clientWidth, height = mapCanvas.clientHeight;
    mapCtx.clearRect(0, 0, width, height);
    const cellW = width / W, cellH = height / H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      mapCtx.fillStyle = world[y][x] ? "#272e29" : "#697362";
      mapCtx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
    fragments.forEach(f => {
      if (!f.found) { mapCtx.fillStyle = "#d4d69a"; mapCtx.fillRect(f.x * cellW - 1, f.y * cellH - 1, 3, 3); }
    });
    const p = worldToMap(player.x, player.y, width, height);
    mapCtx.fillStyle = "#c9e6a9";
    mapCtx.beginPath();
    mapCtx.moveTo(p.x + player.dx * 4, p.y + player.dy * 4);
    mapCtx.lineTo(p.x - player.dx * 2.5 - player.dy * 2.5, p.y - player.dy * 2.5 + player.dx * 2.5);
    mapCtx.lineTo(p.x - player.dx * 2.5 + player.dy * 2.5, p.y - player.dy * 2.5 - player.dx * 2.5);
    mapCtx.closePath(); mapCtx.fill();
    mapCtx.fillStyle = "#b8ab7a"; mapCtx.fillRect(exitDoor.x * cellW - 2, exitDoor.y * cellH - 2, 4, 4);
    mapCtx.fillStyle = "#b49a7b"; mapCtx.fillRect(bench.x * cellW - 2, bench.y * cellH - 2, 4, 4);
  }
  function worldToMap(x, y, width, height) { return { x: x / W * width, y: y / H * height }; }

  function getKeyName(event) {
    if (event.code.startsWith("Key")) return event.code.slice(3).toLowerCase();
    if (event.code.startsWith("Digit")) return event.code.slice(5);
    return event.key.toLowerCase();
  }

  document.addEventListener("keydown", event => {
    const key = getKeyName(event);
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) event.preventDefault();
    if (ignoredKeysUntilRelease.has(key)) return;
    if (!started || ended || (paused && key !== "escape")) {
      ignoredKeysUntilRelease.add(key);
      return;
    }
    if (heldControlKeys.has(key)) lastHeldControlInputAt = performance.now();
    if (keysDown.has(key)) return;
    keysDown.add(key); keys.add(key);
    if (key === "escape") togglePause();
    if (key === "e") interact();
    if (key === "q") useItem();
    if (key === "m") toggleMap();
    if (key === "1") chooseItem("cricket");
    if (key === "2") chooseItem("flash");
  });
  document.addEventListener("keyup", event => {
    const key = getKeyName(event);
    ignoredKeysUntilRelease.delete(key);
    keysDown.delete(key); keys.delete(key);
    if (heldControlKeys.has(key) && ![...heldControlKeys].some(controlKey => keys.has(controlKey))) {
      lastHeldControlInputAt = 0;
    }
  });
  function clearHeldInput() {
    keysDown.forEach(key => ignoredKeysUntilRelease.add(key));
    keys.forEach(key => ignoredKeysUntilRelease.add(key));
    keys.clear(); keysDown.clear();
    lastHeldControlInputAt = 0;
    mouseLookPointer = null;
    canvas.classList.remove("look-active");
  }
  window.addEventListener("blur", () => {
    clearHeldInput();
    if (started && !ended) togglePause(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearHeldInput();
      if (started && !ended) togglePause(true);
    }
  });
  canvas.addEventListener("pointerdown", event => {
    if (!started || paused || ended || event.button !== 0 || event.pointerType !== "mouse") return;
    mouseLookPointer = event.pointerId;
    canvas.classList.add("look-active");
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  const stopMouseLook = event => {
    if (mouseLookPointer === null || (event && event.pointerId !== mouseLookPointer)) return;
    mouseLookPointer = null;
    canvas.classList.remove("look-active");
  };
  document.addEventListener("pointerup", stopMouseLook);
  document.addEventListener("pointercancel", stopMouseLook);
  canvas.addEventListener("pointermove", event => {
    if (!started || paused || ended || event.pointerId !== mouseLookPointer) return;
    player.angle += event.movementX * .0024;
    player.pitch = THREE.MathUtils.clamp((player.pitch || 0) - event.movementY * .0014, -.4, .4);
    player.dx = Math.cos(player.angle); player.dy = Math.sin(player.angle);
  });
  $("#start-button").addEventListener("click", startGame);
  $("#restart-button").addEventListener("click", startGame);
  $("#pause-button").addEventListener("click", () => togglePause());
  $("#map-toggle").addEventListener("click", toggleMap);
  $("#sound-toggle").addEventListener("click", () => {
    soundOn = !soundOn;
    $("#sound-toggle").textContent = soundOn ? "♫" : "♪";
    $("#sound-toggle").setAttribute("aria-label", soundOn ? "소리 끄기" : "소리 켜기");
    $("#sound-toggle").title = soundOn ? "소리 끄기" : "소리 켜기";
    if (audio) audio.master.gain.setTargetAtTime(soundOn ? .72 : 0, audio.context.currentTime, .08);
    if (soundOn && started) audio?.context.resume();
  });
  document.querySelectorAll(".item-card").forEach(card => card.addEventListener("click", () => chooseItem(card.dataset.item)));

  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000 || 0, .05);
    lastTime = now;
    update(dt);
    drawWorld();
    requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame(frame);
  window.dispatchEvent(new Event("cave-game-ready"));
})();
