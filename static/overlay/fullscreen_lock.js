/*
 * Fullscreen keyboard + mouse lock.
 *
 * Behaviour ported from the 19 June React project (FullscreenOnClick.tsx):
 *
 *   - A click anywhere outside a [data-no-fs-audio] subtree requests
 *     documentElement.requestFullscreen().
 *   - On ENTER: attach blocking handlers to document.on{keydown,keyup,
 *     keypress,contextmenu,mousedown,mouseup}; register capture-phase
 *     window listeners for all mouse events; hide the cursor via a
 *     stylesheet; call navigator.keyboard.lock() when available; call
 *     document.body.requestPointerLock().
 *   - On EXIT: restore the previous handlers, remove the cursor style,
 *     call navigator.keyboard.unlock() when available.
 *   - When the browser has no Keyboard-Lock API (Safari / Firefox), an
 *     ESC-driven exit is treated as "not-yet three escapes" and we
 *     re-enter fullscreen. Only after 3 ESC exits within 600 ms of each
 *     other does the user finally stay outside fullscreen.
 */

(() => {
  "use strict";

  const ESC_EXITS_REQUIRED = 3;
  const CURSOR_STYLE_ID = "ns-fs-cursor-none";
  const FS_ACTIVE_CLASS = "ns-fs";
  const MOUSE_EVENTS = [
    "mousedown",
    "mouseup",
    "click",
    "auxclick",
    "dblclick",
    "contextmenu",
  ];

  const stored = {
    onkeydown: null,
    onkeyup: null,
    onkeypress: null,
    oncontextmenu: null,
    onmousedown: null,
    onmouseup: null,
    cursor: "",
  };

  let blocksActive = false;
  let escExitCount = 0;
  let lastEscAt = 0;

  const getKeyboardLock = () =>
    navigator && navigator.keyboard ? navigator.keyboard : null;
  const keyboardLockAvailable = Boolean(getKeyboardLock());

  const isFullscreen = () =>
    Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement,
    );

  const lockKeyboard = () => {
    const kb = getKeyboardLock();
    if (!kb) return;
    try {
      const p = kb.lock();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {
      /* ignore */
    }
  };

  const unlockKeyboard = () => {
    const kb = getKeyboardLock();
    if (!kb) return;
    try {
      kb.unlock();
    } catch (_) {
      /* ignore */
    }
  };

  const requestPointerLock = () => {
    const body = document.body;
    const rpl =
      (body.requestPointerLock && body.requestPointerLock.bind(body)) ||
      (body.webkitRequestPointerLock && body.webkitRequestPointerLock.bind(body)) ||
      (body.mozRequestPointerLock && body.mozRequestPointerLock.bind(body));
    if (!rpl) return;
    try {
      rpl();
    } catch (_) {
      /* ignore */
    }
  };

  const requestFs = () => {
    const el = document.documentElement;
    const rfs =
      (el.requestFullscreen && el.requestFullscreen.bind(el)) ||
      (el.webkitRequestFullscreen && el.webkitRequestFullscreen.bind(el)) ||
      (el.mozRequestFullScreen && el.mozRequestFullScreen.bind(el)) ||
      (el.msRequestFullscreen && el.msRequestFullscreen.bind(el));
    if (!rfs) return;
    try {
      const result = rfs();
      if (result && typeof result.then === "function") {
        result
          .then(() => {
            lockKeyboard();
            requestPointerLock();
          })
          .catch(() => {});
      } else {
        lockKeyboard();
        requestPointerLock();
      }
    } catch (_) {
      /* ignore */
    }
  };

  const injectCursorStyle = () => {
    if (document.getElementById(CURSOR_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CURSOR_STYLE_ID;
    style.textContent = "*, *::before, *::after { cursor: none !important; }";
    document.head.appendChild(style);
  };

  const removeCursorStyle = () => {
    const node = document.getElementById(CURSOR_STYLE_ID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  };

  const applyBlocks = () => {
    stored.onkeydown = document.onkeydown;
    stored.onkeyup = document.onkeyup;
    stored.onkeypress = document.onkeypress;
    stored.oncontextmenu = document.oncontextmenu;
    stored.onmousedown = document.onmousedown;
    stored.onmouseup = document.onmouseup;
    stored.cursor = document.body.style.cursor;

    const blockHandler = function (e) {
      e.preventDefault();
      return false;
    };

    document.onkeydown = blockHandler;
    document.onkeyup = blockHandler;
    document.onkeypress = blockHandler;
    document.oncontextmenu = blockHandler;
    document.onmousedown = blockHandler;
    document.onmouseup = blockHandler;

    document.body.style.cursor = "none";
    injectCursorStyle();
    requestPointerLock();
  };

  const removeBlocks = () => {
    document.onkeydown = stored.onkeydown;
    document.onkeyup = stored.onkeyup;
    document.onkeypress = stored.onkeypress;
    document.oncontextmenu = stored.oncontextmenu;
    document.onmousedown = stored.onmousedown;
    document.onmouseup = stored.onmouseup;
    document.body.style.cursor = stored.cursor;
    removeCursorStyle();
  };

  const blockMouseEvent = (e) => {
    if (!isFullscreen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape" || e.code === "Escape") {
      lastEscAt = Date.now();
    }
  };

  const handleClick = (e) => {
    const target = e.target;
    if (target && target.closest && target.closest("[data-no-fs-audio]")) {
      return;
    }
    if (isFullscreen()) return;
    escExitCount = 0;
    requestFs();
  };

  const handleFsChange = () => {
    if (isFullscreen()) {
      document.documentElement.classList.add(FS_ACTIVE_CLASS);
      lockKeyboard();
      requestPointerLock();
      if (!blocksActive) {
        applyBlocks();
        blocksActive = true;
      }
      escExitCount = 0;
      return;
    }

    document.documentElement.classList.remove(FS_ACTIVE_CLASS);
    if (blocksActive) {
      removeBlocks();
      blocksActive = false;
    }
    unlockKeyboard();

    if (keyboardLockAvailable) return;

    const wasEsc = Date.now() - lastEscAt < 600;
    if (!wasEsc) return;

    escExitCount += 1;
    if (escExitCount < ESC_EXITS_REQUIRED) {
      window.setTimeout(() => {
        if (!isFullscreen()) requestFs();
      }, 30);
    } else {
      escExitCount = 0;
    }
  };

  window.addEventListener("click", handleClick);
  window.addEventListener("keydown", handleKeyDown, true);
  MOUSE_EVENTS.forEach((evt) =>
    window.addEventListener(evt, blockMouseEvent, true),
  );
  document.addEventListener("fullscreenchange", handleFsChange);
  document.addEventListener("webkitfullscreenchange", handleFsChange);
  document.addEventListener("mozfullscreenchange", handleFsChange);
  document.addEventListener("msfullscreenchange", handleFsChange);
})();
