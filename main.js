'use strict';

// 页面控制：输入、状态机、HUD、音效接线。模拟逻辑全部在 engine.js。

(function bootstrap() {
  const canvas = document.getElementById('sea');
  const ctx = canvas.getContext('2d');
  const E = window.ENGINE;
  const R = window.RENDERER;

  const view = { renderer: R.createRenderer(), dt: 0 };
  let game = E.createGame();
  const audio = window.GAME_AUDIO.createAudio();
  const mouse = { x: E.WORLD.w / 2, y: E.WORLD.h / 2 };
  let lastTime = performance.now();
  let handledEventCount = 0;

  const el = {
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayKicker: document.getElementById('overlay-kicker'),
    overlayBody: document.getElementById('overlay-body'),
    primaryBtn: document.getElementById('primary-btn'),
    timer: document.getElementById('timer'),
    rescued: document.getElementById('rescued-count'),
    wrecked: document.getElementById('wrecked-count'),
    energyFill: document.getElementById('energy-fill'),
    energyText: document.getElementById('energy-text'),
    heatFill: document.getElementById('heat-fill'),
    heatText: document.getElementById('heat-text'),
    blackoutTag: document.getElementById('blackout-tag'),
    statusText: document.getElementById('status-text'),
    pauseBtn: document.getElementById('pause-btn'),
    muteBtn: document.getElementById('mute-btn'),
    hint: document.getElementById('hint'),
  };

  function resetGame() {
    game = E.createGame(Date.now() & 0xffffffff);
    handledEventCount = 0;
    game.status = 'running';
    window.__game = game;
    hideOverlay();
    audio.start();
  }

  function hideOverlay() {
    el.overlay.classList.add('hidden');
  }

  function showOverlay(kind) {
    el.overlay.classList.remove('hidden');
    el.overlay.dataset.kind = kind;
    if (kind === 'ready') {
      el.overlayKicker.textContent = '夜间救援 · NIGHT RESCUE';
      el.overlayTitle.textContent = '最后一盏灯';
      el.overlayBody.innerHTML = document.getElementById('tpl-ready').innerHTML;
      el.primaryBtn.textContent = '点亮灯塔 →';
    } else if (kind === 'paused') {
      el.overlayKicker.textContent = '暂停 · PAUSED';
      el.overlayTitle.textContent = '风暴仍在门外';
      el.overlayBody.innerHTML = '<p>船只与发电机已冻结。调整呼吸，准备重新点亮光束。</p>';
      el.primaryBtn.textContent = '继续救援';
    } else {
      const won = kind === 'won';
      el.overlayKicker.textContent = won ? '任务完成 · MISSION COMPLETE' : '救援中止 · SIGNAL LOST';
      el.overlayTitle.textContent = won ? '最后一盏灯守住了' : loseTitle(game.endReason);
      el.overlayBody.innerHTML = endSummary(game, won);
      el.primaryBtn.textContent = '再次点亮 ↻';
    }
  }

  function loseTitle(reason) {
    if (reason === 'blackout') return '灯塔沉入黑暗';
    if (reason === 'timeout') return '时间熄灭了光束';
    return '礁石吞没了航路';
  }

  function endSummary(g, won) {
    const reasonText = {
      wreck: `${g.stats.wrecked} 艘货船在暗礁上失去动力，救援行动被迫中止。`,
      blackout: '发电机反复停机，灯塔彻底熄灭，船队失去了唯一的指引。',
      timeout: '九十秒耗尽，仍有货船漂在风暴里，救援窗口关闭。',
    };
    const detail = won
      ? `${g.stats.rescued} 艘船循着同一束光穿过雨幕，港口的雾笛响起时，灯塔仍然亮着。`
      : reasonText[g.endReason] || '';
    return `
      <p>${detail}</p>
      <div class="stat-grid">
        <div><span>成功入港</span><strong>${g.stats.rescued} / 5</strong></div>
        <div><span>触礁船只</span><strong>${g.stats.wrecked}</strong></div>
        <div><span>剩余时间</span><strong>${g.timeLeft.toFixed(1)}<em>s</em></strong></div>
      </div>`;
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * E.WORLD.w,
      y: ((clientY - rect.top) / rect.height) * E.WORLD.h,
    };
  }

  canvas.addEventListener('mousemove', (event) => {
    const p = toWorld(event.clientX, event.clientY);
    mouse.x = p.x;
    mouse.y = p.y;
  });

  const keys = { space: false };
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      keys.space = true;
      audio.start();
    }
    if (event.code === 'KeyP' || event.code === 'Escape') togglePause();
    if (event.code === 'Enter' && (game.status === 'won' || game.status === 'lost')) resetGame();
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') keys.space = false;
  });

  el.primaryBtn.addEventListener('click', () => {
    if (game.status === 'ready' || game.status === 'paused') {
      if (game.status === 'ready') resetGame();
      else { game.status = 'running'; hideOverlay(); }
      audio.start();
    } else if (game.status === 'won' || game.status === 'lost') {
      resetGame();
    }
  });
  el.pauseBtn.addEventListener('click', togglePause);
  el.muteBtn.addEventListener('click', () => {
    const muted = el.muteBtn.dataset.muted !== 'true';
    el.muteBtn.dataset.muted = String(muted);
    el.muteBtn.textContent = muted ? '静音中' : '声音 开';
    audio.setMuted(muted);
  });

  function togglePause() {
    if (game.status === 'running') {
      game.status = 'paused';
      showOverlay('paused');
    } else if (game.status === 'paused') {
      game.status = 'running';
      hideOverlay();
    }
  }

  function applyInput() {
    const aim = Math.atan2(mouse.y - E.LIGHTHOUSE.y, mouse.x - E.LIGHTHOUSE.x);
    game.input.aim = aim;
    game.input.spot = { x: mouse.x, y: mouse.y };
    game.input.boost = keys.space;
  }

  function handleEvents() {
    const fresh = game.events.slice(handledEventCount);
    handledEventCount = game.events.length;
    for (const event of fresh) {
      if (event.type === 'rescued') {
        audio.foghorn();
        audio.blip(740, 0.3, 'sine', 0.1);
      } else if (event.type === 'wrecked') {
        audio.crash();
        audio.alarm();
      } else if (event.type === 'blackout') {
        audio.alarm();
      } else if (event.type === 'end') {
        showOverlay(game.status === 'won' ? 'won' : 'lost');
      }
    }
  }

  function updateHud() {
    el.timer.textContent = game.timeLeft.toFixed(1);
    el.rescued.textContent = `${game.stats.rescued} / ${E.RESCUE_GOAL}`;
    el.wrecked.textContent = `${game.stats.wrecked} / ${E.WRECK_LIMIT}`;
    const beam = game.beam;
    el.energyFill.style.width = `${beam.energy}%`;
    el.energyText.textContent = `${Math.round(beam.energy)}%`;
    el.heatFill.style.width = `${beam.heat}%`;
    el.heatText.textContent = `${Math.round(beam.heat)}°C`;
    el.heatFill.className = beam.heat > 78 ? 'hot' : beam.heat > 50 ? 'warm' : '';
    el.blackoutTag.classList.toggle('visible', beam.blackout);
    el.statusText.textContent = beam.blackout ? '熄灯保护中' : beam.boost ? '超频增强' : '常规值守';
    el.hint.textContent = beam.blackout
      ? '发电机冷却 / 回充中，光束暂时熄灭……'
      : '鼠标移动光束 · 按住 SPACE 增强亮度 · P 暂停';
    document.body.dataset.state = game.status;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    view.dt = dt;
    if (game.status === 'running') {
      applyInput();
      E.step(game, dt);
      handleEvents();
      audio.update(game);
    }
    R.render(ctx, E, game, view);
    updateHud();
    requestAnimationFrame(frame);
  }

  showOverlay('ready');
  requestAnimationFrame(frame);
})();
