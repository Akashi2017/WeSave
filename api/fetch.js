// Vercel Serverless Function - 公众号文章下载 API
// 部署到 Vercel 时，此文件处理 /api/fetch 路径

module.exports = async function handler(req, res) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: '仅支持 POST 请求' });
  }

  const { url } = req.body || {};
  if (!url || !url.includes('mp.weixin.qq.com')) {
    return res.status(400).json({ success: false, error: '请提供有效的公众号文章链接' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://mp.weixin.qq.com/',
      },
    });

    const html = await response.text();

    if (html.includes('请在微信客户端打开')) {
      return res.json({ success: false, error: '该文章需在微信中打开' });
    }

    const article = extractContent(html);
    if (!article.title && !article.body) {
      return res.json({ success: false, error: '无法解析文章内容，请确认链接是否正确' });
    }

    const md = htmlToMd(article.body, article.title);
    const cleanHtml = renderHtml(article.title, article.account, article.publishTime, article.body);
    const wc = article.body.replace(/<[^>]+>/g, '').length;

    return res.json({
      success: true,
      data: {
        title: article.title || '',
        account: article.account || '',
        author: article.author || '',
        publishTime: article.publishTime || '',
        content: article.body || '',
        markdown: md,
        html: cleanHtml,
        wordCount: wc,
      }
    });
  } catch (e) {
    return res.json({ success: false, error: '获取失败: ' + e.message });
  }
}

function extractContent(html) {
  const r = { title: '', account: '', publishTime: '', body: '' };
  const m1 = html.match(/var\s+msg_title\s*=\s*['"]([^'"]+)['"]/);
  if (m1) r.title = m1[1];
  if (!r.title) { const o = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i); if (o) r.title = o[1]; }
  const m2 = html.match(/var\s+(nick_name|nickname)\s*=\s*['"]([^'"]+)['"]/);
  if (m2) r.account = m2[2];
  const ct = html.match(/var\s+ct\s*=\s*["']?(\d+)["']?/);
  if (ct) { const ts = parseInt(ct[1]) * 1000; if (!isNaN(ts) && ts > 0) { const d = new Date(ts); r.publishTime = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } }
  const idx = html.indexOf('id="js_content"');
  if (idx > -1) {
    const gt = html.indexOf('>', idx);
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
    .replace(/<[^>]+>/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
  return md + t;
}

function renderHtml(title, account, time, body) {
  const safe = (s) => (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe(title)}</title><style>body{font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:16px;line-height:1.7;color:#333}img{max-width:100%;height:auto;border-radius:4px}h1{font-size:22px}</style></head><body><h1>${safe(title)}</h1><p style="color:#999;font-size:13px">${safe(account||'')}${time?' · '+time:''}</p>${body||'<p>（无正文）</p>'}</body></html>`;
}
