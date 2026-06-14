/**
 * Post-build patch: Professional categories page with icons, descriptions, counts.
 * Run after `hexo generate`: node scripts/patch-categories-chunk.js
 *
 * Strategy: Write a separate categories.js to public/static/js/ and
 * add a <script> tag to public/index.html. This avoids modifying the
 * minified main JS bundle (which is fragile and can break the entire app).
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 1. Write the categories script as a separate file
const CATEGORIES_JS = `
(function(){
  const __CATEGORIES_PATCH__ = 1;
  const CAT_META={php:{icon:"🐘",desc:"Laravel、Composer、PHP-FPM、Swoole 生态",color:"#8892BF"},architecture:{icon:"🏗️",desc:"微服务、DDD、CQRS、事件驱动、设计模式",color:"#F59E0B"},database:{icon:"🗄️",desc:"MySQL、PostgreSQL、Redis、MongoDB、索引优化",color:"#10B981"},ai:{icon:"🤖",desc:"LLM、Agent、RAG、Prompt Engineering、MLOps",color:"#8B5CF6"},devops:{icon:"🚀",desc:"Docker、K8s、CI/CD、监控、SRE、基础设施",color:"#EF4444"},frontend:{icon:"🎨",desc:"Vue、React、TypeScript、CSS、构建工具",color:"#06B6D4"},macos:{icon:"🍎",desc:"macOS 开发环境、Homebrew、终端工具链",color:"#A855F7"},engineering:{icon:"⚙️",desc:"工程实践、代码质量、测试、文档、流程",color:"#6366F1"},misc:{icon:"📦",desc:"杂项、工具、效率、杂记",color:"#64748B"},mobile:{icon:"📱",desc:"iOS、Android、React Native、uni-app",color:"#EC4899"},go:{icon:"🐽",desc:"Go 语言、并发、微服务、云原生",color:"#00ADD8"},network:{icon:"🌐",desc:"TCP/IP、HTTP、DNS、负载均衡、安全",color:"#14B8A6"},rust:{icon:"🦀",desc:"Rust 语言、系统编程、WebAssembly",color:"#DEA584"},security:{icon:"🔒",desc:"Web 安全、OWASP、认证授权、加密",color:"#DC2626"},mq:{icon:"📨",desc:"RabbitMQ、Kafka、消息队列、事件驱动",color:"#F97316"},testing:{icon:"🧪",desc:"单元测试、集成测试、E2E、TDD",color:"#22C55E"},elixir:{icon:"💎",desc:"Elixir、Phoenix、函数式编程、OTP",color:"#A855F7"},python:{icon:"🐍",desc:"Python、数据处理、脚本、自动化",color:"#3B82F6"},blog:{icon:"✍️",desc:"博客写作、技术写作、内容创作",color:"#EC4899"}};

  function renderCatsWithData(container, data) {
    if (container.dataset.catsLoaded) return;
    container.dataset.catsLoaded = "1";
    var top = data.filter(function(j){ return !j.slug.includes("/"); }).sort(function(j,v){ return v.count - j.count; });
    if (top.length === 0) return;

    var totalArticles = top.reduce(function(s,c){ return s + c.count; }, 0);

    var wrapper = document.createElement("div");
    wrapper.className = "flex flex-col mt-20";
    wrapper.innerHTML = '<div class="post-header"><ul class="breadcrumbs flex flex-row gap-6 text-white z-50 px-4"><li>首页</li><li>›</li><li>分类</li></ul><h1 class="post-title text-white uppercase">分类</h1></div><div class="main-grid"><div class="relative"><div class="post-html bg-ob-deep-800 px-14 py-16 rounded-2xl shadow-xl block min-h-screen"></div></div><div class="col-span-1"><div></div></div></div>';

    var box = wrapper.querySelector(".post-html");

    var header = document.createElement("div");
    header.style.cssText = "text-align:center;margin-bottom:28px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.06)";
    header.innerHTML = '<span style="font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + top.length + '</span><span style="font-size:14px;color:#94a3b8;margin-left:8px">个分类</span><span style="color:#475569;margin:0 12px">·</span><span style="font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#f59e0b,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + totalArticles + '</span><span style="font-size:14px;color:#94a3b8;margin-left:8px">篇文章</span>';
    box.appendChild(header);

    var grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px";

    top.forEach(function(cat) {
      var meta = CAT_META[cat.slug] || {icon:"📄",desc:"",color:"#64748b"};
      var div = document.createElement("article");
      div.style.cssText = "position:relative;overflow:hidden;padding:22px 20px;border-radius:14px;background:rgba(15,15,30,0.5);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.05);cursor:pointer;transition:all 0.35s cubic-bezier(.4,0,.2,1)";
      div.innerHTML = '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,' + meta.color + ',' + meta.color + '55);opacity:0.7"></div><div style="display:flex;align-items:flex-start;gap:14px"><div style="font-size:2rem;line-height:1;flex-shrink:0;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:' + meta.color + '12">' + meta.icon + '</div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:16px;font-weight:700;color:#e2e8f0;text-transform:capitalize;letter-spacing:0.01em">' + cat.name + '</span><span style="font-size:12px;font-weight:700;color:' + meta.color + ';background:' + meta.color + '15;padding:3px 10px;border-radius:20px;flex-shrink:0;margin-left:8px">' + cat.count + ' 篇</span></div>' + (meta.desc ? '<p style="font-size:12.5px;color:#94a3b8;line-height:1.5;margin:0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' + meta.desc + '</p>' : '') + '</div></div>';
      div.addEventListener("mouseenter", function() { div.style.transform = "translateY(-3px)"; div.style.borderColor = meta.color + "33"; div.style.boxShadow = "0 12px 32px " + meta.color + "12"; });
      div.addEventListener("mouseleave", function() { div.style.transform = ""; div.style.borderColor = "rgba(255,255,255,0.05)"; div.style.boxShadow = "none"; });
      grid.appendChild(div);
    });

    box.appendChild(grid);
    container.innerHTML = "";
    container.appendChild(wrapper);
  }

  function checkAndRender() {
    var p = window.location.pathname.replace(/\\/+$/, "");
    if (p !== "/category" && p !== "/category/") return;

    var dataPromise = fetch("/api/categories.json").then(function(r){ return r.json(); });

    var done = false;
    function tryRender() {
      if (done) return false;
      var container = document.querySelector("#App-Container .relative.z-10");
      if (container) {
        done = true;
        dataPromise.then(function(data) { renderCatsWithData(container, data); });
        return true;
      }
      return false;
    }

    if (tryRender()) return;

    // MutationObserver for instant detection
    var observer = new MutationObserver(function() {
      if (tryRender()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // rAF loop fallback for 5s
    var frames = 0;
    function rafLoop() {
      if (done || frames++ > 300) { observer.disconnect(); return; }
      if (!tryRender()) requestAnimationFrame(rafLoop);
    }
    requestAnimationFrame(rafLoop);

    // Final timeout fallback
    setTimeout(function() { observer.disconnect(); }, 5000);
  }

  // Run on DOMContentLoaded or immediately
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkAndRender);
  } else {
    checkAndRender();
  }
})();
`;

const categoriesJsPath = path.join(PUBLIC_DIR, 'static', 'js', 'categories.js');
fs.writeFileSync(categoriesJsPath, CATEGORIES_JS.trim(), 'utf8');
console.log('Written: categories.js');

// 2. Inject <script> tag into ALL HTML files (SPA shell is duplicated per route)
const indexPath = path.join(PUBLIC_DIR, 'index.html');
if (fs.existsSync(indexPath)) {
  const rootHtml = fs.readFileSync(indexPath, 'utf8');
  const scriptTag = '<script src="/static/js/categories.js"></script>';

  // Find all index.html files in public/
  function findHtmlFiles(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(findHtmlFiles(full));
      } else if (entry.name === 'index.html') {
        results.push(full);
      }
    }
    return results;
  }

  const allHtml = findHtmlFiles(PUBLIC_DIR);
  let injected = 0;
  for (const htmlPath of allHtml) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (!html.includes('categories.js') && html.includes('</body>')) {
      html = html.replace('</body>', scriptTag + '</body>');
      fs.writeFileSync(htmlPath, html, 'utf8');
      injected++;
    }
  }
  console.log(`Injected categories.js into ${injected} HTML files (${allHtml.length} total)`);
} else {
  console.log('WARNING: index.html not found in public/');
}
