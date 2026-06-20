/**
 * Post-build patch: Professional categories page with icons, descriptions, counts.
 * Run after `hexo generate`: node scripts/patch-categories-chunk.js
 *
 * Strategy: Write a separate categories.js to public/static/js/ and
 * add a <script> tag to all HTML files. This avoids modifying the
 * minified main JS bundle (which is fragile and can break the entire app).
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// 1. Write the categories script as a separate file
const CATEGORIES_JS = `
(function(){
  var CAT_META={php:{icon:"🐘",desc:"Laravel、Composer、PHP-FPM、Swoole 生态",color:"#8892BF"},architecture:{icon:"🏗️",desc:"微服务、DDD、CQRS、事件驱动、设计模式",color:"#F59E0B"},database:{icon:"🗄️",desc:"MySQL、PostgreSQL、Redis、MongoDB、索引优化",color:"#10B981"},ai:{icon:"🤖",desc:"LLM、Agent、RAG、Prompt Engineering、MLOps",color:"#8B5CF6"},devops:{icon:"🚀",desc:"Docker、K8s、CI/CD、监控、SRE、基础设施",color:"#EF4444"},frontend:{icon:"🎨",desc:"Vue、React、TypeScript、CSS、构建工具",color:"#06B6D4"},macos:{icon:"🍎",desc:"macOS 开发环境、Homebrew、终端工具链",color:"#A855F7"},engineering:{icon:"⚙️",desc:"工程实践、代码质量、测试、文档、流程",color:"#6366F1"},misc:{icon:"📦",desc:"杂项、工具、效率、杂记",color:"#64748B"},mobile:{icon:"📱",desc:"iOS、Android、React Native、uni-app",color:"#EC4899"},go:{icon:"🐽",desc:"Go 语言、并发、微服务、云原生",color:"#00ADD8"},network:{icon:"🌐",desc:"TCP/IP、HTTP、DNS、负载均衡、安全",color:"#14B8A6"},rust:{icon:"🦀",desc:"Rust 语言、系统编程、WebAssembly",color:"#DEA584"},security:{icon:"🔒",desc:"Web 安全、OWASP、认证授权、加密",color:"#DC2626"},mq:{icon:"📨",desc:"RabbitMQ、Kafka、消息队列、事件驱动",color:"#F97316"},testing:{icon:"🧪",desc:"单元测试、集成测试、E2E、TDD",color:"#22C55E"},elixir:{icon:"💎",desc:"Elixir、Phoenix、函数式编程、OTP",color:"#A855F7"},python:{icon:"🐍",desc:"Python、数据处理、脚本、自动化",color:"#3B82F6"},blog:{icon:"✍️",desc:"博客写作、技术写作、内容创作",color:"#EC4899"}};

  function renderCatsWithData(container, summaryData) {
    if (container.dataset.catsLoaded) return;
    container.dataset.catsLoaded = "1";
    var top = summaryData.filter(function(j){ return !j.slug.includes("/"); }).sort(function(j,v){ return v.count - j.count; });
    if (top.length === 0) return;
    var totalArticles = top.reduce(function(s,c){ return s + c.count; }, 0);

    // Build page structure
    var wrapper = document.createElement("div");
    wrapper.className = "flex flex-col mt-20";
    wrapper.innerHTML = '<div class="post-header"><ul class="breadcrumbs flex flex-row gap-6 text-white z-50 px-4"><li><a href="/" style="color:inherit;text-decoration:none">首页</a></li><li>›</li><li>分类</li></ul><h1 class="post-title text-white uppercase">分类</h1></div><div class="post-html bg-ob-deep-800 px-14 py-16 rounded-2xl shadow-xl block" style="width:100%"></div>';

    var box = wrapper.querySelector(".post-html");

    // Stats header
    var header = document.createElement("div");
    header.style.cssText = "text-align:center;margin-bottom:32px;padding:16px 0;border-bottom:1px solid rgba(255,255,255,0.06)";
    header.innerHTML = '<span style="font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#8b5cf6,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + top.length + '</span><span style="font-size:14px;color:#94a3b8;margin-left:8px">个分类</span><span style="color:#475569;margin:0 12px">·</span><span style="font-size:2.2rem;font-weight:800;background:linear-gradient(135deg,#f59e0b,#ef4444);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + totalArticles + '</span><span style="font-size:14px;color:#94a3b8;margin-left:8px">篇文章</span>';
    box.appendChild(header);

    // Fetch all category details in parallel
    var fetches = top.map(function(cat) {
      return fetch("/api/categories/" + cat.slug + ".json")
        .then(function(r){ return r.json(); })
        .then(function(detail){ return {cat: cat, detail: detail}; });
    });

    Promise.all(fetches).then(function(results) {
      results.forEach(function(item) {
        var cat = item.cat;
        var detail = item.detail;
        var posts = (detail.postlist || []).sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
        var meta = CAT_META[cat.slug] || {icon:"📄",desc:"",color:"#64748b"};

        // Category section
        var section = document.createElement("div");
        section.style.cssText = "margin-bottom:32px";

        // Category header (clickable to toggle)
        var catHead = document.createElement("div");
        catHead.style.cssText = "display:flex;align-items:center;gap:14px;padding:16px 18px;border-radius:14px;background:rgba(15,15,30,0.5);border:1px solid rgba(255,255,255,0.05);cursor:pointer;transition:all 0.25s;user-select:none;position:relative;overflow:hidden";
        catHead.innerHTML = '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,' + meta.color + ',' + meta.color + '55);opacity:0.7"></div><div style="font-size:1.8rem;line-height:1;flex-shrink:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:10px;background:' + meta.color + '15">' + meta.icon + '</div><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:18px;font-weight:700;color:#e2e8f0;text-transform:capitalize">' + cat.name + '</span><span style="font-size:12px;font-weight:700;color:' + meta.color + ';background:' + meta.color + '15;padding:2px 10px;border-radius:20px">' + cat.count + ' 篇</span></div>' + (meta.desc ? '<p style="font-size:12px;color:#94a3b8;margin:4px 0 0;line-height:1.4">' + meta.desc + '</p>' : '') + '</div><svg class="toggle-arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" style="flex-shrink:0;transition:transform 0.3s;transform:rotate(0deg)"><path d="M6 8l4 4 4-4" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        catHead.addEventListener("mouseenter", function() { catHead.style.borderColor = meta.color + "33"; catHead.style.background = "rgba(15,15,30,0.7)"; });
        catHead.addEventListener("mouseleave", function() { catHead.style.borderColor = "rgba(255,255,255,0.05)"; catHead.style.background = "rgba(15,15,30,0.5)"; });

        // Post list (expanded by default)
        var postList = document.createElement("div");
        postList.style.cssText = "margin-top:2px;padding:8px 0 8px 18px;border-left:2px solid " + meta.color + "22;margin-left:22px;overflow:hidden;transition:max-height 0.4s ease";

        posts.forEach(function(post) {
          var date = new Date(post.date);
          var dateStr = date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0") + "-" + String(date.getDate()).padStart(2,"0");
          var row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:baseline;gap:12px;padding:7px 12px;border-radius:8px;transition:background 0.2s";
          row.innerHTML = '<span style="font-size:12px;color:#64748b;flex-shrink:0;font-variant-numeric:tabular-nums">' + dateStr + '</span><a href="/post/' + post.slug + '" style="color:#cbd5e1;text-decoration:none;font-size:14px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color 0.2s" onmouseover="this.style.color=\\'' + meta.color + '\\'" onmouseout="this.style.color=\\'#cbd5e1\\'">' + post.title + '</a>';
          postList.appendChild(row);
        });

        // Toggle collapse
        var expanded = true;
        catHead.addEventListener("click", function() {
          expanded = !expanded;
          var arrow = catHead.querySelector(".toggle-arrow");
          if (expanded) {
            postList.style.maxHeight = postList.scrollHeight + "px";
            arrow.style.transform = "rotate(0deg)";
            postList.style.opacity = "1";
          } else {
            postList.style.maxHeight = "0px";
            arrow.style.transform = "rotate(-90deg)";
            postList.style.opacity = "0";
          }
        });

        section.appendChild(catHead);
        section.appendChild(postList);
        box.appendChild(section);

        // Set initial max-height after rendering
        requestAnimationFrame(function() {
          postList.style.maxHeight = postList.scrollHeight + "px";
        });
      });
    });

    container.innerHTML = "";
    container.appendChild(wrapper);
  }

  function checkAndRender() {
    var p = window.location.pathname.replace(/\\/+$/, "");

    // Redirect old /category → /categories
    if (p === "/category" || p === "/category/") {
      window.location.replace("/categories");
      return;
    }

    if (p !== "/categories" && p !== "/categories/") return;

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

    var observer = new MutationObserver(function() {
      if (tryRender()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    var frames = 0;
    function rafLoop() {
      if (done || frames++ > 300) { observer.disconnect(); return; }
      if (!tryRender()) requestAnimationFrame(rafLoop);
    }
    requestAnimationFrame(rafLoop);

    setTimeout(function() { observer.disconnect(); }, 5000);
  }

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

// 3. Copy 404.html to root for GitHub Pages
const src404 = path.join(PUBLIC_DIR, 'page', '404.html');
const dst404 = path.join(PUBLIC_DIR, '404.html');
if (fs.existsSync(src404) && !fs.existsSync(dst404)) {
  fs.copyFileSync(src404, dst404);
  console.log('Copied: 404.html → public/ root');
} else if (fs.existsSync(dst404)) {
  console.log('Skip 404 copy: already exists at root');
} else {
  console.log('WARNING: /page/404.html not found');
}
