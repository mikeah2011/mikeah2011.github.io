/* Reading progress bar — fills as user scrolls */
(function () {
  var bar = document.createElement('div');
  bar.id = 'reading-progress';
  document.body.appendChild(bar);

  function update() {
    var doc = document.documentElement;
    var scrollTop = doc.scrollTop || document.body.scrollTop;
    var scrollHeight = doc.scrollHeight - doc.clientHeight;
    var pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    bar.style.width = pct + '%';
  }

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  document.addEventListener('pjax:complete', update);
  update();
})();
