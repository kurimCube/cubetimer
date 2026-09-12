import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const url = process.argv.slice(2).find((argument) => argument !== "--") ?? "http://localhost:4173/cubetimer/";
const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) throw new Error("テストに使用できるChromeまたはEdgeが見つかりません");

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: "dark" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const scramble = page.locator("#scramble");
  await scramble.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const text = document.querySelector("#scramble")?.textContent ?? "";
    return text.length > 10 && !text.includes("生成中") && !text.includes("生成できません");
  });

  const firstScramble = await scramble.textContent();
  await page.locator('[data-puzzle="777"]').click();
  await page.waitForFunction((previous) => {
    const text = document.querySelector("#scramble")?.textContent ?? "";
    return text.length > 30 && text !== previous && !text.includes("生成中") && !text.includes("生成できません");
  }, firstScramble);

  const pad = page.locator("#timer-pad");
  const box = await pad.boundingBox();
  if (!box) throw new Error("タイマー領域を取得できません");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(550);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector("#timer-pad")?.getAttribute("data-state") === "RUNNING");
  await page.waitForTimeout(80);
  await page.locator("#running-stop-overlay").click();
  await page.waitForFunction(() => {
    const item = document.querySelector("#recent-list li:not(.empty-message)");
    return item !== null;
  });

  await page.locator('[data-recent-action="plus2"]').click();
  await page.waitForFunction(() => document.querySelector(".latest-solve .recent-time")?.textContent?.endsWith("+"));
  await page.locator('[data-recent-action="dnf"]').click();
  await page.waitForFunction(() => document.querySelector(".latest-solve .recent-time")?.textContent?.startsWith("DNF"));
  await page.locator('[data-recent-action="delete"]').click();
  await page.locator('#confirm-dialog button[value="confirm"]').click();
  await page.waitForFunction(() => document.querySelector("#recent-list .empty-message") !== null);

  if (errors.length > 0) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ url, puzzle: "777", scrambleLength: (await scramble.textContent())?.length, timerSaved: true, penaltiesUpdated: true, latestDeleted: true }));
} finally {
  await browser.close();
}
