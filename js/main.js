(function () {
  "use strict";

  var FP = window.FP;
  var canvas = document.getElementById("game");
  var overlay = document.getElementById("overlay");
  var panels = {};
  document.querySelectorAll(".panel").forEach(function (p) {
    panels[p.dataset.panel] = p;
  });

  var ui = {
    film: document.getElementById("film"),
    hpBar: document.getElementById("hp-bar"),
    timer: document.getElementById("timer"),
    targets: document.getElementById("targets"),
    altitude: document.getElementById("altitude"),
    lineLen: document.getElementById("lineLen"),
    compass: document.getElementById("windCompass"),
    tension: document.getElementById("tension-bar"),
    lostReason: document.getElementById("lostReason"),
    wonStats: document.getElementById("wonStats")
  };

  var game = { sim: null };
  game.sim = new FP.Simulation();
  var renderer = new FP.Renderer(canvas);
  var audio = new FP.AudioManager();
  var lastTime = performance.now();
  var acc = 0;
  var blipAt = -1;

  var KEY_MAP = {
    KeyA: "left", ArrowLeft: "left",
    KeyD: "right", ArrowRight: "right",
    KeyW: "reelIn", ArrowUp: "reelIn",
    KeyS: "reelOut", ArrowDown: "reelOut"
  };

  function showPanel(name) {
    Object.keys(panels).forEach(function (key) {
      panels[key].classList.toggle("hidden", key !== name);
    });
    overlay.classList.toggle("hidden", !name);
  }

  function startGame() {
    audio.ensure();
    game.sim = new FP.Simulation();
    game.sim.start();
    acc = 0;
    showPanel(null);
    audio.click();
  }

  function togglePause() {
    if (game.sim.state === "playing") {
      game.sim.state = "paused";
      showPanel("pause");
    } else if (game.sim.state === "paused") {
      game.sim.state = "playing";
      showPanel(null);
    }
  }

  document.querySelectorAll("[data-action]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var action = btn.dataset.action;
      if (action === "start" || action === "restart") {
        startGame();
      } else if (action === "resume") {
        audio.click();
        togglePause();
      }
    });
  });

  window.FP_GAME = game;
  game.audio = audio;
  game.startGame = startGame;

  document.addEventListener("keydown", function (e) {
    var current = game.sim;
    if (e.repeat) {
      return;
    }
    if (KEY_MAP[e.code]) {
      current.setInput((function () {
        var p = {};
        p[KEY_MAP[e.code]] = true;
        return p;
      })());
      e.preventDefault();
    } else if (e.code === "Space") {
      if (current.state === "playing") {
        current.pressShutter();
      }
      e.preventDefault();
    } else if (e.code === "KeyP") {
      togglePause();
    } else if (e.code === "KeyM") {
      audio.ensure();
      audio.toggleMute();
    } else if (e.code === "Enter" && current.state === "ready") {
      startGame();
    }
  });

  document.addEventListener("keyup", function (e) {
    if (KEY_MAP[e.code]) {
      game.sim.setInput((function () {
        var p = {};
        p[KEY_MAP[e.code]] = false;
        return p;
      })());
      e.preventDefault();
    }
  });

  window.addEventListener("blur", function () {
    if (game.sim.state === "playing") {
      game.sim.state = "paused";
      showPanel("pause");
    }
  });

  var LOSS_TEXT = {
    "line-snapped": "风筝线绷断了，相机坠入山谷。",
    "blown-away": "线太松，风筝被狂风卷走了。",
    "timeout": "时间耗尽，风廊关闭了。",
    "no-film": "胶片全部浪费，三处景观还没拍齐。"
  };

  function handleEvents(events) {
    events.forEach(function (ev) {
      if (ev.type === "photo") {
        audio.shutter();
      } else if (ev.type === "miss") {
        audio.shutter();
      } else if (ev.type === "gust") {
        audio.noiseBurst(0.25, 340, "bandpass", 0.22);
      } else if (ev.type === "lost") {
        ui.lostReason.textContent = LOSS_TEXT[ev.reason] || "任务失败。";
        showPanel("lost");
        if (ev.reason === "line-snapped") {
          audio.snap();
        } else {
          audio.fail();
        }
      } else if (ev.type === "won") {
        ui.wonStats.textContent =
          "用时 " + ev.time.toFixed(1) + " 秒 · 剩余胶片 " + ev.filmLeft +
          " 张 · 风筝完好度 " + ev.damageLeft + "%";
        showPanel("won");
        audio.success();
      }
    });
    if (events.length) {
      events.length = 0;
    }
  }

  function updateHud() {
    var sim = game.sim;
    ui.film.textContent = sim.film + " / " + FP.CONFIG.camera.film;
    var hp = Math.max(0, sim.damage);
    ui.hpBar.style.width = hp + "%";
    ui.hpBar.style.background = hp > 55 ? "var(--ok)" : hp > 25 ? "var(--accent)" : "var(--danger)";
    ui.timer.textContent = Math.max(0, Math.ceil(FP.CONFIG.mission.timeLimit - sim.time));
    ui.altitude.textContent = Math.round(sim.altitude() / 4);
    ui.lineLen.textContent = Math.round(sim.lineLength);
    var w = sim.recentWind;
    var arrow = w.dir >= 0 ? "→" : "←";
    ui.compass.textContent = arrow + " " + Math.round(Math.abs(w.x || 0));
    var tensionPct = Math.min(100, sim.tension / FP.CONFIG.line.tensionSafe * 100);
    ui.tension.style.width = tensionPct + "%";
    ui.tension.style.background =
      tensionPct > 100 ? "var(--danger)" : "var(--accent)";

    if (ui.targets.childElementCount !== sim.world.landmarks.length) {
      ui.targets.innerHTML = "";
      sim.world.landmarks.forEach(function (lm) {
        var chip = document.createElement("span");
        chip.className = "target-chip";
        chip.id = "chip-" + lm.kind;
        chip.textContent = lm.name;
        ui.targets.appendChild(chip);
      });
    }
    sim.world.landmarks.forEach(function (lm) {
      var chip = document.getElementById("chip-" + lm.kind);
      if (chip) {
        chip.classList.toggle("done", lm.shot);
      }
    });

    if (sim.lockTarget && sim.lockProgress > 0.35 && sim.time - blipAt > 0.5) {
      blipAt = sim.time;
      audio.lockBlip();
    }
  }

  function frame(now) {
    var sim = game.sim;
    var frameDt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (sim.state === "playing") {
      acc += frameDt;
      var step = FP.CONFIG.dt;
      while (acc >= step) {
        var events = sim.update(step);
        handleEvents(events);
        acc -= step;
      }
      var fog = sim.world.fogAt(sim.kite.x, sim.kite.y, sim.time);
      audio.updateWind(sim.altitude(), Math.abs(sim.recentWind.x || 0),
        sim.tension / FP.CONFIG.line.tensionSafe, fog);
    }
    renderer.render(sim, frameDt);
    updateHud();
    requestAnimationFrame(frame);
  }

  showPanel("menu");
  requestAnimationFrame(frame);
})(window);
