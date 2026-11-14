// 自动驾驶真实通关:只用按键操作 + 游戏物理,验证游戏真的可玩可赢
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', e => { console.log('页面错误:', e.message); process.exit(1); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.fill('#seed-input', '20261113');
  await page.click('#btn-start');
  const result = await page.evaluate(() => {
    const g = window.__game, st = g.state;
    const DT = 1 / 60;
    const solid = v => v === 2 || v === 3;
    const tileAt = (x, y) => {
      const gx = Math.floor(x), gy = Math.floor(y);
      if (gx < 0 || gy < 0 || gx >= 48 || gy >= 40) return 2;
      return st.map.grid[gy * 48 + gx];
    };
    const clearRay = (x, y, ang, dist) => {
      for (let d = 0.4; d < dist; d += 0.3)
        if (solid(tileAt(x + Math.cos(ang) * d, y + Math.sin(ang) * d))) return false;
      return true;
    };
    const clearance = (x, y, ang, maxD) => {
      for (let d = 0.4; d < maxD; d += 0.25)
        if (solid(tileAt(x + Math.cos(ang) * d, y + Math.sin(ang) * d))) return d;
      return maxD;
    };
    // BFS 水路寻路(玩家视角:沿开阔水道走)
    const bfs = (sx, sy, tx, ty) => {
      const W = 48, H = 40;
      const prev = new Int32Array(W * H).fill(-1);
      const q = [sy * W + sx]; prev[sy * W + sx] = sy * W + sx;
      while (q.length) {
        const cur = q.shift();
        if (cur === ty * W + tx) break;
        const cx = cur % W, cy = (cur / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (prev[ni] !== -1 || solid(st.map.grid[ni])) continue;
          prev[ni] = cur; q.push(ni);
        }
      }
      if (prev[ty * W + tx] === -1) return [];
      const path = [];
      for (let c = ty * W + tx; c !== sy * W + sx; c = prev[c])
        path.unshift({ x: c % W + 0.5, y: ((c / W) | 0) + 0.5 });
      return path;
    };
    let path = [], repathT = 0;
    const log = [];
    let lastX = 0, lastY = 0, stuckT = 0, recoverT = 0;
    for (let stepN = 0; stepN < 60 * 200 && st.mode === 'playing'; stepN++) {
      const s = st.ship;
      let best = null, bd = 1e9;
      st.map.buoys.forEach((b, i) => {
        if (st.delivered[i]) return;
        const d = Math.hypot(s.x - b.x, s.y - b.y);
        if (d < bd) { bd = d; best = b; }
      });
      const tx = best ? best.x + 0.5 : st.map.dock.x + 0.5;
      const ty = best ? best.y + 0.5 : st.map.dock.y + 0.5;
      const distT = Math.hypot(tx - s.x, ty - s.y);
      // 定期重寻路,沿路径点航行
      if (repathT <= 0 || !path.length) {
        path = bfs(Math.floor(s.x), Math.floor(s.y), Math.floor(tx), Math.floor(ty));
        repathT = 90;
      }
      repathT--;
      while (path.length && Math.hypot(path[0].x - s.x, path[0].y - s.y) < 0.7) path.shift();
      // 视线内更远的路径点直接跳过
      while (path.length > 1) {
        const a = Math.atan2(path[1].y - s.y, path[1].x - s.x);
        const d = Math.hypot(path[1].x - s.x, path[1].y - s.y);
        if (clearRay(s.x, s.y, a, Math.min(d, 3))) path.shift(); else break;
      }
      const wp = path[0] || { x: tx, y: ty };
      const want = Math.atan2(wp.y - s.y, wp.x - s.x);
      let chosen = want;
      // 卡住检测:3 秒没挪动就进入脱困模式,朝最空旷的方向开
      if (stepN % 180 === 0) {
        if (Math.hypot(s.x - lastX, s.y - lastY) < 0.6) recoverT = 240;
        lastX = s.x; lastY = s.y;
      }
      if (recoverT > 0) {
        recoverT--;
        let bestA = 0, bestC = -1;
        for (let i = 0; i < 16; i++) {
          const a = i * Math.PI / 8;
          let c = 0;
          for (let d = 0.4; d < 4; d += 0.3)
            if (!solid(tileAt(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d))) c++;
          if (c > bestC) { bestC = c; bestA = a; }
        }
        chosen = bestA;
      } else {
        // 在可通行候选里挑净空最大的,而不是第一个能走的
        let bestScore = -1;
        for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.8, -1.8, 2.5, -2.5, Math.PI]) {
          const c = clearance(s.x, s.y, want + off, 4);
          if (c < 1.2) continue;
          const score = c * 2 - Math.abs(off);
          if (score > bestScore) { bestScore = score; chosen = want + off; }
        }
      }
      const diff = Math.atan2(Math.sin(chosen - s.heading), Math.cos(chosen - s.heading));
      const nearWall = !clearRay(s.x, s.y, s.heading, 1.6);
      const wantSail = (distT < 3 || Math.abs(diff) > 1.2 || nearWall || recoverT > 0) ? 1 : 3;
      while (s.sail !== wantSail) g.toggleSail();
      if (diff > 0.08) { g.press('ArrowRight'); g.release('ArrowLeft'); }
      else if (diff < -0.08) { g.press('ArrowLeft'); g.release('ArrowRight'); }
      else { g.release('ArrowLeft'); g.release('ArrowRight'); }
      const spd = Math.hypot(s.vx, s.vy);
      if (Math.abs(diff) < 1.4 && !(nearWall && spd > 1.6)) g.press('ArrowUp');
      else g.release('ArrowUp');
      if (best && distT < 1.6) g.tryDeliver();
      g.tick(DT);
      if (stepN % 600 === 0) log.push(`t=${(stepN / 60).toFixed(0)}s 信=${st.mail} 耐久=${st.hull.toFixed(0)}`);
    }
    return { mode: st.mode, mail: st.mail, hull: st.hull, time: st.time,
      reason: st.endReason, log };
  });
  console.log(result.log.join('\n'));
  console.log(`结果: ${result.mode}  剩余信=${result.mail} 耐久=${result.hull.toFixed(0)} 用时=${result.time.toFixed(1)}s`);
  console.log(result.reason);
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', '11-autopilot-final.png') });
  await browser.close();
  if (result.mode !== 'won') { console.log('✗ 自动驾驶未能通关'); process.exit(1); }
  console.log('✓ 自动驾驶真实通关(仅按键 + 物理)');
})().catch(e => { console.error(e); process.exit(1); });
