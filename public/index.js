"use strict";

/* ==========================================================================
   Settings
   ========================================================================== */

// The 4-digit code for the first screen. Change it here.
const CODE = "7421";

/* ==========================================================================
   Elements
   ========================================================================== */

const root = document.documentElement;
const stage = document.getElementById("stage");
const ambient = document.getElementById("ambient");
const orbits = document.getElementById("orbits");
const pill = document.getElementById("pill");
const lock = document.getElementById("lock");
/** @type {HTMLInputElement} */
const codeInput = document.getElementById("code");
const dots = Array.from(document.querySelectorAll(".dots i"));
/** @type {HTMLFormElement} */
const form = document.getElementById("sj-form");
/** @type {HTMLInputElement} */
const address = document.getElementById("sj-address");
/** @type {HTMLInputElement} */
const searchEngine = document.getElementById("sj-search-engine");
const hint = document.getElementById("hint");
const statusBar = document.getElementById("status");
const statusText = document.getElementById("status-text");
const warp = document.getElementById("warp");
const core = document.getElementById("core");
const burst = document.getElementById("burst");

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const el = (tag, text) =>
	Object.assign(document.createElement(tag), { textContent: text });

/* ==========================================================================
   Engine (same setup as before)
   ========================================================================== */

let scramjet = null;
let connection = null;
let engineError = null;

try {
	const { ScramjetController } = $scramjetLoadController();

	scramjet = new ScramjetController({
		files: {
			wasm: "/scram/scramjet.wasm.wasm",
			all: "/scram/scramjet.all.js",
			sync: "/scram/scramjet.sync.js",
		},
	});

	connection = new BareMux.BareMuxConnection("/baremux/worker.js");
} catch (err) {
	engineError = err;
}

const wispUrl =
	(location.protocol === "https:" ? "wss" : "ws") +
	"://" +
	location.host +
	"/wisp/";

async function ensureTransport() {
	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
}

/** Warms everything up in the background so the first link opens fast. */
async function prepare() {
	if (engineError) throw engineError;
	await scramjet.init();
	await registerSW();
	// Make sure the worker is active before the first navigation goes out.
	await Promise.race([navigator.serviceWorker.ready, wait(8000)]);
	await ensureTransport();
}

let engine = null;
let engineState = "starting";

/** Starts the warm-up once; call again after a failure to retry. */
function warmUp() {
	if (!engine) {
		engineState = "starting";
		engine = prepare();
		engine.then(
			() => {
				engineState = "ready";
				showEngineStatus();
			},
			(err) => {
				console.error(err);
				engineState = "error";
				showEngineStatus();
			}
		);
	}
	return engine;
}

function showEngineStatus() {
	if (root.dataset.view === "loading") return; // shows "Connecting" then
	if (engineState === "ready") setStatus("ready", "Ready");
	else if (engineState === "error") setStatus("error", "Offline");
	else setStatus("starting", "Starting");
}

/* ==========================================================================
   View + small UI helpers
   ========================================================================== */

let busy = false;

/** @param {"lock" | "home" | "loading" | "launch" | "browse"} view */
function setView(view) {
	root.dataset.view = view;
	lock.inert = view !== "lock";
	form.inert = view !== "home";
	address.readOnly = view !== "home";
}

function setStatus(state, label) {
	statusBar.dataset.state = state;
	statusText.textContent = label;
}

/** Accepts a string, a node, or a list of both. Text is never parsed as HTML. */
function setHint(content, tone = "") {
	hint.replaceChildren(...[].concat(content).filter((part) => part !== ""));
	hint.dataset.tone = tone;
}

function shake() {
	if (reducedMotion.matches || !pill.animate) return;
	pill.animate(
		[
			{ translate: "0 0" },
			{ translate: "-11px 0" },
			{ translate: "9px 0" },
			{ translate: "-7px 0" },
			{ translate: "4px 0" },
			{ translate: "-2px 0" },
			{ translate: "0 0" },
		],
		{ duration: 520, easing: "cubic-bezier(.3, 0, .2, 1)" }
	);
}

function pulseOrbits() {
	if (reducedMotion.matches || root.classList.contains("lite")) return;
	orbits.classList.remove("is-pulse");
	void orbits.offsetWidth; // restart the animation
	orbits.classList.add("is-pulse");
	setTimeout(() => orbits.classList.remove("is-pulse"), 1700);
}

/* ==========================================================================
   Screen 1: the code
   ========================================================================== */

function renderDots(count) {
	dots.forEach((dot, i) => {
		dot.classList.toggle("on", i < count);
		dot.classList.toggle("next", i === count);
	});
}

function focusCode() {
	if (root.dataset.view === "lock" && !busy)
		codeInput.focus({ preventScroll: true });
}

codeInput.addEventListener("input", () => {
	const value = codeInput.value.replace(/\D/g, "").slice(0, 4);
	if (codeInput.value !== value) codeInput.value = value;
	if (busy) return;

	if (value) setHint("");
	renderDots(value.length);
	if (value.length === 4) checkCode(value);
});

function checkCode(value) {
	busy = true;
	if (value === CODE) unlock();
	else reject();
}

function reject() {
	pill.classList.add("is-error");
	setHint("Incorrect code", "error");
	navigator.vibrate?.([14, 60, 14]);
	shake();
	codeInput.value = "";

	setTimeout(() => {
		pill.classList.remove("is-error");
		busy = false;
		const typed = codeInput.value;
		renderDots(typed.length);
		if (typed.length === 4) checkCode(typed);
	}, 560);
}

function unlock() {
	try {
		sessionStorage.setItem("gate_ok", "1");
	} catch (err) {
		// Private mode without storage: the code is just asked again next time.
	}

	navigator.vibrate?.(10);

	// Move focus to the link field immediately (inside the same input event),
	// so phone keyboards stay open while the bar unfolds.
	form.inert = false;
	address.readOnly = false;
	address.focus({ preventScroll: true });
	pill.classList.add("is-ok");

	setTimeout(
		() => {
			setView("home");
			busy = false;
			pulseOrbits();
			renderPreview();
			setTimeout(() => pill.classList.remove("is-ok"), 700);
		},
		reducedMotion.matches ? 0 : 340
	);
}

/* ==========================================================================
   Screen 2: the link
   ========================================================================== */

function resolve(raw) {
	const value = raw.trim();
	if (!value) return null;

	const template = searchEngine.value;
	const url = search(value, template);
	const isSearch = url === template.replace("%s", encodeURIComponent(value));
	return { value, url, isSearch };
}

function prettyUrl(href) {
	try {
		const url = new URL(href);
		const rest = (url.pathname + url.search + url.hash).replace(/\/$/, "");
		return url.host.replace(/^www\./, "") + rest;
	} catch (err) {
		return href;
	}
}

function renderPreview() {
	const target = resolve(address.value);

	form.classList.toggle("has-text", !!target);
	form.dataset.kind = target && !target.isSearch ? "url" : "search";

	if (root.dataset.view !== "home") return;
	if (!target) return setHint("");

	setHint(
		target.isSearch
			? [el("kbd", "↵"), "Search", el("b", `“${target.value}”`)]
			: [el("kbd", "↵"), "Open", el("b", prettyUrl(target.url))]
	);
}

address.addEventListener("input", () => {
	renderPreview();
	// Typing a link is a clear sign of intent: warm up right now so the
	// engine is ready by the time Enter is pressed.
	if (!engine) warmUp();
});

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	if (root.dataset.view !== "home") return;

	const target = resolve(address.value);
	if (!target) {
		shake();
		address.focus();
		return;
	}

	buildWarp();
	const id = ++launchId;
	warpStartedAt = performance.now();

	setView("loading");
	setStatus("starting", "Connecting");
	setHint(
		target.isSearch
			? ["Searching", el("b", `“${target.value}”`)]
			: ["Connecting to", el("b", new URL(target.url).host)]
	);

	// If it's taking a while, quietly offer a way out.
	setTimeout(() => {
		if (
			id === launchId &&
			root.dataset.view === "loading" &&
			finePointer.matches
		)
			hint.append(el("small", "esc to cancel"));
	}, 6000);

	try {
		// If the background warm-up failed, give it one more honest try.
		await warmUp().catch(() => {
			engine = null;
			return warmUp();
		});
		await ensureTransport();
	} catch (err) {
		if (id === launchId) fail(err);
		return;
	}

	if (id === launchId) launch(target.url, id);
});

function fail(err) {
	console.error(err);
	dropFrame();
	setView("home");
	setStatus("error", "Offline");

	const message = String(err?.message || err);
	const friendly = /service worker/i.test(message)
		? message
		: "Couldn’t open a secure connection. Try again.";
	setHint(
		friendly === message ? friendly : [friendly, el("small", message)],
		"error"
	);

	shake();
	address.focus();
}

/* ==========================================================================
   The warp: starlight streaks, built once on the first launch
   ========================================================================== */

let launchId = 0;
let warpStartedAt = 0;
let activeFrame = null;

// The build-up always gets this long before the page appears, even when
// the page is instant, so the moment never feels cut off.
const MIN_WARP = 1300;

function buildWarp() {
	if (warp.childElementCount || isLite() || reducedMotion.matches) return;

	const count = 48;
	const reach = Math.hypot(innerWidth, innerHeight) / 2;
	const rand = (min, max) => min + Math.random() * (max - min);
	const streaks = document.createDocumentFragment();

	for (let i = 0; i < count; i++) {
		const streak = document.createElement("i");
		streak.style.cssText = [
			`--ang: ${((i * 360) / count + rand(-4, 4)).toFixed(1)}deg`,
			`--from: ${Math.round(rand(0.45, 1.05) * reach)}px`,
			`--len: ${Math.round(rand(50, 170))}px`,
			`--dur: ${rand(0.75, 1.5).toFixed(2)}s`,
			`--delay: ${rand(0, 1.4).toFixed(2)}s`,
			`--b: ${rand(0.45, 1).toFixed(2)}`,
		].join(";");
		streaks.append(streak);
	}
	warp.append(streaks);
}

/** Esc during a slow load: unwind the warp and go back to the bar. */
function cancelLaunch() {
	launchId++;
	dropFrame();
	setView("home");
	showEngineStatus();
	renderPreview();
	address.focus();
}

function dropFrame() {
	activeFrame?.remove();
	activeFrame = null;
}

/* ==========================================================================
   Screen 3: the page itself — a bare, fullscreen frame. Nothing on top.
   ========================================================================== */

function launch(url, id) {
	const frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	activeFrame = frame.frame;
	document.body.appendChild(frame.frame);
	frame.go(url);

	const buildUp = reducedMotion.matches
		? 0
		: Math.max(0, warpStartedAt + MIN_WARP - performance.now());

	Promise.all([waitForFrame(frame.frame), wait(buildUp)]).then(() => {
		if (id === launchId) reveal(frame.frame);
	});
}

/** Resolves once the page has something to show (or after 12s). */
function waitForFrame(iframe) {
	return new Promise((done) => {
		const started = performance.now();
		let readyAt = 0;

		const navigated = () => {
			try {
				return iframe.contentWindow.location.href !== "about:blank";
			} catch (err) {
				return true;
			}
		};

		const finish = () => {
			clearInterval(timer);
			iframe.removeEventListener("load", onLoad);
			done();
		};

		const onLoad = () => navigated() && finish();
		iframe.addEventListener("load", onLoad);

		const timer = setInterval(() => {
			const now = performance.now();
			let state = "loading";
			try {
				if (navigated()) state = iframe.contentDocument.readyState;
			} catch (err) {
				state = "complete";
			}
			if (state !== "loading" && !readyAt) readyAt = now;
			if ((readyAt && now - readyAt > 600) || now - started > 12000) finish();
		}, 100);
	});
}

function reveal(iframe) {
	// The core detonates (flash + shockwave)...
	setView("launch");
	stopParallax();

	// ...and a beat later the page fades in underneath the fading flash.
	setTimeout(
		() => {
			setView("browse");
			iframe.classList.add("is-shown");
			try {
				iframe.contentWindow.focus();
			} catch (err) {
				// Focus is a nicety; the page still works without it.
			}
		},
		reducedMotion.matches ? 0 : 140
	);

	// Once the flash is gone, take the whole UI out of rendering so the page
	// gets every bit of the GPU/CPU. Only the page is left.
	setTimeout(() => {
		for (const node of [stage, ambient, statusBar, core, burst])
			node.hidden = true;
	}, 1200);
}

/* ==========================================================================
   Keyboard + pointer
   ========================================================================== */

// On the code screen any click or digit goes to the code field.
document.addEventListener("mousedown", (event) => {
	if (root.dataset.view === "lock" && event.target !== codeInput)
		event.preventDefault();
});

document.addEventListener("click", focusCode);

document.addEventListener("keydown", (event) => {
	const view = root.dataset.view;

	if (view === "lock") {
		if (document.activeElement !== codeInput && /^\d$/.test(event.key))
			focusCode();
		return;
	}

	if (view === "loading" && event.key === "Escape") return cancelLaunch();

	if (view !== "home") return;

	if (document.activeElement === address) {
		if (event.key === "Escape") {
			if (address.value) {
				address.value = "";
				renderPreview();
			} else {
				address.blur();
			}
		}
		return;
	}

	// Just start typing anywhere; "/" jumps to the field too.
	const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
	if (event.key === "/" && plain) {
		event.preventDefault();
		address.focus();
	} else if (event.key.length === 1 && plain) {
		address.focus();
	}
});

/* ==========================================================================
   Parallax: the rings drift with the mouse/trackpad. Each ring is its own
   GPU layer, so this only slides layers around (nothing is repainted).
   ========================================================================== */

let pointerX = 0;
let pointerY = 0;
let currentX = 0;
let currentY = 0;
let frameRequest = 0;

function onPointerMove(event) {
	pointerX = event.clientX / innerWidth - 0.5;
	pointerY = event.clientY / innerHeight - 0.5;
	if (!frameRequest) frameRequest = requestAnimationFrame(tick);
}

function tick() {
	currentX += (pointerX - currentX) * 0.07;
	currentY += (pointerY - currentY) * 0.07;
	orbits.style.setProperty("--px", currentX.toFixed(4));
	orbits.style.setProperty("--py", currentY.toFixed(4));

	const moving =
		Math.abs(pointerX - currentX) + Math.abs(pointerY - currentY) > 0.0004;
	frameRequest = moving ? requestAnimationFrame(tick) : 0;
}

function startParallax() {
	if (finePointer.matches && !reducedMotion.matches && !isLite())
		addEventListener("pointermove", onPointerMove, { passive: true });
}

function stopParallax() {
	removeEventListener("pointermove", onPointerMove);
	cancelAnimationFrame(frameRequest);
	frameRequest = 0;
}

/* ==========================================================================
   Lite mode: on a device that can't keep the ambient motion smooth, freeze
   it (it looks the same, just still) so typing always stays responsive.
   ========================================================================== */

function isLite() {
	return root.classList.contains("lite");
}

function enableLite() {
	root.classList.add("lite");
	stopParallax();
	try {
		sessionStorage.setItem("lite", "1");
	} catch (err) {
		// Not remembered; it will simply be measured again next time.
	}
}

/**
 * Watches real frame pacing while nothing is transitioning (so the unlock
 * morph never counts against the device) and switches to lite mode if the
 * calm, idle animation itself is choppy.
 */
function measureSmoothness(duration = 1500) {
	return new Promise((resolve) => {
		if (isLite() || reducedMotion.matches) return resolve();

		let gaps = [];
		let start = performance.now();
		let last = 0;
		let view = root.dataset.view;
		const giveUp = start + 9000;
		setTimeout(resolve, 9500); // e.g. the tab stays hidden: just move on

		const calm = () => !busy && !orbits.classList.contains("is-pulse");

		requestAnimationFrame(function sample(now) {
			// The page is opening, the warm-up already started (it would skew
			// the numbers), or this is taking too long: stop judging.
			if (["loading", "launch", "browse"].includes(root.dataset.view))
				return resolve();
			if (engine || now > giveUp) return resolve();

			// A transition happened: let it settle, then start a fresh window.
			if (root.dataset.view !== view || !calm()) {
				view = root.dataset.view;
				gaps = [];
				start = now + 700;
				last = 0;
				return requestAnimationFrame(sample);
			}
			if (now < start) return requestAnimationFrame(sample);

			if (last && now - last < 250) gaps.push(now - last);
			last = now;
			if (now - start < duration) return requestAnimationFrame(sample);

			gaps.sort((a, b) => a - b);
			const typical = gaps[Math.floor(gaps.length * 0.75)];
			// 60Hz frames are ~17ms; a typical frame over 24ms means many are
			// being dropped.
			if (gaps.length >= 20 && typical > 24) enableLite();
			resolve();
		});
	});
}

/* ==========================================================================
   Boot
   ========================================================================== */

async function boot() {
	const fonts = document.fonts
		? Promise.all([
				document.fonts.load('italic 400 48px "Instrument Serif"'),
				document.fonts.load('400 16px "Geist"'),
				document.fonts.load('500 12px "Geist Mono"'),
			]).catch(() => {})
		: null;

	await Promise.race([fonts, wait(1000)]);
	root.classList.remove("boot");
}

setView(root.dataset.view === "home" ? "home" : "lock");
renderDots(0);
renderPreview();
startParallax();

boot().then(() => {
	if (root.dataset.view === "lock") focusCode();
	else address.focus({ preventScroll: true });

	// Let the intro fully finish, check how smooth this device is, then warm
	// up in the background (a slow CPU never has to do both at once).
	// Submitting earlier simply starts the warm-up right away.
	setTimeout(() => measureSmoothness().then(() => void warmUp()), 1900);
});
