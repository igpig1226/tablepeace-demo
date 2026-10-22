(() => {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return;
  document.body.classList.add('motion-ready');
  document.body.classList.add('motion-intro');
  window.setTimeout(() => document.body.classList.remove('motion-intro'), 700);

  const targets = '.feature, .demo-head, .workspace, #workspace-content > *, .vision-head, .vision-console, .vision-panel, .cap-card, .cap-preview, .boundary-wrap, .heading-row, .option-edit, .shell-content > .card, .page > .card';
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, {threshold: .08, rootMargin: '0px 0px -32px 0px'});

  function register(root = document) {
    const nodes = root.matches?.(targets) ? [root, ...root.querySelectorAll(targets)] : [...root.querySelectorAll(targets)];
    for (const node of nodes) {
      if (node.hasAttribute('data-reveal')) continue;
      node.setAttribute('data-reveal', '');
      const index = [...node.parentElement.children].indexOf(node);
      node.style.setProperty('--reveal-delay', `${Math.min(index, 5) * 65}ms`);
      observer.observe(node);
    }
  }
  register();
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) register(node);
    }
  }).observe(document.body, {childList: true, subtree: true});

  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointermove', event => {
      const card = event.target.closest?.('.hero-preview');
      if (!card) return;
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      const y = (event.clientY - box.top) / box.height - .5;
      card.style.setProperty('--tilt-x', `${(-y * 4).toFixed(2)}deg`);
      card.style.setProperty('--tilt-y', `${(x * 4).toFixed(2)}deg`);
      card.style.setProperty('--spot-x', `${((x + .5) * 100).toFixed(0)}%`);
      card.style.setProperty('--spot-y', `${((y + .5) * 100).toFixed(0)}%`);
    });
    document.addEventListener('pointerout', event => {
      const card = event.target.closest?.('.hero-preview');
      if (!card || card.contains(event.relatedTarget)) return;
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    });
  }
})();
