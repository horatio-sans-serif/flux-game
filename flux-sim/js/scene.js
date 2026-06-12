// Babylon.js renderer. It does NOT decide anything -- it advances the
// deterministic engine and interpolates meshes toward the latest snapshot.
// Visual style is deliberately bright and toy-like (Wii Sports inspired):
// pastel sky, saturated turf, rounded shapes, soft shadows, emissive avatars.
(function (root) {
  "use strict";

  const F = root.Flux;
  const C = F.CONFIG;

  const TEAM = {
    A: { name: "Red", base: "#e0443e", emit: "#7a1e1a" },
    B: { name: "Blue", base: "#3e72e0", emit: "#1a3a7a" },
  };

  function hex(c) {
    return BABYLON.Color3.FromHexString(c);
  }

  function FluxScene(canvas) {
    this.canvas = canvas;
    this.engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = hex("#bfe3ff").toColor4(1); // pastel sky
    this.players = {}; // id -> {body, label}
    this.balls = {};
    this.simEngine = null;
    this.simSpeed = 1.0;
    this.playing = false;
    this.tAccum = 0;
    this.onState = null;
    this._buildStatics();
    this._buildCamera();
    this._buildLights();
    this.engine.runRenderLoop(() => this._frame());
    window.addEventListener("resize", () => this.engine.resize());
  }

  FluxScene.prototype._buildCamera = function () {
    const cam = new BABYLON.ArcRotateCamera(
      "cam",
      -Math.PI / 2,
      0.95,
      130,
      new BABYLON.Vector3(0, 0, 0),
      this.scene,
    );
    cam.attachControl(this.canvas, true);
    cam.lowerRadiusLimit = 40;
    cam.upperRadiusLimit = 260;
    cam.upperBetaLimit = 1.45;
    cam.wheelPrecision = 2;
    this.camera = cam;
  };

  FluxScene.prototype._buildLights = function () {
    const hemi = new BABYLON.HemisphericLight(
      "hemi",
      new BABYLON.Vector3(0, 1, 0),
      this.scene,
    );
    hemi.intensity = 0.85;
    hemi.groundColor = hex("#9ec7a0");
    const dir = new BABYLON.DirectionalLight(
      "dir",
      new BABYLON.Vector3(-0.5, -1, 0.4),
      this.scene,
    );
    dir.position = new BABYLON.Vector3(60, 120, -40);
    dir.intensity = 0.7;
    const sg = new BABYLON.ShadowGenerator(1024, dir);
    sg.useBlurExponentialShadowMap = true;
    sg.blurScale = 2;
    this.shadow = sg;
  };

  FluxScene.prototype._mat = function (name, base, emit) {
    const m = new BABYLON.StandardMaterial(name, this.scene);
    m.diffuseColor = hex(base);
    if (emit) m.emissiveColor = hex(emit);
    m.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    return m;
  };

  FluxScene.prototype._buildStatics = function () {
    const W = C.field.width,
      D = C.field.depth;
    // Turf
    const ground = BABYLON.MeshBuilder.CreateGround(
      "turf",
      { width: W + 24, height: D + 24 },
      this.scene,
    );
    ground.material = this._mat("turf", "#46b14e");
    ground.receiveShadows = true;
    // Boundary + center lines (thin white boxes)
    const line = (w, d, x, z) => {
      const b = BABYLON.MeshBuilder.CreateBox(
        "line",
        { width: w, height: 0.12, depth: d },
        this.scene,
      );
      b.position.set(x, 0.06, z);
      b.material = this._mat("white", "#ffffff", "#cccccc");
      return b;
    };
    const t = 0.5;
    line(W, t, 0, D / 2);
    line(W, t, 0, -D / 2);
    line(t, D, W / 2, 0);
    line(t, D, -W / 2, 0);
    line(t, D, 0, 0); // halfway line
    const ring = BABYLON.MeshBuilder.CreateTorus(
      "center",
      { diameter: 14, thickness: 0.5, tessellation: 48 },
      this.scene,
    );
    ring.position.y = 0.06;
    ring.material = this._mat("white2", "#ffffff", "#cccccc");
  };

  // Build the dynamic meshes (circles, stands, players, balls) for one match.
  FluxScene.prototype.build = function (simEngine) {
    this._clearDynamic();
    this.simEngine = simEngine;
    const snap = simEngine.snapshot();

    // Circles + stands
    this._dyn = [];
    snap.circles.forEach((c) => {
      const ring = BABYLON.MeshBuilder.CreateTorus(
        "circle",
        { diameter: c.r * 2, thickness: 0.4, tessellation: 48 },
        this.scene,
      );
      ring.position.set(c.x, 0.06, c.z);
      ring.material = this._mat("circlemat", "#f4e04d", "#7a6f10");
      this._dyn.push(ring);
      const pole = BABYLON.MeshBuilder.CreateCylinder(
        "pole",
        { height: C.circle.standHeight, diameter: 0.6 },
        this.scene,
      );
      pole.position.set(c.x, C.circle.standHeight / 2, c.z);
      pole.material = this._mat("polemat", "#cfcfcf", "#444");
      this.shadow.addShadowCaster(pole);
      this._dyn.push(pole);
      // Basket: an orange rim with a hanging wireframe net, like a hoop.
      const rimD = C.circle.pocketRadius * 2.0;
      const rim = BABYLON.MeshBuilder.CreateTorus(
        "rim",
        { diameter: rimD, thickness: 0.5, tessellation: 28 },
        this.scene,
      );
      rim.position.set(c.x, C.circle.standHeight, c.z);
      rim.material = this._mat("rimmat", "#ff7a1a", "#7a3300");
      this._dyn.push(rim);
      const net = BABYLON.MeshBuilder.CreateCylinder(
        "net",
        {
          height: 2.6,
          diameterTop: rimD,
          diameterBottom: rimD * 0.42,
          tessellation: 12,
          cap: BABYLON.Mesh.NO_CAP,
        },
        this.scene,
      );
      net.position.set(c.x, C.circle.standHeight - 1.3, c.z);
      const nm = new BABYLON.StandardMaterial("netmat", this.scene);
      nm.diffuseColor = hex("#ffffff");
      nm.emissiveColor = hex("#dddddd");
      nm.wireframe = true;
      nm.alpha = 0.7;
      nm.backFaceCulling = false;
      net.material = nm;
      this._dyn.push(net);
    });

    // GUI layer for labels
    if (this.gui) this.gui.dispose();
    this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI(
      "ui",
      true,
      this.scene,
    );

    // Players
    this.players = {};
    ["A", "B"].forEach((id) => {
      const team = TEAM[id];
      snap.cells[id].players.forEach((p) => {
        const body = BABYLON.MeshBuilder.CreateSphere(
          "p" + p.id,
          { diameterX: 2.4, diameterY: 4.2, diameterZ: 2.4, segments: 12 },
          this.scene,
        );
        body.position.set(p.x, 2.1, p.z);
        body.material = this._mat("pm" + p.id, team.base, team.emit);
        this.shadow.addShadowCaster(body);

        const rect = new BABYLON.GUI.Rectangle();
        rect.adaptWidthToChildren = true;
        rect.height = "22px";
        rect.thickness = 0;
        rect.background = ""; // no background fill
        rect.alpha = 0.8; // partially transparent
        const txt = new BABYLON.GUI.TextBlock();
        txt.text = p.name;
        txt.color = team.base; // team-colored text
        txt.fontSize = 14;
        txt.fontWeight = "700";
        txt.outlineWidth = 4; // white outline keeps it legible on the turf
        txt.outlineColor = "white";
        rect.addControl(txt);
        this.gui.addControl(rect);
        rect.linkWithMesh(body);
        rect.linkOffsetY = -48;

        this.players[p.id] = { body, rect, txt, team };
      });
    });

    // Balls
    this.balls = {};
    this._ballPrev = {}; // last seen state per ball, to detect a pocket
    this._pocketAnims = []; // active "ball into the basket" tweens
    this._ensureBalls(snap);
    this._sync(snap, 1); // snap instantly to initial positions
    return this;
  };

  FluxScene.prototype._ensureBalls = function (snap) {
    snap.balls.forEach((b) => {
      if (!this.balls[b.id]) {
        const m = BABYLON.MeshBuilder.CreateSphere(
          "ball" + b.id,
          { diameter: 1.6, segments: 10 },
          this.scene,
        );
        m.material = this._mat("ballmat", "#7a4a1e", "#3a2208");
        this.shadow.addShadowCaster(m);
        this.balls[b.id] = m;
      }
    });
  };

  FluxScene.prototype._clearDynamic = function () {
    (this._dyn || []).forEach((m) => m.dispose());
    this._dyn = [];
    Object.values(this.players).forEach((p) => {
      p.body.dispose();
      p.rect.dispose();
    });
    Object.values(this.balls).forEach((m) => m.dispose());
    this.players = {};
    this.balls = {};
  };

  // Interpolate meshes toward the snapshot. k=1 means snap instantly.
  FluxScene.prototype._sync = function (snap, k) {
    k = k == null ? 0.25 : k;
    this._ensureBalls(snap);
    ["A", "B"].forEach((id) => {
      snap.cells[id].players.forEach((p) => {
        const v = this.players[p.id];
        if (!v) return;
        v.body.position.x += (p.x - v.body.position.x) * k;
        v.body.position.z += (p.z - v.body.position.z) * k;
        // State visuals
        let y = 2.1,
          scale = 1;
        if (p.state === "sparring") {
          scale = 1 + 0.12 * Math.sin(this.tAccum * 18);
        }
        v.body.scaling.set(scale, scale, scale);
        v.body.position.y = y;
        const m = v.body.material;
        if (p.state === "penalty") {
          m.alpha = 0.45;
        } else if (p.state === "sideline") {
          m.alpha = 0.2;
        } else {
          m.alpha = 1;
        }
        v.txt.text = p.hasBall ? "● " + p.name : p.name;
        v.rect.alpha = p.state === "sideline" ? 0.3 : 1;
      });
    });
    snap.balls.forEach((b) => {
      const m = this.balls[b.id];
      if (!m) return;
      const prev = this._ballPrev[b.id];
      this._ballPrev[b.id] = b.state;
      if (b.state === "pocketed") {
        // First frame it becomes pocketed: launch the basket animation.
        if (prev && prev !== "pocketed" && !m._animating)
          this._startPocketAnim(m, snap);
        if (!m._animating) m.isVisible = false;
        return;
      }
      m.isVisible = true;
      const carried = b.state === "carried";
      m.position.x += (b.x - m.position.x) * (carried ? 0.4 : 0.25);
      m.position.z += (b.z - m.position.z) * (carried ? 0.4 : 0.25);
      m.position.y = carried ? 3.6 : 0.9;
    });
  };

  // Animate a pocketed ball arcing up into the nearest basket, then dropping
  // through the net and fading out.
  FluxScene.prototype._startPocketAnim = function (m, snap) {
    let best = null,
      bd = Infinity;
    for (const c of snap.circles) {
      const d = Math.hypot(c.x - m.position.x, c.z - m.position.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) {
      m.isVisible = false;
      return;
    }
    m._animating = true;
    m.isVisible = true;
    this._pocketAnims.push({
      m,
      t: 0,
      dur: 0.7,
      from: { x: m.position.x, y: m.position.y, z: m.position.z },
      to: { x: best.x, z: best.z, top: C.circle.standHeight },
    });
  };

  FluxScene.prototype._advancePocketAnims = function (dt) {
    if (!this._pocketAnims || !this._pocketAnims.length) return;
    const lerp = (a, b, t) => a + (b - a) * t;
    this._pocketAnims = this._pocketAnims.filter((a) => {
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      const m = a.m;
      m.position.x = lerp(a.from.x, a.to.x, p);
      m.position.z = lerp(a.from.z, a.to.z, p);
      const rise = lerp(a.from.y, a.to.top, Math.min(1, p * 1.25));
      const hop = 3.2 * Math.sin(Math.PI * Math.min(1, p)); // arc over the rim
      const drop = p > 0.75 ? ((p - 0.75) / 0.25) * 2.5 : 0; // fall through net
      m.position.y = rise + hop - drop;
      if (m.material)
        m.material.alpha = p > 0.7 ? Math.max(0, 1 - (p - 0.7) / 0.3) : 1;
      if (p >= 1) {
        m.isVisible = false;
        m._animating = false;
        if (m.material) m.material.alpha = 1;
        return false;
      }
      return true;
    });
  };

  FluxScene.prototype._frame = function () {
    const dt = this.engine.getDeltaTime() / 1000;
    this.tAccum += dt;
    if (this.simEngine && this.playing && !this.simEngine.result) {
      this.tAccum2 = (this.tAccum2 || 0) + dt * this.simSpeed;
      // Step the engine at its fixed dt; multiple steps when fast-forwarding.
      let steps = 0;
      while (this.tAccum2 >= C.match.dt && steps < 40) {
        this.simEngine.step1();
        this.tAccum2 -= C.match.dt;
        steps++;
        if (this.simEngine.result) break;
      }
    }
    if (this.simEngine) {
      const snap = this.simEngine.snapshot();
      this._sync(snap);
      this._advancePocketAnims(dt);
      if (this.onState) this.onState(snap);
    }
    this.scene.render();
  };

  FluxScene.prototype.play = function () {
    this.playing = true;
  };
  FluxScene.prototype.pause = function () {
    this.playing = false;
  };
  FluxScene.prototype.setSpeed = function (s) {
    this.simSpeed = s;
  };

  root.Flux = root.Flux || {};
  root.Flux.FluxScene = FluxScene;
})(typeof self !== "undefined" ? self : this);
