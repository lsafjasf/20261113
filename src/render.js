import { spatialMetrics, QUADRANTS } from "./scene.js";

const COLORS = {
  bg: "#050d09",
  grid: "rgba(111, 157, 137, 0.13)",
  gridStrong: "rgba(125, 176, 154, 0.25)",
  ink: "#b8cec2",
  dim: "#688378",
  faint: "#405a50",
  mint: "#70d3bb",
  mintFill: "rgba(78, 185, 157, 0.15)",
  amber: "#e1b875",
  amberFill: "rgba(225, 184, 117, 0.12)",
  red: "#e9916e",
};
const CANVAS_FONT = '"Zero Radio Sans", "Noto Sans CJK SC", sans-serif';
const font = (size) => `${size}px ${CANVAS_FONT}`;

export function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

export function drawSpectrum(canvas, stats, sampleRate, time = 0) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 8, 5);

  const left = stats?.spectrumL;
  const right = stats?.spectrumR;
  const maxFrequency = Math.min(16000, sampleRate / 2);
  const bands = Math.max(80, Math.floor(width / 6));
  const plotTop = 15;
  const plotBottom = height - 18;
  const pointsL = [];
  const pointsR = [];
  for (let i = 0; i <= bands; i += 1) {
    const ratio = i / bands;
    const frequency = 30 * (maxFrequency / 30) ** ratio;
    const bin = Math.min(left?.length - 1 || 0, Math.round((frequency / (sampleRate / 2)) * (left?.length || 1)));
    pointsL.push([ratio * width, valueToY(left?.[bin] ?? 0, plotTop, plotBottom)]);
    pointsR.push([ratio * width, valueToY(right?.[bin] ?? 0, plotTop, plotBottom)]);
  }

  const gradient = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
  gradient.addColorStop(0, "rgba(112, 211, 187, 0.34)");
  gradient.addColorStop(1, "rgba(83, 170, 146, 0.02)");
  tracePolygon(ctx, pointsL, width, plotBottom, gradient);
  ctx.beginPath();
  pointsL.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = COLORS.mint;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.beginPath();
  pointsR.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.strokeStyle = COLORS.amber;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;

  const scanX = ((time * 0.14) % 1) * width;
  ctx.strokeStyle = "rgba(225, 184, 117, 0.16)";
  ctx.beginPath();
  ctx.moveTo(scanX, plotTop);
  ctx.lineTo(scanX, plotBottom);
  ctx.stroke();

  for (const frequency of [100, 1000, 10000]) {
    const x = (Math.log(frequency / 30) / Math.log(maxFrequency / 30)) * width;
    ctx.fillStyle = COLORS.faint;
    ctx.font = font(8);
    ctx.fillText(formatFrequency(frequency), x + 4, height - 5);
  }
  ctx.fillStyle = COLORS.mint;
  ctx.font = font(8);
  ctx.fillText("L", width - 28, 11);
  ctx.fillStyle = COLORS.amber;
  ctx.fillText("R", width - 14, 11);
}

function drawGrid(ctx, width, height, xLines, yLines) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < xLines; i += 1) {
    const x = (width / xLines) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let i = 1; i < yLines; i += 1) {
    const y = (height / yLines) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function valueToY(value, top, bottom) {
  return bottom - (value / 255) * (bottom - top);
}

function tracePolygon(ctx, points, width, bottom, fill) {
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  points.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.lineTo(width, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function formatFrequency(value) {
  return value >= 1000 ? `${value / 1000}k` : `${value}`;
}

export function drawMeters(canvas, stats) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 5, 6);
  const levels = [
    { label: "L", db: stats?.leftDb ?? -90, x: width * 0.29, color: COLORS.mint },
    { label: "R", db: stats?.rightDb ?? -90, x: width * 0.65, color: COLORS.amber },
  ];
  const top = 12;
  const bottom = height - 22;
  const barWidth = Math.min(46, width * 0.16);
  const segments = 24;
  for (const level of levels) {
    const normalized = dbToLevel(level.db);
    const segmentHeight = (bottom - top) / segments;
    for (let i = 0; i < segments; i += 1) {
      const ratio = i / segments;
      const y = bottom - (i + 1) * segmentHeight + 1;
      const active = ratio < normalized;
      ctx.fillStyle = active ? level.color : "rgba(101, 137, 123, 0.13)";
      ctx.globalAlpha = active ? 0.75 : 1;
      ctx.fillRect(level.x, y, barWidth, Math.max(1, segmentHeight - 2));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = level.color;
    ctx.font = font(9);
    ctx.textAlign = "center";
    ctx.fillText(level.label, level.x + barWidth / 2, bottom + 14);
    ctx.fillStyle = COLORS.ink;
    ctx.font = font(9);
    ctx.fillText(`${Math.max(-60, level.db).toFixed(0)}`, level.x + barWidth / 2, 10);
  }
  ctx.textAlign = "left";
  for (let db = -20; db >= -60; db -= 20) {
    const y = bottom - dbToLevel(db) * (bottom - top);
    ctx.fillStyle = COLORS.faint;
    ctx.font = font(7);
    ctx.fillText(`${db}`, 5, y + 3);
    ctx.strokeStyle = "rgba(112, 157, 139, 0.11)";
    ctx.beginPath();
    ctx.moveTo(22, y);
    ctx.lineTo(width - 4, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(225, 184, 117, 0.4)";
  ctx.beginPath();
  ctx.moveTo(width * 0.5, top);
  ctx.lineTo(width * 0.5, bottom);
  ctx.stroke();
}

export function drawTracks(canvas, frames, elapsed, duration, active = false) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 9, 5);
  const left = 30;
  const right = width - 10;
  const plotWidth = right - left;
  const laneHeight = Math.max(36, (height - 38) / 2);
  const lanes = [
    { label: "L", y: 16, color: COLORS.mint, key: "l" },
    { label: "R", y: 22 + laneHeight, color: COLORS.amber, key: "r" },
  ];
  for (const lane of lanes) {
    ctx.fillStyle = "rgba(78, 110, 96, 0.16)";
    ctx.fillRect(left, lane.y + laneHeight * 0.5, plotWidth, 1);
    ctx.fillStyle = lane.color;
    ctx.font = font(9);
    ctx.fillText(lane.label, 8, lane.y + laneHeight * 0.5 + 3);
    if (frames.length) {
      const barWidth = Math.max(1, plotWidth / Math.max(frames.length, 240));
      for (const frame of frames) {
        const level = dbToLevel(frame[lane.key]);
        const barHeight = Math.max(1, level * laneHeight * 0.86);
        const x = left + (frame.t / duration) * plotWidth;
        ctx.globalAlpha = 0.22 + level * 0.68;
        ctx.fillRect(x, lane.y + laneHeight * 0.5 - barHeight * 0.45, barWidth, barHeight);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = "rgba(117, 157, 141, 0.25)";
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(left, lane.y + laneHeight * 0.5);
      ctx.lineTo(right, lane.y + laneHeight * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = COLORS.faint;
      ctx.font = font(8);
      ctx.fillText("NO CAPTURE", left + 8, lane.y + laneHeight * 0.5 - 6);
    }
  }

  const x = left + (Math.min(elapsed, duration) / duration) * plotWidth;
  ctx.strokeStyle = active ? "rgba(255, 210, 138, 0.8)" : "rgba(152, 185, 171, 0.3)";
  ctx.beginPath();
  ctx.moveTo(x, 10);
  ctx.lineTo(x, height - 18);
  ctx.stroke();
  ctx.fillStyle = active ? COLORS.amber : COLORS.faint;
  ctx.font = font(8);
  ctx.textAlign = "right";
  ctx.fillText(active ? "CAPTURING" : frames.length ? "ARCHIVE HELD" : "STANDBY", right, 10);
  ctx.textAlign = "left";
  for (let second = 0; second <= duration; second += 3) {
    const tickX = left + (second / duration) * plotWidth;
    ctx.fillStyle = COLORS.faint;
    ctx.font = font(7);
    ctx.fillText(`${second}s`, tickX, height - 4);
  }
}

function dbToLevel(db) {
  return Math.max(0, Math.min(1, (Math.max(-60, db) + 60) / 60));
}

export function drawResultMap(canvas, caseData, answer) {
  const prepared = prepareCanvas(canvas);
  if (!prepared) return;
  const { ctx, width, height } = prepared;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height, 8, 6);

  const floor = caseData.floor;
  const padX = Math.max(34, width * 0.08);
  const padTop = 55;
  const padBottom = 59;
  const scale = Math.min(
    (width - padX * 2) / (floor.maxX - floor.minX),
    (height - padTop - padBottom) / (floor.maxY - floor.minY),
  );
  const originX = width / 2;
  const originY = padTop + (floor.maxY - floor.minY) * scale / 2;
  const point = (x, y) => ({
    x: originX + x * scale,
    y: originY - y * scale,
  });

  ctx.fillStyle = "rgba(12, 31, 24, 0.74)";
  const outer = point(floor.minX, floor.maxY);
  ctx.fillRect(outer.x, outer.y, (floor.maxX - floor.minX) * scale, (floor.maxY - floor.minY) * scale);
  caseData.rooms.forEach((room, index) => {
    const topLeft = point(room.bounds.minX, room.bounds.maxY);
    const roomWidth = (room.bounds.maxX - room.bounds.minX) * scale;
    const roomHeight = (room.bounds.maxY - room.bounds.minY) * scale;
    ctx.fillStyle = index % 2 ? "rgba(22, 46, 36, 0.35)" : "rgba(12, 37, 28, 0.4)";
    ctx.fillRect(topLeft.x, topLeft.y, roomWidth, roomHeight);
    ctx.strokeStyle = COLORS.gridStrong;
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, roomWidth, roomHeight);
    ctx.fillStyle = COLORS.dim;
    ctx.font = font(9);
    ctx.fillText(`${room.id} · ${room.name}`, topLeft.x + 8, topLeft.y + 14);
    ctx.fillStyle = COLORS.faint;
    ctx.font = font(7);
    ctx.fillText(`IR ${room.rt60.toFixed(2)}s / ABS ${Math.round(room.damping * 100)}%`, topLeft.x + 8, topLeft.y + roomHeight - 9);
  });

  const station = caseData.rooms[1].station;
  const origin = point(station.x, station.y);
  ctx.strokeStyle = "rgba(225, 184, 117, 0.34)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(origin.x - 7, origin.y);
  ctx.lineTo(origin.x + 7, origin.y);
  ctx.moveTo(origin.x, origin.y - 7);
  ctx.lineTo(origin.x, origin.y + 7);
  ctx.stroke();
  ctx.fillStyle = COLORS.amber;
  ctx.font = font(8);
  ctx.fillText("R-02 ORIGIN", origin.x + 12, origin.y + 3);

  const quadrantPositions = {
    LF: [floor.minX + 0.16, floor.maxY - 0.15],
    RF: [floor.maxX - 0.16, floor.maxY - 0.15],
    LB: [floor.minX + 0.16, floor.minY + 0.15],
    RB: [floor.maxX - 0.16, floor.minY + 0.15],
  };
  Object.entries(QUADRANTS).forEach(([key, quadrant]) => {
    const [x, y] = quadrantPositions[key];
    const at = point(x, y);
    ctx.textAlign = key === "LF" || key === "LB" ? "left" : "right";
    ctx.fillStyle = "rgba(126, 164, 147, 0.36)";
    ctx.font = font(8);
    ctx.fillText(`${quadrant.label} ${key}`, at.x, at.y);
  });
  ctx.textAlign = "left";

  caseData.rooms.forEach((room) => {
    const at = point(room.station.x, room.station.y);
    ctx.fillStyle = "rgba(195, 218, 206, 0.44)";
    ctx.beginPath();
    ctx.moveTo(at.x, at.y - 5);
    ctx.lineTo(at.x + 5, at.y + 4);
    ctx.lineTo(at.x - 5, at.y + 4);
    ctx.closePath();
    ctx.fill();
  });

  for (const source of caseData.sources) {
    const metrics = spatialMetrics(station, source);
    const at = point(source.position.x, source.position.y);
    const color = source.id === "alpha" ? COLORS.amber : COLORS.mint;
    ctx.strokeStyle = "rgba(136, 174, 157, 0.4)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let radius = 8; radius <= 21; radius += 6) {
      ctx.strokeStyle = source.id === "alpha" ? "rgba(225, 184, 117, 0.16)" : "rgba(112, 211, 187, 0.16)";
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
    ctx.lineTo(at.x + (source.position.x < 0 ? -18 : 18), at.y - 18);
    ctx.stroke();
    const labelX = at.x + (source.position.x < 0 ? -124 : 22);
    const labelY = Math.max(padTop + 8, at.y - 48);
    ctx.fillStyle = "rgba(4, 12, 8, 0.9)";
    ctx.fillRect(labelX, labelY, 112, 34);
    ctx.strokeStyle = "rgba(122, 162, 145, 0.28)";
    ctx.strokeRect(labelX, labelY, 112, 34);
    ctx.fillStyle = color;
    ctx.font = font(10);
    ctx.fillText(`${source.name}  ${QUADRANTS[source.quadrant].label}`, labelX + 7, labelY + 13);
    ctx.fillStyle = COLORS.dim;
    ctx.font = font(7);
    ctx.fillText(`PAN ${metrics.pan.toFixed(2)} · ${metrics.distance.toFixed(1)}m`, labelX + 7, labelY + 25);
  }

  drawFrontArrow(ctx, width / 2, 20);
  drawScaleBar(ctx, width - 104, height - 17, scale);
  ctx.fillStyle = COLORS.faint;
  ctx.font = font(8);
  ctx.fillText("声源坐标与双耳参数共享同一模型", 12, height - 11);
  if (answer?.first) {
    const first = caseData.sources.find((source) => source.id === answer.first);
    if (first) {
      ctx.textAlign = "right";
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`首现：${first.name} @ ${first.start.toFixed(2)}s`, width - 12, 20);
      ctx.textAlign = "left";
    }
  }
}

function drawFrontArrow(ctx, x, y) {
  ctx.strokeStyle = COLORS.amber;
  ctx.fillStyle = COLORS.amber;
  ctx.beginPath();
  ctx.moveTo(x, y + 18);
  ctx.lineTo(x, y - 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - 11);
  ctx.lineTo(x - 4, y - 4);
  ctx.lineTo(x + 4, y - 4);
  ctx.fill();
  ctx.font = font(8);
  ctx.textAlign = "center";
  ctx.fillText("前方 / FRONT", x, y - 16);
  ctx.textAlign = "left";
}

function drawScaleBar(ctx, x, y, scale) {
  ctx.strokeStyle = COLORS.dim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + scale, y);
  ctx.moveTo(x, y - 3);
  ctx.lineTo(x, y + 3);
  ctx.moveTo(x + scale, y - 3);
  ctx.lineTo(x + scale, y + 3);
  ctx.stroke();
  ctx.fillStyle = COLORS.dim;
  ctx.font = font(7);
  ctx.textAlign = "center";
  ctx.fillText("1 m", x + scale / 2, y - 6);
  ctx.textAlign = "left";
}
