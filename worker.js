// Cloudflare Worker - 公众号文章下载工具
// 部署: 复制此文件到 https://workers.cloudflare.com 新建 Worker 即可

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 静态 HTML 页面
    if (path === '/' || path === '/article-tool') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    // 健康检查
    if (path === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    // 文章抓取 API
    if (path === '/api/article/fetch' && request.method === 'POST') {
      try {
        const { url: articleUrl } = await request.json();
        if (!articleUrl || !articleUrl.includes('mp.weixin.qq.com')) {
          return Response.json({ success: false, error: '请提供有效的公众号文章链接' });
        }

        const html = await fetch(articleUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': 'https://mp.weixin.qq.com/',
          }
        }).then(r => r.text());

        if (html.includes('请在微信客户端打开')) {
          return Response.json({ success: false, error: '该文章需在微信中打开' });
        }

        const article = extractContent(html);
        if (!article.title && !article.body) {
          return Response.json({ success: false, error: '无法解析文章内容' });
        }

        const md = htmlToMd(article.body, article.title);
        const cleanHtml = renderHtml(article.title, article.account, article.publishTime, article.body);
        const wc = article.body.replace(/<[^>]+>/g, '').length;

        return Response.json({
          success: true,
          data: {
            title: article.title || '',
            account: article.account || '',
            author: article.author || '',
            publishTime: article.publishTime || '',
            coverUrl: article.coverUrl || '',
            content: article.body || '',
            markdown: md,
            html: cleanHtml,
            wordCount: wc,
          }
        });
      } catch (e) {
        return Response.json({ success: false, error: '获取失败: ' + e.message });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

function extractContent(html) {
  const r = { title: '', account: '', author: '', publishTime: '', coverUrl: '', body: '' };

  const getVar = (name) => {
    const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`)) || html.match(new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`));
    return m ? m[1] : '';
  };

  r.title = getVar('msg_title');
  if (!r.title) { const o = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i); if (o) r.title = o[1]; }
  r.account = getVar('nick_name') || getVar('nickname');

  const ct = html.match(/var\s+ct\s*=\s*["']?(\d+)["']?/);
  if (ct) { const ts = parseInt(ct[1]) * 1000; if (!isNaN(ts) && ts > 0) { const d = new Date(ts); r.publishTime = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } }

  const jsIdx = html.indexOf('id="js_content"');
  if (jsIdx > -1) {
    const gt = html.indexOf('>', jsIdx);
    if (gt > -1) {
      const rest = html.slice(gt + 1);
      const markers = ['id="js_pcock_', 'id="js_spc_', 'id="js_like"', 'class="rich_media_area_extra"'];
      let end = rest.length;
      for (const m of markers) { const p = rest.indexOf(m); if (p > 10 && p < end) end = p; }
      r.body = rest.slice(0, end).replace(/data-src=/g, 'src=').replace(/data-croporisrc=/g, 'src=');
    }
  }
  return r;
}

function htmlToMd(html, title) {
  let md = `# ${title}\n\n`;
  let t = html.replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, c) => `${'#'.repeat(+n)} ${c.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, (m, s) => `![图片](${s})\n\n`)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (m, t1, c) => `**${c.replace(/<[^>]+>/g, '')}**`)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (m, c) => `${c.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{4,}/g, '\n\n\n').trim();
  return md + t;
}

function renderHtml(title, account, time, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:16px;line-height:1.7;color:#333}img{max-width:100%;height:auto;border-radius:4px}h1{font-size:22px}</style></head><body><h1>${title}</h1><p style="color:#999;font-size:13px">${account||''}${time?' · '+time:''}</p>${body||'<p>（无正文）</p>'}</body></html>`;
}

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>公众号文章下载</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f5;color:#1a1a1a;min-height:100vh}
.header{background:linear-gradient(135deg,#07c160,#06ad56);padding:20px 16px 28px;color:#fff;text-align:center}
.header h1{font-size:20px;font-weight:600;margin-bottom:4px}
.header p{font-size:13px;opacity:.8}
.container{max-width:640px;margin:0 auto;padding:16px}
.card{background:#fff;border-radius:12px;padding:16px;margin-top:-16px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.card .label{font-size:13px;font-weight:500;color:#666;margin-bottom:6px}
.row{display:flex;gap:8px}
.row input{flex:1;padding:10px 14px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;outline:none}
.row input:focus{border-color:#07c160}
.row button{padding:10px 20px;background:#07c160;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;white-space:nowrap}
.row button:disabled{background:#ccc}
.hint{font-size:12px;color:#999;margin-top:8px}
.hint code{background:#f0f0f0;padding:1px 6px;border-radius:3px}
.result{display:none;margin-top:12px}
.result.show{display:block}
.meta{background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 6px rgba(0,0,0,.06)}
.meta h2{font-size:17px;font-weight:600;margin-bottom:8px}
.meta .info{font-size:12px;color:#999}
.actions{display:flex;gap:8px;margin:12px 0;flex-wrap:wrap}
.actions button{flex:1;min-width:100px;padding:12px;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:500}
.btn-md{background:#07c160;color:#fff}
.btn-html{background:#1a73e8;color:#fff}
.btn-copy{background:#f5f5f5;color:#333;border:1.5px solid #e0e0e0}
.preview{background:#fff;border-radius:12px;box-shadow:0 1px 6px rgba(0,0,0,.06)}
.preview-header{padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:500}
.preview-body{padding:16px;max-height:400px;overflow-y:auto;font-size:14px;line-height:1.8}
.preview-body img{max-width:100%;border-radius:6px}
.status{padding:12px 14px;border-radius:8px;margin:12px 0;font-size:13px;display:none}
.status.loading{display:block;background:#e8f5e9;color:#2e7d32}
.status.error{display:block;background:#ffebee;color:#c62828}
.footer{text-align:center;padding:16px;font-size:12px;color:#ccc}
</style>
</head>
<body>
<div class="header">
  <h1>公众号文章下载</h1>
  <p>粘贴链接即可保存为 Markdown / HTML</p>
</div>
<div class="container">
  <div class="card">
    <div class="label">文章链接</div>
    <div class="row">
      <input id="urlInput" placeholder="https://mp.weixin.qq.com/s/...">
      <button id="fetchBtn" onclick="fetchArticle()">解析下载</button>
    </div>
    <div class="hint">微信中打开文章 → 右上角 <code>...</code> → 复制链接 → 粘贴到上方</div>
  </div>

  <div class="status" id="status"></div>
  <div class="result" id="result">
    <div class="meta" id="articleMeta"></div>
    <div class="actions">
      <button class="btn-md" onclick="downloadMD()">下载 Markdown</button>
      <button class="btn-html" onclick="downloadHTML()">下载 HTML</button>
      <button class="btn-copy" onclick="copyText()">复制内容</button>
    </div>
    <div class="preview">
      <div class="preview-header">内容预览</div>
      <div class="preview-body" id="previewBody"></div>
    </div>
  </div>
  <div class="footer">WeSave</div>
</div>

<script>
let cached = null;

async function fetchArticle() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) return;
  const s = document.getElementById('status');
  const btn = document.getElementById('fetchBtn');
  s.className = 'status loading'; s.innerHTML = '正在获取...';
  btn.disabled = true;
  document.getElementById('result').classList.remove('show');

  try {
    const r = await fetch('/api/article/fetch', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) });
    const d = await r.json();
    if (!d.success) { s.className = 'status error'; s.textContent = d.error; btn.disabled = false; return; }
    cached = d.data;
    s.style.display = 'none';
    document.getElementById('articleMeta').innerHTML = '<h2>'+d.data.title+'</h2><div class="info">'+(d.data.account||'')+(d.data.publishTime?' &middot; '+d.data.publishTime:'')+'</div>';
    document.getElementById('previewBody').innerHTML = d.data.content || '(无内容)';
    document.getElementById('result').classList.add('show');
    btn.disabled = false;
  } catch(e) { s.className = 'status error'; s.textContent = '网络错误'; btn.disabled = false; }
}

function downloadMD() { if(cached) downloadFile(cached.markdown, (cached.title||'article')+'.md', 'text/markdown'); }
function downloadHTML() { if(cached) downloadFile(cached.html, (cached.title||'article')+'.html', 'text/html'); }
async function copyText() { if(cached) { await navigator.clipboard.writeText(cached.markdown); alert('已复制'); } }
function downloadFile(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
</script>
</body>
</html>`;
