/** 
 * Post-build patch: Professional categories page with icons, descriptions, counts.
 * Run after `hexo generate`: node scripts/patch-categories-chunk.js
 * 
 * Strategy: Inject a self-contained script into ALL pages (via the main JS chunk).
 * When the URL path matches /category, render categories directly into the DOM.
 * This bypasses the Vue Router entirely.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Find the main JS chunk
const mainJsDir = path.join(PUBLIC_DIR, 'static', 'js');
if (!fs.existsSync(mainJsDir)) {
  console.log('Skip patch-categories: static/js not found');
  return;
}

const mainFiles = fs.readdirSync(mainJsDir).filter(f => 
  f.endsWith('.js') && !f.endsWith('.js.br') && !f.endsWith('.js.gz')
);

// Find the main entry JS (120aa8f8.js or similar large file)
let mainFile = null;
let mainPath = null;
for (const f of mainFiles) {
  const fp = path.join(mainJsDir, f);
  const content = fs.readFileSync(fp, 'utf8');
  if (content.includes('oi.mount("#app")')) {
    mainFile = f;
    mainPath = fp;
    break;
  }
}

if (!mainPath) {
  console.log('Skip patch-categories: main entry JS not found');
  return;
}

const original = fs.readFileSync(mainPath, 'utf8');

// Check if already patched
if (original.includes('__CATEGORIES_PATCH__')) {
  console.log('Skip patch-categories: already patched');
  return;
}

// The injection script - self-contained, no Vue dependency
const injection = `
;{
  const __CATEGORIES_PATCH__ = 1;
  const CAT_META={php:{icon:"🐘",desc:"Laravel、Composer、PHP-FPM、Swoole 生态",color:"#8892BF"},architecture:{icon:"🏗️",desc:"微服务、DDD、CQRS、事件驱动、设计模式",color:"#F59E0B"},database:{icon:"🗄️",desc:"MySQL、PostgreSQL、Redis、MongoDB、索引优化",color:"#10B981"},ai:{icon:"🤖",desc:"LLM、Agent、RAG、Prompt Engineering、MLOps",color:"#8B5CF6"},devops:{icon:"🚀",desc:"Docker、K8s、CI/CD、监控、SRE、基础设施",color:"#EF4444"},frontend:{icon:"🎨",desc:"Vue、React、TypeScript、CSS、构建工具",color:"#06B6D4"},macos:{icon:"🍎",desc:"macOS 开发环境、Homebrew、终端工具链",color:"#A855F7"},engineering:{icon:"⚙️",desc:"工程实践、代码质量、测试、文档、流程",color:"#6366F1"},misc:{icon:"📦",desc:"杂项、工具、效率、杂记",color:"#64748B"},mobile:{icon:"📱",desc:"iOS、Android、React Native、uni-app",color:"#EC4899"},go:{icon:"🐽",desc:"Go 语言、并发、微服务、云原生",color:"#00ADD8"},network:{icon:"🌐",desc:"TCP/IP、HTTP、DNS、负载均衡、安全",color:"#14B8A6"},rust:{icon:"🦀",desc:"Rust 语言、系统编程、WebAssembly",color:"#DEA584"},security:{icon:"🔒",desc:"Web 安全、OWASP、认证授权、加密",color:"#DC2626"},mq:{icon:"📨",desc:"RabbitMQ、Kafka、消息队列、事件驱动",color:"#F97316"},testing:{icon:"🧪",desc:"单元测试、集成测试、E2E、TDD",color:"#22C55E"},elixir:{icon:"💎",desc:"Elixir、Phoenix、函数式编程、OTP",color:"#A855F7"},python:{icon:"🐍",desc:"Python、数据处理、脚本、自动化",color:"#3B82F6"},blog:{icon:"✍️",desc:"博客写作、技术写作、内容创作",color:"#EC4899"}};
  
  function renderCatsWithData(container, data) {
    if (container.dataset.catsLoaded) return;
    container.dataset.catsLoaded = "1";
        const top = data.filter(j => !j.slug.includes("/")).sort((j, v) => v.count - j.count);
        if (top.length === 0) return;
        
        const totalArticles = top.reduce((s, c) => s + c.count, 0);
        
        // Create the categories page structure
        const wrapper = document.createElement("div");
        wrapper.className = "flex flex-col mt-20";
        wrapper.innerHTML = '<div class="post-header"><ul class="breadcrumbs flex flex-row gap-6 text-white z-50 px-4"><li>首页</li><li>›</li><li>分类</li></ul><h1 class="post-title text-white uppercase">分类</h1></div><div class="main-grid"><div class="relative"><div class="post-html bg-ob-deep-800 px-14 py-16 rounded-2xl shadow-xl block min-h-screen"></div></div><div class="col-span-1"><div></div></div></div>';
        
        const box = wrapper.querySelector(".post-html");
        
        // Stats header
        const header = document.createElement("div");
        header.style.cssText = "text-align:center;margin-bottom:28px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.06)";
        header.innerHTML = '<span style="font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + top.length + '</span><span style="font-size:14px;color:#94a3b8;margin-left:8px">个分类</span><span style="color:#475569;margin:0 12px">·</span><span style="font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#f59e0b,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + totalArticles + '</span><span style="font-size:14px;color:#94a3b8;margin-left:8px">篇文章</span>';
        box.appendChild(header);
        
        // Grid of category cards
        const grid = document.createElement("div");
        grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px";
        
        top.forEach(cat => {
          const meta = CAT_META[cat.slug] || {icon:"📄",desc:"",color:"#64748b"};
          const div = document.createElement("article");
          div.style.cssText = "position:relative;overflow:hidden;padding:22px 20px;border-radius:14px;background:rgba(15,15,30,0.5);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.05);cursor:pointer;transition:all 0.35s cubic-bezier(.4,0,.2,1)";
          div.innerHTML = '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,' + meta.color + ',' + meta.color + '55);opacity:0.7"></div><div style="display:flex;align-items:flex-start;gap:14px"><div style="font-size:2rem;line-height:1;flex-shrink:0;width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:' + meta.color + '12">' + meta.icon + '</div><div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:16px;font-weight:700;color:#e2e8f0;text-transform:capitalize;letter-spacing:0.01em">' + cat.name + '</span><span style="font-size:12px;font-weight:700;color:' + meta.color + ';background:' + meta.color + '15;padding:3px 10px;border-radius:20px;flex-shrink:0;margin-left:8px">' + cat.count + ' 篇</span></div>' + (meta.desc ? '<p style="font-size:12.5px;color:#94a3b8;line-height:1.5;margin:0;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' + meta.desc + '</p>' : '') + '</div></div>';
          div.addEventListener("mouseenter", () => { div.style.transform = "translateY(-3px)"; div.style.borderColor = meta.color + "33"; div.style.boxShadow = "0 12px 32px " + meta.color + "12"; });
          div.addEventListener("mouseleave", () => { div.style.transform = ""; div.style.borderColor = "rgba(255,255,255,0.05)"; div.style.boxShadow = "none"; });
          grid.appendChild(div);
        });
        
        box.appendChild(grid);
        container.innerHTML = "";
        container.appendChild(wrapper);
  }
  
  // Check URL on load and after SPA navigation
  function checkAndRender() {
    const p = window.location.pathname.replace(/\\/+$/, "");
    if (p !== "/category" && p !== "/category/") return;
    
    // Pre-fetch data immediately so it's ready when container appears
    const dataPromise = fetch("/api/categories.json").then(r => r.json());
    
    // Use MutationObserver for instant detection of the container
    let done = false;
    function tryRender() {
      if (done) return;
      const container = document.querySelector("#App-Container .relative.z-10");
      if (container) {
        done = true;
        dataPromise.then(data => renderCatsWithData(container, data));
        return true;
      }
      return false;
    }
    
    // Try immediately
    if (tryRender()) return;
    
    // Watch for DOM changes
    const observer = new MutationObserver(() => { tryRender(); observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Fallback: rAF loop for 2s, then give up
    let frames = 0;
    function rafLoop() {
      if (done || frames++ > 120) { observer.disconnect(); return; }
      if (!tryRender()) requestAnimationFrame(rafLoop);
    }
    requestAnimationFrame(rafLoop);
  }
  
  // Run immediately
  checkAndRender();
}
`;

// Insert before the app mount (comma-separated minified code)
const patched = original.replace(
  'oi.mount("#app"),console.log',
  'oi.mount("#app"),console.log' + injection
);

fs.writeFileSync(mainPath, patched, 'utf8');
console.log('Patched: categories page (SPA-route-independent)');
