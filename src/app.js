import {
  PROJECT_DURATION,
  TRACK_DEFINITIONS,
  TRACK_ORDER,
  addKeyframe,
  clamp,
  createDemoProject,
  createProjectSnapshot,
  evaluateProject,
  formatFileTime,
  formatTime,
  getTrack,
  parseProject,
  removeKeyframe,
  sampleTrackCurve,
  serializeProject,
  valueAtTime,
} from "./project-model.js";
import { AudioEngine } from "./audio-engine.js";
import { SceneRenderer } from "./scene-renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#sceneCanvas"),
  playButton: $("#playButton"),
  playLabel: $("#playButton .transport-label"),
  loopButton: $("#loopButton"),
  saveButton: $("#saveButton"),
  loadButton: $("#loadButton"),
  fileInput: $("#fileInput"),
  exportButton: $("#exportButton"),
  currentTimecode: $("#currentTimecode"),
  bigTimecode: $("#bigTimecode"),
  transportProgress: $("#transportProgress"),
  sceneHint: $("#sceneHint"),
  projectStatus: $("#projectStatus"),
  ruler: $("#timeRuler"),
  rulerTicks: $("#rulerTicks"),
  timelineStage: $("#timelineStage"),
  playhead: $("#playhead"),
  keyframeTotal: $("#keyframeTotal"),
  valueTide: $("#valueTide"),
  valueFog: $("#valueFog"),
  valueLight: $("#valueLight"),
  labelValueTide: $("#labelValueTide"),
  labelValueFog: $("#labelValueFog"),
  labelValueLight: $("#labelValueLight"),
  markersTide: $("#markersTide"),
  markersFog: $("#markersFog"),
  markersLight: $("#markersLight"),
  emptySelection: $("#emptySelection"),
  keyframeEditor: $("#keyframeEditor"),
  selectionBadge: $("#selectionBadge"),
  keyframeLayerLabel: $("#keyframeLayerLabel"),
  keyframeTimeLabel: $("#keyframeTimeLabel"),
  keyframeValueInput: $("#keyframeValueInput"),
  keyframeValueOutput: $("#keyframeValueOutput"),
  deleteKeyframeButton: $("#deleteKeyframeButton"),
  addAtPlayheadButton: $("#addAtPlayheadButton"),
  audioState: $("#audioState"),
  soundMonitor: $("#soundMonitor"),
  toast: $("#toast"),
};

const renderer = new SceneRenderer(elements.canvas);
const audio = new AudioEngine();

const state = {
  project: createDemoProject(),
  playhead: 2.4,
  loop: true,
  playing: false,
  selectedTrack: "tide",
  selection: null,
  scrub: null,
  dirty: true,
  starting: false,
  values: { tide: 0.4, fog: 0.5, light: 0.2 },
};

const timelineLabels = {
  tide: elements.labelValueTide,
  fog: elements.labelValueFog,
  light: elements.labelValueLight,
};
const parameterReadouts = {
  tide: elements.valueTide,
  fog: elements.valueFog,
  light: elements.valueLight,
};
const markerLayers = {
  tide: elements.markersTide,
  fog: elements.markersFog,
  light: elements.markersLight,
};

let toastTimer = 0;
let lastAudioUiCheck = 0;

const countKeyframes = (project = state.project) =>
  project.tracks.reduce((total, track) => total + track.keyframes.length, 0);

const currentValues = (time = state.playhead) =>
  evaluateProject(state.project, time);

const selectedKeyframe = () => {
  if (!state.selection) {
    return null;
  }
  const track = getTrack(state.project, state.selection.trackId);
  const keyframe = track?.keyframes.find(
    (entry) => entry.id === state.selection.keyframeId,
  );
  return keyframe ? { track, keyframe } : null;
};

const showToast = (message) => {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const setProjectStatus = (prefix = "示例工程") => {
  elements.projectStatus.textContent = `${prefix} · ${countKeyframes()} 个关键帧`;
};

const updateAudioStateUi = () => {
  const status = audio.getStatus();
  elements.audioState.replaceChildren();
  const dot = document.createElement("i");
  elements.audioState.append(dot);
  let text = "待启动";
  if (status.mode === "scrub-preview") {
    text = "拖动预览 · 实时跟随";
    elements.audioState.classList.add("is-running");
    elements.soundMonitor.classList.add("is-running");
    elements.sceneHint.textContent = "拖动预览 · 画面与声音共用播放头";
  } else if (state.playing && status.state === "running") {
    text = `运行中 · ${Math.round((status.sampleRate || 0) / 1000)} kHz`;
    elements.audioState.classList.add("is-running");
    elements.soundMonitor.classList.add("is-running");
    elements.sceneHint.textContent = `声画同步 · Web Audio ${Math.round(
      (status.sampleRate || 0) / 1000,
    )} kHz`;
  } else {
    elements.audioState.classList.remove("is-running");
    elements.soundMonitor.classList.remove("is-running");
    if (status.initialized) {
      text = "已就绪 · 暂停";
      elements.sceneHint.textContent = "声音暂停 · 拖动时间线预览画面";
    } else {
      elements.sceneHint.textContent = "点击播放，启用合成声音";
    }
  }
  elements.audioState.append(document.createTextNode(text));
};

const syncTransportUi = () => {
  document.body.classList.toggle("is-playing", state.playing);
  elements.playButton.classList.toggle("is-playing", state.playing);
  elements.playButton.setAttribute("aria-pressed", String(state.playing));
  elements.playButton.setAttribute("aria-label", state.playing ? "暂停" : "播放");
  elements.playLabel.textContent = state.playing ? "暂停" : "播放";
  updateAudioStateUi();
};

const updateLiveDisplay = (time = state.playhead) => {
  const displayTime = clamp(time, 0, PROJECT_DURATION);
  const values = currentValues(displayTime);
  state.values = values;

  elements.currentTimecode.textContent = formatTime(displayTime);
  elements.bigTimecode.textContent = formatTime(displayTime);
  elements.transportProgress.style.width = `${(displayTime / PROJECT_DURATION) * 100}%`;
  elements.playhead.style.left = `${clamp(
    (displayTime / PROJECT_DURATION) * 100,
    0,
    100,
  )}%`;

  for (const trackId of TRACK_ORDER) {
    const formatted = values[trackId].toFixed(3);
    parameterReadouts[trackId].textContent = formatted;
    timelineLabels[trackId].textContent = formatted;
  }
};

const renderCurrentFrame = () => {
  state.values = currentValues(state.playhead);
  renderer.render(state.playhead, state.values);
  return state.values;
};

const refreshSelectionVisuals = () => {
  for (const label of $$(".track-label")) {
    label.classList.toggle(
      "is-selected",
      label.dataset.track === state.selectedTrack,
    );
  }
  for (const card of $$(".parameter-card")) {
    card.classList.toggle(
      "is-selected",
      card.dataset.track === state.selectedTrack,
    );
  }
  const selected = selectedKeyframe();
  for (const marker of $$(".keyframe-marker")) {
    marker.classList.toggle(
      "is-selected",
      Boolean(
        selected &&
          marker.dataset.trackId === state.selection.trackId &&
          marker.dataset.keyframeId === state.selection.keyframeId,
      ),
    );
  }
  updateKeyframeEditor();

  const track = getTrack(state.project, state.selectedTrack);
  elements.addAtPlayheadButton.innerHTML = `<span class="plus-icon"></span>在当前播放头为“${
    track?.name || "所选轨道"
  }”添加关键帧`;
};

const updateKeyframeEditor = () => {
  const selected = selectedKeyframe();
  if (!selected) {
    state.selection = null;
    elements.emptySelection.hidden = false;
    elements.keyframeEditor.hidden = true;
    elements.selectionBadge.textContent = "未选择";
    elements.selectionBadge.classList.remove("has-selection");
    return;
  }

  elements.emptySelection.hidden = true;
  elements.keyframeEditor.hidden = false;
  elements.selectionBadge.textContent = selected.track.shortName;
  elements.selectionBadge.classList.add("has-selection");
  elements.keyframeLayerLabel.textContent = selected.track.name;
  elements.keyframeTimeLabel.textContent = formatTime(selected.keyframe.time);
  elements.keyframeValueInput.value = String(selected.keyframe.value);
  elements.keyframeValueOutput.textContent = selected.keyframe.value.toFixed(3);
};

const updateTrackCurve = (track) => {
  const line = document.querySelector(`.${track.id}-line`);
  const area = document.querySelector(`.${track.id}-area`);
  if (!line || !area) {
    return;
  }
  if (!track.keyframes.length) {
    line.setAttribute("d", "");
    area.setAttribute("d", "");
    return;
  }

  const samples = sampleTrackCurve(track, 180);
  const points = samples.map(({ time, value }) => {
    const x = (time / PROJECT_DURATION) * 1000;
    const y = 15 + (1 - value) * 70;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  line.setAttribute("d", `M ${points.join(" L ")}`);
  area.setAttribute(
    "d",
    `M 0 100 L ${points.join(" L ")} L 1000 100 Z`,
  );
};

const updateTrackMarkers = (track) => {
  const root = markerLayers[track.id];
  root.replaceChildren();
  for (const keyframe of track.keyframes) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "keyframe-marker";
    marker.dataset.trackId = track.id;
    marker.dataset.keyframeId = keyframe.id;
    marker.style.left = `${(keyframe.time / PROJECT_DURATION) * 100}%`;
    marker.style.top = `${9 + (1 - keyframe.value) * 34}px`;
    marker.title = `${track.name} · ${formatTime(keyframe.time)} · ${keyframe.value.toFixed(
      3,
    )}`;
    marker.setAttribute(
      "aria-label",
      `${track.name}关键帧，${formatTime(keyframe.time)}，值 ${keyframe.value.toFixed(
        3,
      )}`,
    );
    marker.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    marker.addEventListener("click", (event) => {
      event.stopPropagation();
      selectKeyframe(track.id, keyframe.id, { seek: true });
    });
    root.append(marker);
  }
};

const renderTimelineData = () => {
  for (const track of state.project.tracks) {
    updateTrackCurve(track);
    updateTrackMarkers(track);
  }
  elements.keyframeTotal.textContent = `${countKeyframes()} 个关键帧`;
  refreshSelectionVisuals();
};

const syncAudioPulseEvents = () => {
  const lightTrack = getTrack(state.project, "light");
  audio.setPulseEvents(lightTrack?.keyframes || []);
};

const updateLoopUi = () => {
  elements.loopButton.classList.toggle("is-active", state.loop);
  elements.loopButton.setAttribute("aria-pressed", String(state.loop));
  elements.loopButton.title = state.loop ? "循环播放：开启" : "循环播放：关闭";
};

const selectTrack = (trackId, { clearKeyframe = true } = {}) => {
  if (!TRACK_DEFINITIONS[trackId]) {
    return;
  }
  state.selectedTrack = trackId;
  if (clearKeyframe) {
    state.selection = null;
  }
  refreshSelectionVisuals();
};

const seekTo = (time, { pause = true, render = true } = {}) => {
  if (pause && state.playing) {
    pausePlayback();
  }
  state.playhead = clamp(Number(time) || 0, 0, PROJECT_DURATION);
  state.dirty = true;
  if (render) {
    renderCurrentFrame();
    updateLiveDisplay();
  }
};

const selectKeyframe = (trackId, keyframeId, { seek = false } = {}) => {
  state.selectedTrack = trackId;
  state.selection = { trackId, keyframeId };
  const selected = selectedKeyframe();
  if (!selected) {
    state.selection = null;
    refreshSelectionVisuals();
    return;
  }
  if (seek) {
    seekTo(selected.keyframe.time);
  }
  refreshSelectionVisuals();
};

const addKeyframeAtPlayhead = (trackId = state.selectedTrack) => {
  const values = currentValues();
  const result = addKeyframe(
    state.project,
    trackId,
    state.playhead,
    values[trackId],
  );
  state.selectedTrack = trackId;
  state.selection = { trackId, keyframeId: result.keyframe.id };
  syncAudioPulseEvents();
  renderTimelineData();
  updateLiveDisplay();
  setProjectStatus("工程");
  showToast(
    result.created
      ? `已在 ${formatTime(result.keyframe.time)} 添加${TRACK_DEFINITIONS[trackId].name}关键帧`
      : `已更新 ${formatTime(result.keyframe.time)} 的关键帧`,
  );
};

const deleteSelectedKeyframe = () => {
  const selected = selectedKeyframe();
  if (!selected) {
    return;
  }
  const { track, keyframe } = selected;
  removeKeyframe(state.project, track.id, keyframe.id);
  state.selection = null;
  syncAudioPulseEvents();
  renderTimelineData();
  updateLiveDisplay();
  setProjectStatus("工程");
  showToast(`已删除 ${formatTime(keyframe.time)} 的${track.name}关键帧`);
};

const completePlayback = () => {
  audio.pause();
  state.playing = false;
  state.playhead = PROJECT_DURATION;
  syncTransportUi();
  renderCurrentFrame();
  updateLiveDisplay();
};

const pausePlayback = () => {
  audio.pause();
  state.playing = false;
  syncTransportUi();
  state.dirty = true;
};

const startPlayback = async () => {
  if (state.playing || state.starting) {
    return;
  }
  if (state.playhead >= PROJECT_DURATION - 0.001) {
    state.playhead = 0;
  }
  syncAudioPulseEvents();
  elements.sceneHint.textContent = "正在启动合成声场…";
  state.starting = true;
  try {
    await audio.play(state.playhead, state.loop);
    state.playing = true;
    syncTransportUi();
    const values = currentValues();
    audio.updateParams(values);
  } catch (error) {
    state.playing = false;
    syncTransportUi();
    showToast(`声音启动失败：${error.message}`);
  } finally {
    state.starting = false;
  }
};

const togglePlayback = () => {
  if (state.playing) {
    pausePlayback();
  } else {
    startPlayback();
  }
};

const applyProject = (project) => {
  if (state.playing) {
    pausePlayback();
  }
  state.project = project;
  state.loop = project.loop !== false;
  state.playhead = clamp(project.playhead || 0, 0, PROJECT_DURATION);
  state.selectedTrack = "tide";
  state.selection = null;
  state.dirty = true;
  syncAudioPulseEvents();
  updateLoopUi();
  renderTimelineData();
  renderCurrentFrame();
  updateLiveDisplay();
  setProjectStatus("已载入工程");
};

const saveProject = () => {
  const json = serializeProject(state.project, {
    loop: state.loop,
    playhead: state.playhead,
  });
  downloadBlob(
    new Blob([json], { type: "application/json;charset=utf-8" }),
    "潮间带_工程.json",
  );
  setProjectStatus("已保存工程");
  showToast(`工程已保存 · ${countKeyframes()} 个关键帧`);
};

const loadProjectFile = async (file) => {
  if (!file) {
    return null;
  }
  try {
    const text = await file.text();
    const project = parseProject(text);
    applyProject(project);
    showToast(
      `已载入工程 · ${countKeyframes(project)} 个关键帧 · 播放头 ${formatTime(
        project.playhead || 0,
      )}`,
    );
    return project;
  } catch (error) {
    showToast(`载入失败：${error.message}`);
    return null;
  }
};

const exportCurrentFrame = async () => {
  const time = state.playhead;
  const values = currentValues(time);
  const blob = await renderer.exportPNG(time, values);
  downloadBlob(blob, `潮间带_${formatFileTime(time)}.png`);
  showToast(`当前帧已导出 · 1920 × 1080 · ${formatTime(time)}`);
  return blob;
};

const beginTimelineScrub = (event) => {
  if (event.button !== 0 || event.target.closest(".keyframe-marker")) {
    return;
  }
  event.preventDefault();
  const wasPlaying = state.playing;
  const audioPreviewing =
    wasPlaying || audio.getStatus().initialized
      ? audio.beginScrubPreview(state.playhead)
      : false;
  if (wasPlaying) {
    state.playing = false;
    syncTransportUi();
  } else if (audioPreviewing) {
    updateAudioStateUi();
  }
  state.scrub = { wasPlaying };
  document.body.classList.add("is-scrubbing");

  const moveToPointer = (pointerEvent) => {
    const rect = elements.timelineStage.getBoundingClientRect();
    const ratio = clamp((pointerEvent.clientX - rect.left) / rect.width, 0, 1);
    state.playhead = ratio * PROJECT_DURATION;
    state.dirty = true;
    updateLiveDisplay();
    if (audioPreviewing) {
      audio.scrubTo(state.playhead, currentValues());
    }
  };

  const finishScrub = (cancelled = false) => {
    window.removeEventListener("pointermove", moveToPointer);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    document.body.classList.remove("is-scrubbing");
    const shouldResume = state.scrub?.wasPlaying && !cancelled;
    state.scrub = null;
    if (shouldResume) {
      startPlayback();
    } else {
      if (audioPreviewing) {
        audio.endScrubPreview();
      }
      updateLiveDisplay();
      updateAudioStateUi();
    }
  };
  const handlePointerUp = () => finishScrub(false);
  const handlePointerCancel = () => finishScrub(true);

  moveToPointer(event);
  window.addEventListener("pointermove", moveToPointer);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", handlePointerCancel);
};

const buildRuler = () => {
  elements.rulerTicks.replaceChildren();
  for (let halfSecond = 0; halfSecond <= PROJECT_DURATION * 2; halfSecond += 1) {
    const time = halfSecond / 2;
    const major = halfSecond % 2 === 0;
    const tick = document.createElement("span");
    tick.className = `ruler-tick${major ? " major" : ""}`;
    tick.style.left = `${(time / PROJECT_DURATION) * 100}%`;
    if (major) {
      const label = document.createElement("span");
      label.className = "ruler-tick-label";
      label.textContent = `${time}s`;
      tick.append(label);
    }
    elements.rulerTicks.append(tick);
  }
};

const animationLoop = () => {
  if (state.playing) {
    const audioStatus = audio.getStatus();
    if (audioStatus.state === "running") {
      const time = audio.getTimelineTime();
      if (!state.loop && time >= PROJECT_DURATION - 0.0001) {
        completePlayback();
      } else {
        state.playhead = time;
        const values = renderCurrentFrame();
        updateLiveDisplay(time);
        audio.updateParams(values);
        state.dirty = false;
      }
    }
    if (performance.now() - lastAudioUiCheck > 800) {
      updateAudioStateUi();
      lastAudioUiCheck = performance.now();
    }
  } else if (state.dirty) {
    renderCurrentFrame();
    updateLiveDisplay();
    state.dirty = false;
  }
  requestAnimationFrame(animationLoop);
};

const bindEvents = () => {
  elements.playButton.addEventListener("click", togglePlayback);
  elements.loopButton.addEventListener("click", () => {
    state.loop = !state.loop;
    audio.setLoop(state.loop);
    updateLoopUi();
    showToast(state.loop ? "循环播放已开启" : "循环播放已关闭");
  });
  elements.saveButton.addEventListener("click", saveProject);
  elements.loadButton.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", async () => {
    const [file] = elements.fileInput.files;
    await loadProjectFile(file);
    elements.fileInput.value = "";
  });
  elements.exportButton.addEventListener("click", async () => {
    try {
      await exportCurrentFrame();
    } catch (error) {
      showToast(`PNG 导出失败：${error.message}`);
    }
  });

  elements.timelineStage.addEventListener("pointerdown", beginTimelineScrub);

  for (const label of $$(".track-label")) {
    label.addEventListener("click", (event) => {
      if (event.target.closest(".keyframe-add")) {
        return;
      }
      selectTrack(label.dataset.track);
    });
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        selectTrack(label.dataset.track);
      }
    });
  }

  for (const button of $$("[data-add-track]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      addKeyframeAtPlayhead(button.dataset.addTrack);
    });
  }

  for (const card of $$(".parameter-card")) {
    card.addEventListener("click", () => selectTrack(card.dataset.track));
  }

  elements.addAtPlayheadButton.addEventListener("click", () =>
    addKeyframeAtPlayhead(state.selectedTrack),
  );
  elements.deleteKeyframeButton.addEventListener(
    "click",
    deleteSelectedKeyframe,
  );

  elements.keyframeValueInput.addEventListener("input", () => {
    const selected = selectedKeyframe();
    if (!selected) {
      return;
    }
    selected.keyframe.value = clamp(
      Number(elements.keyframeValueInput.value),
      0,
      1,
    );
    syncAudioPulseEvents();
    renderTimelineData();
    updateLiveDisplay();
    state.dirty = true;
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveProject();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      elements.fileInput.click();
      return;
    }
    if (isEditing) {
      return;
    }
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      togglePlayback();
      return;
    }
    if (event.key.toLowerCase() === "k" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      addKeyframeAtPlayhead(state.selectedTrack);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedKeyframe()) {
        event.preventDefault();
        deleteSelectedKeyframe();
      }
      return;
    }
    if (event.key === "Escape") {
      state.selection = null;
      refreshSelectionVisuals();
    }
  });
};

const initialize = () => {
  buildRuler();
  syncAudioPulseEvents();
  updateLoopUi();
  renderTimelineData();
  renderCurrentFrame();
  updateLiveDisplay();
  syncTransportUi();
  setProjectStatus("示例工程");
  bindEvents();

  const resizeObserver = new ResizeObserver(() => {
    renderer.resize();
    state.dirty = true;
  });
  resizeObserver.observe(elements.canvas);
  requestAnimationFrame(() => {
    renderer.resize();
    renderCurrentFrame();
    requestAnimationFrame(animationLoop);
  });

  window.__intertidal = {
    getState: () => ({
      project: createProjectSnapshot(state.project, {
        loop: state.loop,
        playhead: state.playhead,
      }),
      playing: state.playing,
      playhead: state.playhead,
      loop: state.loop,
      selectedTrack: state.selectedTrack,
      selection: state.selection,
      values: currentValues(),
      keyframeCount: countKeyframes(),
      audio: audio.getStatus(),
    }),
    getValueAt: (trackId, time) =>
      valueAtTime(getTrack(state.project, trackId), time),
    seekTo,
    play: startPlayback,
    pause: pausePlayback,
    addKeyframe: addKeyframeAtPlayhead,
    deleteSelectedKeyframe,
    selectKeyframe,
    getProjectJSON: () =>
      serializeProject(state.project, {
        loop: state.loop,
        playhead: state.playhead,
      }),
    loadProjectJSON: (json) => {
      const project = parseProject(json);
      applyProject(project);
      return project;
    },
    exportPNGBlob: () =>
      renderer.exportPNG(state.playhead, currentValues()),
    getCanvasSize: () => ({
      width: elements.canvas.width,
      height: elements.canvas.height,
      cssWidth: elements.canvas.clientWidth,
      cssHeight: elements.canvas.clientHeight,
    }),
    getPulseLog: () => audio.pulseLog.map((entry) => ({ ...entry })),
  };
};

initialize();
