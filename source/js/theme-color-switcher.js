/**
 * Theme color switcher — floating palette button at bottom-right.
 * Persists choice to localStorage and overrides --theme-color CSS vars on the fly.
 */
(function () {
  'use strict';

  const PRESETS = [
    { id: 'blue',   name: 'Vercel 蓝', main: '#0070f3', light: '#3291ff', dark: '#0761d1' },
    { id: 'purple', name: 'Vercel 紫', main: '#7928ca', light: '#8a3fd1', dark: '#4c2889' },
    { id: 'cyan',   name: 'Vercel 青', main: '#50e3c2', light: '#79ffe1', dark: '#29bc9b' },
    { id: 'pink',   name: 'Vercel 粉', main: '#ff0080', light: '#ff4893', dark: '#cc0066' },
    { id: 'amber',  name: 'Vercel 橙', main: '#f5a623', light: '#f7b955', dark: '#ab570a' },
    { id: 'mono',   name: '极简白', main: '#ededed', light: '#fafafa', dark: '#a1a1a1' }
  ];

  const STORAGE_KEY = 'mb-theme-color';
  const BG_STORAGE_KEY = 'mb-bg';

  // Background presets — id 'default' = no override (use theme bg)
  const BG_COLORS = [
    { id: 'default', name: '默认',   value: null,        swatch: 'linear-gradient(135deg,#888 50%,#fff 50%)' },
    { id: 'black',   name: '纯黑',   value: '#000000',   swatch: '#000000' },
    { id: 'navy',    name: '深蓝',   value: '#0a1929',   swatch: '#0a1929' },
    { id: 'purple',  name: '深紫',   value: '#1a0a2e',   swatch: '#1a0a2e' },
    { id: 'white',   name: '纯白',   value: '#ffffff',   swatch: '#ffffff' },
    { id: 'beige',   name: '米色',   value: '#f5f1e8',   swatch: '#f5f1e8' }
  ];

  const BG_IMAGES = [
    { id: 'img-tech',     name: '科技',   value: '/img/bg/bg-tech.jpg' },
    { id: 'img-stars',    name: '星空',   value: '/img/bg/bg-stars.jpg' },
    { id: 'img-gradient', name: '渐变',   value: '/img/bg/bg-gradient.jpg' }
  ];

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3
      ? h.split('').map(c => c + c).join('')
      : h;
    const n = parseInt(v, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function applyColor(preset) {
    const { main, light, dark } = preset;
    const root = document.documentElement;
    const { r, g, b } = hexToRgb(main);
    const rgba = (a) => `rgba(${r},${g},${b},${a})`;

    // butterfly's actual CSS variable names
    root.style.setProperty('--btn-bg', main);
    root.style.setProperty('--btn-hover-color', dark);
    root.style.setProperty('--text-bg-hover', rgba(0.7));
    root.style.setProperty('--pseudo-hover', dark);
    root.style.setProperty('--scrollbar-color', main);
    root.style.setProperty('--default-bg-color', main);
    root.style.setProperty('--toc-link-color', light);
    root.style.setProperty('--hr-border', main);
    root.style.setProperty('--blockquote-bg', rgba(0.1));
    // our own custom var (used by gradient headings + reading progress + banner title)
    root.style.setProperty('--theme-color', main);
    root.style.setProperty('--theme-color-light', light);
    root.style.setProperty('--theme-color-dark', dark);
    root.style.setProperty('--link-color', main);

    // canvas_nest line color
    const cn = document.querySelector('script[src*="canvas-nest"]');
    if (cn) cn.setAttribute('color', `${r},${g},${b}`);

    // Pagefind UI primary color (only on /search/)
    root.style.setProperty('--pagefind-ui-primary', main);

    // text selection color (need a dynamic stylesheet since ::selection can't read var directly in some engines)
    let sel = document.getElementById('tcs-selection-style');
    if (!sel) {
      sel = document.createElement('style');
      sel.id = 'tcs-selection-style';
      document.head.appendChild(sel);
    }
    sel.textContent = `::selection{background:${main};color:#fff}`;

    // Update active swatch state (color row only — bg row is handled in applyBg)
    document.querySelectorAll('.tcs-swatch:not(.tcs-bg-swatch)').forEach(el => {
      el.classList.toggle('tcs-active', el.dataset.id === preset.id);
    });
  }

  function getSavedPreset() {
    try {
      const id = localStorage.getItem(STORAGE_KEY);
      if (id === 'custom') {
        const raw = localStorage.getItem(STORAGE_KEY + '-custom');
        if (raw) return JSON.parse(raw);
      }
      return PRESETS.find(p => p.id === id) || PRESETS[0];
    } catch (_) {
      return PRESETS[0];
    }
  }

  function savePreset(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
  }

  function applyBg(bgId) {
    const all = [...BG_COLORS, ...BG_IMAGES];
    const bg = all.find(b => b.id === bgId) || BG_COLORS[0];
    let style = document.getElementById('tcs-bg-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'tcs-bg-style';
      document.head.appendChild(style);
    }
    if (!bg.value) {
      style.textContent = '';
    } else if (bg.value.startsWith('/')) {
      // image
      style.textContent = `body, #web_bg{background:url("${bg.value}") center/cover fixed no-repeat !important;}`;
    } else {
      // solid color
      style.textContent = `body, #web_bg{background:${bg.value} !important;}`;
    }
    document.querySelectorAll('.tcs-bg-swatch').forEach(el => {
      el.classList.toggle('tcs-active', el.dataset.id === bg.id);
    });
  }

  function getSavedBg() {
    try { return localStorage.getItem(BG_STORAGE_KEY) || 'default'; }
    catch (_) { return 'default'; }
  }

  function saveBg(id) {
    try { localStorage.setItem(BG_STORAGE_KEY, id); } catch (_) {}
  }

  function buildUI() {
    // Inject toggle into butterfly's rightside settings group (next to darkmode/aside toggle)
    const host = document.getElementById('rightside-config-hide') || document.getElementById('rightside');
    if (!host) return;

    const toggle = document.createElement('button');
    toggle.id = 'tcs-toggle';
    toggle.type = 'button';
    toggle.title = '主题色 / 背景';
    toggle.setAttribute('aria-label', '主题色');
    toggle.innerHTML = '<i class="fas fa-palette"></i>';
    host.appendChild(toggle);

    const panel = document.createElement('div');
    panel.id = 'tcs-panel';
    panel.setAttribute('role', 'dialog');
    panel.innerHTML = `
        <div class="tcs-title">主题色</div>
        <div class="tcs-grid">
          ${PRESETS.map(p => `
            <button class="tcs-swatch" data-id="${p.id}" title="${p.name}"
                    style="background:${p.main}"></button>
          `).join('')}
          <label class="tcs-custom" title="自定义颜色">
            <input type="color" class="tcs-custom-color" value="#0070f3">
          </label>
          <input type="text" class="tcs-custom-hex" placeholder="#hex" maxlength="7">
        </div>
        <div class="tcs-title" style="margin-top:12px">背景色</div>
        <div class="tcs-grid">
          ${BG_COLORS.map(b => `
            <button class="tcs-swatch tcs-bg-swatch" data-id="${b.id}" title="${b.name}"
                    style="background:${b.swatch}"></button>
          `).join('')}
          <label class="tcs-custom" title="自定义背景色">
            <input type="color" class="tcs-custom-bg" value="#000000">
          </label>
        </div>
        <div class="tcs-title" style="margin-top:12px">背景图</div>
        <div class="tcs-grid tcs-grid-img">
          ${BG_IMAGES.map(b => `
            <button class="tcs-swatch tcs-bg-swatch tcs-bg-img" data-id="${b.id}" title="${b.name}"
                    style="background-image:url('${b.value}')"></button>
          `).join('')}
        </div>
    `;
    document.body.appendChild(panel);

    toggle.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('tcs-open');
    });
    document.addEventListener('click', e => {
      if (e.target !== toggle && !toggle.contains(e.target) && !panel.contains(e.target)) {
        panel.classList.remove('tcs-open');
      }
    });

    panel.querySelectorAll('.tcs-swatch:not(.tcs-bg-swatch)').forEach(el => {
      el.addEventListener('click', () => {
        const preset = PRESETS.find(p => p.id === el.dataset.id);
        if (preset) {
          applyColor(preset);
          savePreset(preset.id);
        }
      });
    });

    panel.querySelectorAll('.tcs-bg-swatch').forEach(el => {
      el.addEventListener('click', () => {
        applyBg(el.dataset.id);
        saveBg(el.dataset.id);
      });
    });

    // Custom color picker (theme color)
    const customColor = panel.querySelector('.tcs-custom-color');
    const customHex = panel.querySelector('.tcs-custom-hex');
    function applyCustomMain(hex) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
      const { r, g, b } = hexToRgb(hex);
      const lighten = (v) => Math.min(255, Math.round(v + (255 - v) * 0.3));
      const darken  = (v) => Math.max(0,   Math.round(v * 0.7));
      const toHex = (v) => v.toString(16).padStart(2, '0');
      const light = `#${toHex(lighten(r))}${toHex(lighten(g))}${toHex(lighten(b))}`;
      const dark  = `#${toHex(darken(r))}${toHex(darken(g))}${toHex(darken(b))}`;
      const preset = { id: 'custom', name: '自定义', main: hex, light, dark };
      applyColor(preset);
      try { localStorage.setItem(STORAGE_KEY + '-custom', JSON.stringify(preset)); } catch (_) {}
      savePreset('custom');
    }
    customColor.addEventListener('input', e => {
      customHex.value = e.target.value;
      applyCustomMain(e.target.value);
    });
    customHex.addEventListener('change', e => {
      let v = e.target.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      customColor.value = v;
      applyCustomMain(v);
    });

    // Custom background color
    const customBg = panel.querySelector('.tcs-custom-bg');
    customBg.addEventListener('input', e => {
      const hex = e.target.value;
      let style = document.getElementById('tcs-bg-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'tcs-bg-style';
        document.head.appendChild(style);
      }
      style.textContent = `body, #web_bg{background:${hex} !important;}`;
      try { localStorage.setItem(BG_STORAGE_KEY, 'custom:' + hex); } catch (_) {}
      panel.querySelectorAll('.tcs-bg-swatch').forEach(el => el.classList.remove('tcs-active'));
    });
  }

  function init() {
    buildUI();
    applyColor(getSavedPreset());
    applyBg(getSavedBg());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
