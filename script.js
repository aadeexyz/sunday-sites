const thought = document.querySelector("#thought");
const composer = document.querySelector("#composer");
const releaseLayer = document.querySelector("#release-layer");
const floatingStage = document.querySelector("#floating-stage");

if (thought && composer && releaseLayer && floatingStage) {
  const POP_IN_DURATION = 850;
  const STORAGE_KEY = "get-lost-floating-thoughts";
  const SAVE_INTERVAL = 250;
  const WORD_LIFETIME = 5 * 60 * 1000;
  let isReleasing = false;
  let lastFrameTime = 0;
  let lastSavedAt = 0;
  let floatingThoughts = [];

  const placeCaretAtEnd = (element) => {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const clearThought = () => {
    thought.textContent = "";
  };

  const getDraftText = () => thought.textContent.replace(/\s+/g, " ").trim();

  const insertTextAtSelection = (text) => {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
      thought.textContent += text;
      placeCaretAtEnd(thought);
      return;
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const fragment = document.createDocumentFragment();
    const lines = text.split("\n");

    lines.forEach((line, index) => {
      if (index > 0) {
        fragment.appendChild(document.createElement("br"));
      }

      if (line) {
        fragment.appendChild(document.createTextNode(line));
      }
    });

    const lastNode = fragment.lastChild;
    range.insertNode(fragment);

    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    thought.normalize();
  };

  const randomBetween = (min, max) => Math.random() * (max - min) + min;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const saveFloatingThoughts = () => {
    const snapshot = floatingThoughts.map((item) => ({
      createdAt: item.createdAt,
      driftXEnd: item.driftXEnd,
      driftXStart: item.driftXStart,
      driftYEnd: item.driftYEnd,
      driftYStart: item.driftYStart,
      expiresAt: item.expiresAt,
      rotateEnd: item.rotateEnd,
      rotateStart: item.rotateStart,
      swayDuration: item.swayDuration,
      text: item.text,
      vx: item.vx,
      vy: item.vy,
      x: item.x,
      y: item.y,
    }));

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      return;
    }
  };

  const loadFloatingThoughts = () => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const updateFloatingElement = (item) => {
    item.element.style.left = `${item.x}px`;
    item.element.style.top = `${item.y}px`;
  };

  const updateThoughtOpacity = (item, now) => {
    const elapsed = now - item.createdAt;

    if (elapsed >= WORD_LIFETIME) {
      item.element.style.opacity = "0";
      return false;
    }

    item.element.style.opacity = `${clamp(
      1 - elapsed / WORD_LIFETIME,
      0,
      1
    )}`;
    return true;
  };

  const removeExpiredThoughts = (now) => {
    const nextThoughts = [];
    let removedAny = false;

    floatingThoughts.forEach((item) => {
      if (item.expiresAt <= now) {
        item.element.remove();
        removedAny = true;
        return;
      }

      nextThoughts.push(item);
    });

    if (removedAny) {
      floatingThoughts = nextThoughts;
      saveFloatingThoughts();
    }
  };

  const measureFloatingElement = (item) => {
    const rect = item.element.getBoundingClientRect();
    item.width = rect.width;
    item.height = rect.height;
  };

  const getBounds = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const resolveWallCollision = (item, bounds) => {
    const halfWidth = item.width / 2;
    const halfHeight = item.height / 2;

    if (item.x - halfWidth <= 0) {
      item.x = halfWidth;
      item.vx = Math.abs(item.vx);
    } else if (item.x + halfWidth >= bounds.width) {
      item.x = bounds.width - halfWidth;
      item.vx = -Math.abs(item.vx);
    }

    if (item.y - halfHeight <= 0) {
      item.y = halfHeight;
      item.vy = Math.abs(item.vy);
    } else if (item.y + halfHeight >= bounds.height) {
      item.y = bounds.height - halfHeight;
      item.vy = -Math.abs(item.vy);
    }
  };

  const resolveWordCollision = (first, second) => {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const overlapX = first.width / 2 + second.width / 2 - Math.abs(dx);
    const overlapY = first.height / 2 + second.height / 2 - Math.abs(dy);

    if (overlapX <= 0 || overlapY <= 0) {
      return;
    }

    let nx = 0;
    let ny = 0;
    let separation = 0;

    if (overlapX < overlapY) {
      nx = dx >= 0 ? 1 : -1;
      separation = overlapX / 2 + 0.5;
    } else {
      ny = dy >= 0 ? 1 : -1;
      separation = overlapY / 2 + 0.5;
    }

    first.x -= nx * separation;
    first.y -= ny * separation;
    second.x += nx * separation;
    second.y += ny * separation;

    const relativeVelocityX = second.vx - first.vx;
    const relativeVelocityY = second.vy - first.vy;
    const speedAlongNormal = relativeVelocityX * nx + relativeVelocityY * ny;

    if (speedAlongNormal >= 0) {
      return;
    }

    const impulse = -speedAlongNormal;
    first.vx -= impulse * nx;
    first.vy -= impulse * ny;
    second.vx += impulse * nx;
    second.vy += impulse * ny;
  };

  const animateFloatingThoughts = (timestamp) => {
    if (!lastFrameTime) {
      lastFrameTime = timestamp;
    }

    const deltaTime = Math.min((timestamp - lastFrameTime) / 1000, 0.033);
    lastFrameTime = timestamp;
    const now = Date.now();

    if (floatingThoughts.length > 0) {
      removeExpiredThoughts(now);

      const bounds = getBounds();
      const activeThoughts = [];

      floatingThoughts.forEach((item) => {
        if (!updateThoughtOpacity(item, now)) {
          return;
        }

        if (timestamp < item.activationTime) {
          updateFloatingElement(item);
          return;
        }

        item.x += item.vx * deltaTime;
        item.y += item.vy * deltaTime;
        resolveWallCollision(item, bounds);
        activeThoughts.push(item);
      });

      for (let index = 0; index < activeThoughts.length; index += 1) {
        for (
          let nestedIndex = index + 1;
          nestedIndex < activeThoughts.length;
          nestedIndex += 1
        ) {
          resolveWordCollision(activeThoughts[index], activeThoughts[nestedIndex]);
        }
      }

      floatingThoughts.forEach((item) => {
        if (timestamp >= item.activationTime) {
          resolveWallCollision(item, bounds);
        }

        updateFloatingElement(item);
      });

      if (timestamp - lastSavedAt >= SAVE_INTERVAL) {
        saveFloatingThoughts();
        lastSavedAt = timestamp;
      }
    }

    window.requestAnimationFrame(animateFloatingThoughts);
  };

  const createFloatingThought = (text, options = {}) => {
    const bubble = document.createElement("div");
    const motion = document.createElement("div");
    const inner = document.createElement("span");
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const entering = options.entering ?? true;
    const swayDuration =
      options.swayDuration ?? `${randomBetween(5, 9).toFixed(2)}s`;
    const createdAt = options.createdAt ?? Date.now();
    const expiresAt = options.expiresAt ?? createdAt + WORD_LIFETIME;
    const driftXStart =
      options.driftXStart ?? `${randomBetween(-12, 12).toFixed(2)}px`;
    const driftYStart =
      options.driftYStart ?? `${randomBetween(-10, 10).toFixed(2)}px`;
    const driftXEnd =
      options.driftXEnd ?? `${randomBetween(-34, 34).toFixed(2)}px`;
    const driftYEnd =
      options.driftYEnd ?? `${randomBetween(-26, 26).toFixed(2)}px`;
    const rotateStart =
      options.rotateStart ?? `${randomBetween(-2, 2).toFixed(2)}deg`;
    const rotateEnd =
      options.rotateEnd ?? `${randomBetween(-4, 4).toFixed(2)}deg`;
    let x =
      typeof options.x === "number"
        ? options.x
        : randomBetween(80, viewportWidth - 80);
    let y =
      typeof options.y === "number"
        ? options.y
        : randomBetween(80, viewportHeight - 80);

    if (options.x == null && Math.abs(x - centerX) < 160) {
      x += x < centerX ? -140 : 140;
    }

    if (options.y == null && Math.abs(y - centerY) < 120) {
      y += y < centerY ? -110 : 110;
    }

    x = Math.min(Math.max(x, 48), viewportWidth - 48);
    y = Math.min(Math.max(y, 48), viewportHeight - 48);

    bubble.className = entering ? "floating-word is-entering" : "floating-word";
    bubble.style.setProperty("--x", `${x}px`);
    bubble.style.setProperty("--y", `${y}px`);

    motion.className = "floating-word__motion";

    inner.className = "floating-word__inner";
    inner.style.setProperty("--sway-duration", swayDuration);
    inner.style.setProperty("--drift-x-start", driftXStart);
    inner.style.setProperty("--drift-y-start", driftYStart);
    inner.style.setProperty("--drift-x-end", driftXEnd);
    inner.style.setProperty("--drift-y-end", driftYEnd);
    inner.style.setProperty("--rotate-start", rotateStart);
    inner.style.setProperty("--rotate-end", rotateEnd);
    inner.textContent = text;

    motion.appendChild(inner);
    bubble.appendChild(motion);
    floatingStage.appendChild(bubble);

    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(26, 52);
    const item = {
      activationTime: entering ? performance.now() + POP_IN_DURATION : 0,
      createdAt,
      driftXEnd,
      driftXStart,
      driftYEnd,
      driftYStart,
      element: bubble,
      expiresAt,
      width: 0,
      height: 0,
      rotateEnd,
      rotateStart,
      swayDuration,
      text,
      x,
      y,
      vx: typeof options.vx === "number" ? options.vx : Math.cos(angle) * speed,
      vy: typeof options.vy === "number" ? options.vy : Math.sin(angle) * speed,
    };

    measureFloatingElement(item);

    item.x = clamp(item.x, item.width / 2, viewportWidth - item.width / 2);
    item.y = clamp(item.y, item.height / 2, viewportHeight - item.height / 2);

    updateFloatingElement(item);
    updateThoughtOpacity(item, Date.now());
    floatingThoughts.push(item);

    if (entering) {
      window.setTimeout(() => {
        bubble.classList.remove("is-entering");
      }, POP_IN_DURATION);
    }

    return item;
  };

  const spawnFloatingThought = (text) => {
    createFloatingThought(text, { entering: true });
    saveFloatingThoughts();
  };

  const releaseThought = (text) => {
    const released = document.createElement("div");

    isReleasing = true;
    composer.classList.add("is-releasing");
    releaseLayer.replaceChildren();

    released.className = "release-word";
    released.textContent = text;
    releaseLayer.appendChild(released);

    window.setTimeout(() => {
      clearThought();
      composer.classList.remove("is-releasing");
      releaseLayer.replaceChildren();
      spawnFloatingThought(text);
      isReleasing = false;
    }, 520);
  };

  const submitThought = () => {
    const text = getDraftText();

    if (!text || isReleasing) {
      clearThought();
      return;
    }

    releaseThought(text);
  };

  thought.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitThought();
    }
  });

  thought.addEventListener("paste", (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    insertTextAtSelection(text);
  });

  thought.addEventListener("blur", () => {
    if (!isReleasing) {
      clearThought();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!composer.contains(event.target) && document.activeElement === thought) {
      thought.blur();
    }
  });

  window.addEventListener("resize", () => {
    const bounds = getBounds();

    floatingThoughts.forEach((item) => {
      measureFloatingElement(item);
      item.x = clamp(item.x, item.width / 2, bounds.width - item.width / 2);
      item.y = clamp(item.y, item.height / 2, bounds.height - item.height / 2);
      updateFloatingElement(item);
    });

    saveFloatingThoughts();
  });

  window.addEventListener("pagehide", saveFloatingThoughts);

  window.addEventListener("load", () => {
    loadFloatingThoughts().forEach((item) => {
      if (!item || typeof item.text !== "string" || !item.text.trim()) {
        return;
      }

      if (typeof item.expiresAt !== "number" || item.expiresAt <= Date.now()) {
        return;
      }

      createFloatingThought(item.text, {
        createdAt: item.createdAt,
        driftXEnd: item.driftXEnd,
        driftXStart: item.driftXStart,
        driftYEnd: item.driftYEnd,
        driftYStart: item.driftYStart,
        entering: false,
        expiresAt: item.expiresAt,
        rotateEnd: item.rotateEnd,
        rotateStart: item.rotateStart,
        swayDuration: item.swayDuration,
        vx: item.vx,
        vy: item.vy,
        x: item.x,
        y: item.y,
      });
    });

    saveFloatingThoughts();

    thought.focus();
    placeCaretAtEnd(thought);
  });

  window.requestAnimationFrame(animateFloatingThoughts);
}
