import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const stateOf = (page) => page.evaluate(() => window.__intertidal.getState());

const collectErrors = (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
};

test("playback, pause, loop, and scrub preview share one timeline", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.locator(".keyframe-marker")).toHaveCount(20);
  await expect(page.locator(".track-lane")).toHaveCount(3);
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('12px "Chaoxi Sans"')))
    .toBe(true);
  await expect(page.locator("#loopButton")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.click("#loopButton");
  await expect(page.locator("#loopButton")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.click("#loopButton");
  await expect(page.locator("#loopButton")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.evaluate(() => window.__intertidal.seekTo(4.5));
  await page.click("#playButton");
  await expect(page.locator("#playButton")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.waitForTimeout(1150);

  let state = await stateOf(page);
  expect(state.playing).toBe(true);
  expect(state.audio.state).toBe("running");
  expect(state.audio.mode).toBe("playing");
  expect(state.playhead).toBeGreaterThan(5.3);
  expect(Math.abs(state.audio.timeline - state.playhead)).toBeLessThan(0.05);
  expect(state.audio.pulsesScheduled).toBeGreaterThan(0);
  const playbackPulses = await page.evaluate(() =>
    window.__intertidal.getPulseLog(),
  );
  expect(playbackPulses.length).toBeGreaterThan(0);
  expect(
    playbackPulses.every((pulse) => pulse.eventId.startsWith("light-")),
  ).toBe(true);

  await page.click("#playButton");
  const pausedAt = (await stateOf(page)).playhead;
  await page.waitForTimeout(450);
  state = await stateOf(page);
  expect(state.playing).toBe(false);
  expect(Math.abs(state.playhead - pausedAt)).toBeLessThan(0.002);

  await page.evaluate(() => window.__intertidal.seekTo(11.35));
  await page.click("#playButton");
  await page.waitForTimeout(1450);
  state = await stateOf(page);
  expect(state.playing).toBe(true);
  expect(state.playhead).toBeLessThan(1.5);
  expect(state.audio.loop).toBe(true);
  await page.click("#playButton");

  await page.evaluate(() => window.__intertidal.seekTo(2.4));
  const timeline = await page.locator("#timelineStage").boundingBox();
  expect(timeline).not.toBeNull();
  const markerCount = await page.locator(".keyframe-marker").count();
  const pulsesBefore = (
    await page.evaluate(() => window.__intertidal.getPulseLog())
  ).length;

  await page.mouse.move(
    timeline.x + timeline.width * (2.4 / 12),
    timeline.y + 10,
  );
  await page.mouse.down();
  await page.waitForTimeout(100);
  state = await stateOf(page);
  expect(state.audio.mode).toBe("scrub-preview");
  await expect(page.locator("#audioState")).toContainText("拖动预览");

  await page.mouse.move(
    timeline.x + timeline.width * (6.2 / 12),
    timeline.y + 10,
    { steps: 14 },
  );
  await page.waitForTimeout(120);
  state = await stateOf(page);
  expect(state.audio.mode).toBe("scrub-preview");
  expect(state.playhead).toBeCloseTo(6.2, 2);
  expect(
    (await page.evaluate(() => window.__intertidal.getPulseLog())).length,
  ).toBeGreaterThan(pulsesBefore);
  expect(await page.locator(".keyframe-marker").count()).toBe(markerCount);

  await page.mouse.up();
  await page.waitForTimeout(180);
  state = await stateOf(page);
  expect(state.playing).toBe(false);
  expect(state.audio.mode).toBe("stopped");
  expect(await page.locator(".keyframe-marker").count()).toBe(markerCount);
  expect(errors).toEqual([]);
});

test("keyframes, JSON round-trip, and PNG export remain deterministic", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.goto("/");
  const initialCount = await page.locator(".keyframe-marker").count();
  expect(initialCount).toBeGreaterThanOrEqual(6);

  await page.click('[data-add-track="fog"]');
  await expect(page.locator(".keyframe-marker")).toHaveCount(initialCount + 1);
  await expect(page.locator("#selectionBadge")).toContainText("雾与月光");
  await page.click("#deleteKeyframeButton");
  await expect(page.locator(".keyframe-marker")).toHaveCount(initialCount);

  await page.locator(".keyframe-marker").first().click();
  await expect(page.locator("#selectionBadge")).toContainText("潮水");
  await expect(page.locator(".keyframe-marker")).toHaveCount(initialCount);

  await page.evaluate(() => window.__intertidal.seekTo(5.25));
  const [saveDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#saveButton"),
  ]);
  const savePath = testInfo.outputPath("潮间带_工程.json");
  await saveDownload.saveAs(savePath);
  const savedJSON = await readFile(savePath, "utf8");
  const savedProject = JSON.parse(savedJSON);
  expect(savedProject.format).toBe("intertidal-project");
  expect(savedProject.version).toBe(1);
  expect(savedProject.duration).toBe(12);
  expect(savedProject.playhead).toBe(5.25);
  expect(
    savedProject.tracks.reduce(
      (total, track) => total + track.keyframes.length,
      0,
    ),
  ).toBe(initialCount);

  await page.evaluate(() => window.__intertidal.addKeyframe("tide"));
  expect((await stateOf(page)).keyframeCount).toBe(initialCount + 1);
  await page.locator("#fileInput").setInputFiles(savePath);
  await expect(page.locator(".keyframe-marker")).toHaveCount(initialCount);
  const loadedState = await stateOf(page);
  expect(loadedState.playhead).toBeCloseTo(5.25, 6);
  expect(loadedState.loop).toBe(true);
  expect(loadedState.project).toEqual(savedProject);

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#exportButton"),
  ]);
  const pngPath = testInfo.outputPath("frame.png");
  await pngDownload.saveAs(pngPath);
  const png = await readFile(pngPath);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(1920);
  expect(png.readUInt32BE(20)).toBe(1080);
  expect(png.length).toBeGreaterThan(500_000);
  expect(pngDownload.suggestedFilename()).toContain("潮间带_00-05-250.png");

  await page.click("#playButton");
  await page.waitForTimeout(420);
  const resumedState = await stateOf(page);
  expect(resumedState.playing).toBe(true);
  expect(resumedState.audio.mode).toBe("playing");
  expect(resumedState.playhead).toBeGreaterThan(5.25);
  expect(Math.abs(resumedState.audio.timeline - resumedState.playhead)).toBeLessThan(
    0.05,
  );
  await page.click("#playButton");
  expect(errors).toEqual([]);
});
