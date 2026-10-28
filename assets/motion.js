/* All elements start visible. Motion never controls data or navigation. */
window.GECCMotion = (() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let observer = null;
  let running = [];
  let frame = 0;
  let pointer = null;
  function clear() {
    observer?.disconnect();
    observer = null;
    running.forEach((a) => a.cancel());
    running = [];
    cancelAnimationFrame(frame);
    frame = 0;
    pointer = null;
  }
  function animate(el, frames, options) {
    if (!el?.animate || reduced.matches) return;
    const a = el.animate(frames, {
      easing: "cubic-bezier(.16,1,.3,1)",
      ...options,
    });
    running.push(a);
    a.finished.catch(() => {});
  }
  function enter() {
    clear();
    const content = document.querySelector("#content");
    if (!content || reduced.matches) return;
    animate(
      content,
      [
        { opacity: 0.88, transform: "translateY(5px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 220 },
    );
    if (!("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          animate(
            entry.target,
            [
              { opacity: 0.8, transform: "translateY(8px)" },
              { opacity: 1, transform: "none" },
            ],
            {
              duration: 320,
              delay:
                Math.min(3, Number(entry.target.dataset.motionOrder) || 0) * 40,
            },
          );
        }),
      { threshold: 0.08 },
    );
    content
      .querySelectorAll(
        ".group-choice,.library-card,.committee-card,.summary-item",
      )
      .forEach((el, i) => {
        el.dataset.motionOrder = i % 4;
        observer.observe(el);
      });
    content
      .querySelectorAll(".bar>span,.hb-f,.sx-bar>span")
      .forEach((el) =>
        animate(
          el,
          [{ transform: "scaleX(.96)" }, { transform: "scaleX(1)" }],
          { duration: 320 },
        ),
      );
  }
  document.addEventListener(
    "pointermove",
    (e) => {
      if (reduced.matches || e.pointerType === "touch") return;
      const card = e.target.closest("[data-visual-card]");
      if (!card) return;
      pointer = { card, x: e.clientX, y: e.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pointer?.card.isConnected) return;
        const r = pointer.card.getBoundingClientRect();
        pointer.card.style.setProperty(
          "--pointer-x",
          `${pointer.x - r.left}px`,
        );
        pointer.card.style.setProperty("--pointer-y", `${pointer.y - r.top}px`);
      });
    },
    { passive: true },
  );
  reduced.addEventListener("change", () => {
    clear();
    if (reduced.matches)
      document.querySelectorAll("[data-visual-card]").forEach((c) => {
        c.style.removeProperty("--pointer-x");
        c.style.removeProperty("--pointer-y");
      });
  });
  function menu(el) {
    animate(
      el,
      [
        { transform: "translateX(-12px)" },
        { transform: "translateX(2px)", offset: 0.72 },
        { transform: "translateX(0)" },
      ],
      { duration: 300 },
    );
  }
  return { enter, clear, menu };
})();
