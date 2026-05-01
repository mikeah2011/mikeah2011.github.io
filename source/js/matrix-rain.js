(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'matrix-rain-bg';
  Object.assign(canvas.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    zIndex: '-1',
    pointerEvents: 'none',
    opacity: '0.55'
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let w, h, cols, drops;
  const fontSize = 16;
  // 拉丁 + 片假名 + 数字 + 二进制感
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]<>/*-+=;アイウエオカキクケコサシスセソタチツテトナニヌネノ'.split('');

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    cols = Math.floor(w / fontSize);
    drops = new Array(cols).fill(1).map(() => Math.random() * -50);
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    // 半透明黑色蒙层 → 拖尾
    ctx.fillStyle = 'rgba(10, 25, 41, 0.08)';
    ctx.fillRect(0, 0, w, h);

    ctx.font = fontSize + "px 'JetBrains Mono', Menlo, monospace";

    for (let i = 0; i < drops.length; i++) {
      const text = chars[Math.floor(Math.random() * chars.length)];
      const x = i * fontSize;
      const y = drops[i] * fontSize;

      // 头部亮白
      if (Math.random() > 0.975) {
        ctx.fillStyle = '#ffffff';
      } else {
        // 科技蓝渐变：靠下偏亮，靠上偏暗
        const intensity = Math.min(1, drops[i] / 20);
        ctx.fillStyle = `rgba(0, 212, 255, ${0.6 + intensity * 0.4})`;
      }
      ctx.fillText(text, x, y);

      if (y > h && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
  }

  let running = true;
  function loop() {
    if (running) draw();
    requestAnimationFrame(loop);
  }
  loop();

  // 暗色模式切换时不需要重置（蒙层颜色用了深蓝，亮色模式略微不和谐但能接受）
  // 移动端禁用以省电
  if (window.matchMedia('(max-width: 768px)').matches) {
    canvas.style.display = 'none';
    running = false;
  }
})();
