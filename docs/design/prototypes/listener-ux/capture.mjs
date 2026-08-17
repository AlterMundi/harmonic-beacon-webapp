import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const markSource = readFileSync(join(root, "src/brand/canonical/hb-mark.ts"), "utf8");
const markPath = markSource.match(/HB_LISSAJOUS_PATH\s*=\s*\n?\s*"([^"]+)"/)?.[1];

if (!markPath) throw new Error("Canonical Lissajous path not found");

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="Harmonic Beacon Lissajous mark"><path d="${markPath}" fill="none" stroke="#c9a24e" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
writeFileSync(join(here, "mark.svg"), markSvg);

const concepts = ["immersive-field", "listening-altar", "spatial-dashboard"];
const states = ["visitor", "free", "founder", "listening", "paused", "profile", "checkout"];
const viewports = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
];

const browser = await chromium.launch({ headless: true });

try {
  for (const concept of concepts) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
      const remoteRequests = [];
      page.on("request", (request) => {
        if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
      });

      for (const state of states) {
        const url = new URL(pathToFileURL(join(here, `${concept}.html`)));
        url.searchParams.set("state", state);
        url.searchParams.set("capture", "1");
        await page.goto(url.href);
        await page.waitForFunction(() => document.fonts.status === "loaded");

        const geometry = await page.evaluate((currentState) => {
          const isRendered = (node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          };
          const smallTargets = [...document.querySelectorAll("a, button, input")]
            .filter(isRendered)
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width < 43.5 || rect.height < 43.5;
            })
            .map((node) => node.getAttribute("aria-label") || node.textContent?.trim() || node.tagName);
          const navRect = (selector) => {
            const rect = document.querySelector(selector)?.getBoundingClientRect();
            return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null;
          };

          return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            visibleStateNodes: [...document.querySelectorAll(`[data-show~="${currentState}"]`)].filter(isRendered).length,
            smallTargets,
            brokenImages: [...document.images].filter((image) => image.naturalWidth === 0).length,
            headerMarks: document.querySelectorAll('.topbar .brand img[src="mark.svg"]').length,
            mainMarks: document.querySelectorAll('main img[src="mark.svg"]').length,
            navLinks: document.querySelectorAll(".nav-links a").length,
            navLabels: [...document.querySelectorAll(".nav-links a")].map((link) => link.textContent?.trim()),
            visibleNavLinks: [...document.querySelectorAll(".nav-links a")].filter(isRendered).length,
            menuVisible: [...document.querySelectorAll(".nav-menu")].filter(isRendered).length,
            accountControlsInHeader: document.querySelectorAll(".topbar .chip, .topbar .member-mark, .topbar .avatar").length,
            navPositions: {
              brand: navRect(".global-nav .brand"),
              language: navRect(".global-nav .nav-language"),
              menu: navRect(".global-nav .nav-menu"),
            },
          };
        }, state);

        if (geometry.documentWidth > geometry.viewportWidth + 1) {
          throw new Error(`${concept}/${state}/${viewport.name}: horizontal overflow ${geometry.documentWidth} > ${geometry.viewportWidth}`);
        }
        if (geometry.visibleStateNodes === 0) {
          throw new Error(`${concept}/${state}/${viewport.name}: state has no visible content`);
        }
        if (geometry.smallTargets.length > 0) {
          throw new Error(`${concept}/${state}/${viewport.name}: undersized targets: ${geometry.smallTargets.join(", ")}`);
        }
        if (geometry.brokenImages > 0) {
          throw new Error(`${concept}/${state}/${viewport.name}: ${geometry.brokenImages} broken images`);
        }
        if (geometry.headerMarks !== 1 || geometry.mainMarks !== 0) {
          throw new Error(`${concept}/${state}/${viewport.name}: Lissajous must appear once in the header and never in main`);
        }
        const desktopNavigation = viewport.width > 1120;
        if (geometry.navLinks !== 7 || geometry.visibleNavLinks !== (desktopNavigation ? 7 : 0) || geometry.menuVisible !== (desktopNavigation ? 0 : 1)) {
          throw new Error(`${concept}/${state}/${viewport.name}: global navigation does not match its desktop/mobile contract`);
        }
        if (geometry.navLabels.join("|") !== "Events|Listen|News|Why it works|Team|HIT|Contact") {
          throw new Error(`${concept}/${state}/${viewport.name}: global navigation labels/order drifted from the canonical asset`);
        }
        if (!desktopNavigation && !(geometry.navPositions.brand.right < geometry.navPositions.language.left && geometry.navPositions.language.right < geometry.navPositions.menu.left)) {
          throw new Error(`${concept}/${state}/${viewport.name}: mobile navigation must render brand, language, then hamburger`);
        }
        if (!desktopNavigation && !(Math.abs(geometry.navPositions.brand.top - geometry.navPositions.language.top) < 2 && Math.abs(geometry.navPositions.language.top - geometry.navPositions.menu.top) < 2)) {
          throw new Error(`${concept}/${state}/${viewport.name}: mobile navigation items must share one row`);
        }
        if (geometry.accountControlsInHeader !== 0) {
          throw new Error(`${concept}/${state}/${viewport.name}: Listener account controls leaked into global navigation`);
        }
      }

      if (remoteRequests.length > 0) {
        throw new Error(`${concept}/${viewport.name}: unexpected remote requests: ${remoteRequests.join(", ")}`);
      }

      const captureUrl = new URL(pathToFileURL(join(here, `${concept}.html`)));
      captureUrl.searchParams.set("state", "listening");
      captureUrl.searchParams.set("capture", "1");
      await page.goto(captureUrl.href);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      await page.screenshot({
        path: join(here, "screenshots", `${concept}-${viewport.name}.png`),
        fullPage: false,
        animations: "disabled",
      });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`Verified ${concepts.length * states.length * viewports.length} state/viewport combinations and wrote 6 screenshots.`);
