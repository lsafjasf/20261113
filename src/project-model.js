export const PROJECT_FORMAT = "intertidal-project";
export const PROJECT_VERSION = 1;
export const PROJECT_DURATION = 12;

export const TRACK_ORDER = ["tide", "fog", "light"];

export const TRACK_DEFINITIONS = {
  tide: {
    id: "tide",
    name: "潮水高度",
    shortName: "潮水",
    color: "#79d4c5",
  },
  fog: {
    id: "fog",
    name: "雾与月光",
    shortName: "雾与月光",
    color: "#d9d8d1",
  },
  light: {
    id: "light",
    name: "灯塔明灭",
    shortName: "灯塔",
    color: "#f0b77b",
  },
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const wrapTime = (time) => {
  const wrapped = Number(time) % PROJECT_DURATION;
  return wrapped < 0 ? wrapped + PROJECT_DURATION : wrapped;
};

export const smoothstep = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export const formatTime = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const adjustedSeconds = millis === 1000 ? wholeSeconds + 1 : wholeSeconds;
  const adjustedMillis = millis === 1000 ? 0 : millis;
  return `${String(minutes).padStart(2, "0")}:${String(adjustedSeconds).padStart(
    2,
    "0",
  )}.${String(adjustedMillis).padStart(3, "0")}`;
};

export const formatFileTime = (seconds) =>
  formatTime(seconds).replace(":", "-").replace(".", "-");

const createKeyframe = (layer, index, time, value) => ({
  id: `${layer}-${String(index + 1).padStart(2, "0")}`,
  time,
  value,
});

const createTrack = (layer, entries) => ({
  ...TRACK_DEFINITIONS[layer],
  keyframes: entries.map(([time, value], index) =>
    createKeyframe(layer, index, time, value),
  ),
});

export const createDemoProject = () => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  title: "潮间带",
  duration: PROJECT_DURATION,
  tracks: [
    createTrack("tide", [
      [0, 0.38],
      [1.4, 0.56],
      [2.9, 0.68],
      [4.6, 0.47],
      [6.2, 0.34],
      [8.1, 0.74],
      [9.9, 0.58],
      [11.3, 0.42],
    ]),
    createTrack("fog", [
      [0, 0.34],
      [2.2, 0.62],
      [4.1, 0.81],
      [6.8, 0.39],
      [9.4, 0.67],
      [11.5, 0.48],
    ]),
    createTrack("light", [
      [0.65, 0.12],
      [2.4, 0.92],
      [4.8, 0.28],
      [7.1, 1],
      [9, 0.18],
      [10.8, 0.74],
    ]),
  ],
});

export const cloneProject = (project) => JSON.parse(JSON.stringify(project));

export const getTrack = (project, trackId) =>
  project.tracks.find((track) => track.id === trackId);

export const sortKeyframes = (track) => {
  track.keyframes.sort((a, b) => a.time - b.time);
  return track;
};

export const valueAtTime = (track, time) => {
  const keyframes = track?.keyframes;
  if (!keyframes?.length) {
    return 0;
  }
  if (keyframes.length === 1) {
    return clamp(keyframes[0].value, 0, 1);
  }

  const t = wrapTime(time);
  let nextIndex = keyframes.findIndex((keyframe) => keyframe.time >= t);
  let previous;
  let next;

  if (nextIndex === -1) {
    previous = keyframes[keyframes.length - 1];
    next = keyframes[0];
    next = { ...next, time: next.time + PROJECT_DURATION };
  } else if (nextIndex === 0) {
    previous = keyframes[keyframes.length - 1];
    previous = { ...previous, time: previous.time - PROJECT_DURATION };
    next = keyframes[0];
  } else {
    previous = keyframes[nextIndex - 1];
    next = keyframes[nextIndex];
  }

  const span = next.time - previous.time;
  if (span <= 0) {
    return clamp(next.value, 0, 1);
  }
  const progress = smoothstep((t - previous.time) / span);
  return clamp(previous.value + (next.value - previous.value) * progress, 0, 1);
};

export const evaluateProject = (project, time) => {
  const values = {};
  for (const track of project.tracks) {
    values[track.id] = valueAtTime(track, time);
  }
  return values;
};

export const sampleTrackCurve = (track, count = 120) => {
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const time = (index / count) * PROJECT_DURATION;
    points.push({ time, value: valueAtTime(track, time) });
  }
  return points;
};

export const makeKeyframeId = (trackId) => {
  const random = Math.random().toString(36).slice(2, 7);
  return `${trackId}-${Date.now().toString(36)}-${random}`;
};

export const addKeyframe = (project, trackId, time, value) => {
  const track = getTrack(project, trackId);
  if (!track) {
    throw new Error(`Unknown track: ${trackId}`);
  }
  const keyframeTime = clamp(wrapTime(time), 0, PROJECT_DURATION - 0.001);
  const existing = track.keyframes.find(
    (keyframe) => Math.abs(keyframe.time - keyframeTime) < 0.04,
  );

  if (existing) {
    existing.value = clamp(value, 0, 1);
    sortKeyframes(track);
    return { keyframe: existing, created: false };
  }

  const keyframe = {
    id: makeKeyframeId(trackId),
    time: keyframeTime,
    value: clamp(value, 0, 1),
  };
  track.keyframes.push(keyframe);
  sortKeyframes(track);
  return { keyframe, created: true };
};

export const removeKeyframe = (project, trackId, keyframeId) => {
  const track = getTrack(project, trackId);
  if (!track) {
    return false;
  }
  const index = track.keyframes.findIndex(
    (keyframe) => keyframe.id === keyframeId,
  );
  if (index === -1) {
    return false;
  }
  track.keyframes.splice(index, 1);
  return true;
};

export const createProjectSnapshot = (project, { loop, playhead }) => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  title: "潮间带",
  duration: PROJECT_DURATION,
  loop: Boolean(loop),
  playhead: clamp(Number(playhead) || 0, 0, PROJECT_DURATION),
  tracks: TRACK_ORDER.map((trackId) => {
    const track = getTrack(project, trackId);
    return {
      id: track.id,
      name: track.name,
      color: track.color,
      keyframes: track.keyframes.map(({ id, time, value }) => ({
        id,
        time,
        value,
      })),
    };
  }),
});

export const serializeProject = (project, options) =>
  JSON.stringify(createProjectSnapshot(project, options), null, 2);

const assertFiniteNumber = (value, label) => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} 必须是数字`);
  }
};

export const parseProject = (input) => {
  const data = typeof input === "string" ? JSON.parse(input) : input;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("工程文件格式不正确");
  }
  if (data.format !== PROJECT_FORMAT) {
    throw new Error("不是《潮间带》工程文件");
  }
  if (data.version !== PROJECT_VERSION) {
    throw new Error(`不支持的工程版本：${data.version}`);
  }
  if (data.duration !== PROJECT_DURATION) {
    throw new Error(`工程时长必须为 ${PROJECT_DURATION} 秒`);
  }
  if (!Array.isArray(data.tracks)) {
    throw new Error("工程缺少轨道数据");
  }

  const tracks = TRACK_ORDER.map((trackId) => {
    const source = data.tracks.find((track) => track?.id === trackId);
    if (!source || !Array.isArray(source.keyframes)) {
      throw new Error(`缺少轨道：${TRACK_DEFINITIONS[trackId].name}`);
    }
    const keyframes = source.keyframes.map((keyframe, index) => {
      if (!keyframe || typeof keyframe !== "object") {
        throw new Error("关键帧格式不正确");
      }
      const time = Number(keyframe.time);
      const value = Number(keyframe.value);
      assertFiniteNumber(time, "关键帧时间");
      assertFiniteNumber(value, "关键帧值");
      if (time < 0 || time >= PROJECT_DURATION) {
        throw new Error("关键帧时间必须位于 0—12 秒之间");
      }
      return {
        id:
          typeof keyframe.id === "string" && keyframe.id
            ? keyframe.id
            : `${trackId}-${index}`,
        time,
        value: clamp(value, 0, 1),
      };
    });
    keyframes.sort((a, b) => a.time - b.time);
    return {
      ...TRACK_DEFINITIONS[trackId],
      keyframes,
    };
  });

  const ids = new Set();
  for (const track of tracks) {
    for (const keyframe of track.keyframes) {
      if (ids.has(keyframe.id)) {
        keyframe.id = `${track.id}-${keyframe.id}-${keyframe.time.toFixed(3)}`;
      }
      ids.add(keyframe.id);
    }
  }

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    title: "潮间带",
    duration: PROJECT_DURATION,
    tracks,
    loop: data.loop !== false,
    playhead: clamp(Number(data.playhead) || 0, 0, PROJECT_DURATION),
  };
};
