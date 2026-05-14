'use strict';
const { Router } = require('express');
const router = Router();

const FETCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function fetchUrl(url) {
  return fetch(url, {
    headers: {
      'User-Agent': FETCH_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://mp.weixin.qq.com/',
    },
    signal: AbortSignal.timeout(15000),
  }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  });
}

function extractVar(raw, name) {
  // Try var name = 'value' then var name = "value"
  const single = new RegExp(`var\\s+${name}\\s*=\\s*'([^']+)'`);
  const double = new RegExp(`var\\s+${name}\\s*=\\s*"([^"]+)"`);
  const json = new RegExp(`"${name}"\\s*:\\s*"([^"]+)"`);
  let m = raw.match(single) || raw.match(double) || raw.match(json);
  return m ? m[1] : '';
}

function decode(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x27;/g,"'").replace(/&#x2F;/g,'/');
}

function extractContent(html) {
  const r = { title:'', account:'', author:'', publishTime:'', coverUrl:'', body:'' };

  // Title: var msg_title or og:title
  r.title = extractVar(html, 'msg_title');
  if (!r.title) {
    const og = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    if (og) r.title = decode(og[1]);
  }

  // Account
  r.account = extractVar(html, 'nick_name') || extractVar(html, 'nickname');

  // Author
  r.author = extractVar(html, 'msg_link_app_name');

  // Cover
  const c = html.match(/var\s+msg_cdn_url\s*=\s*"([^"]+)"/) || html.match(/"msg_cdn_url"\s*:\s*"([^"]+)"/);
  if (c) r.coverUrl = c[1];

  // Publish time
  const ct = html.match(/var\s+ct\s*=\s*["']?(\d+)["']?/) || html.match(/"ct"\s*:\s*(\d+)/);
  if (ct) {
    const ts = parseInt(ct[1]) * (ct[1].length === 10 ? 1000 : 1);
    if (!isNaN(ts) && ts > 1000000000000) {
      const d = new Date(ts);
      r.publishTime = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
  }

  // Body: find js_content div
  const jsIdx = html.indexOf('id="js_content"');
  if (jsIdx > -1) {
    const gt = html.indexOf('>', jsIdx);
    if (gt > -1) {
      const rest = html.slice(gt + 1);
      // Find the end: look for known markers after the article
      const markers = ['id="js_pcock_', 'id="js_spc_', 'id="js_like"', 'id="js_bing"', 'class="rich_media_area_extra"', 'id="js_read_area"', 'id="js_view_sdk"'];
      let end = rest.length;
      for (const m of markers) {
        const p = rest.indexOf(m);
        if (p > 10 && p < end) end = p;
      }
      let body = rest.slice(0, end);
      body = body.replace(/data-src=/g, 'src=').replace(/data-croporisrc=/g, 'src=');
      r.body = body;
    }
  }

  return r;
}

function htmlToMd(html, title) {
  let md = `# ${title}\n\n`;
  let t = html
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, c) => `${'#'.repeat(parseInt(n))} ${c.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, (m, s) => `![图片](${s})\n\n`)
    .replace(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, h, txt) => { const t = txt.replace(/<[^>]+>/g, '').trim(); return t ? `[${t}](${h})` : txt; })
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (m, t1, c) => `**${c.replace(/<[^>]+>/g, '')}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, (m, t1, c) => `*${c.replace(/<[^>]+>/g, '')}*`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, c) => `> ${c.replace(/<[^>]+>/g, '').replace(/\n/g, '\n> ')}\n\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (m, c) => `\`\`\`\n${c.replace(/<[^>]+>/g, '')}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, c) => `\`${c.replace(/<[^>]+>/g, '')}\``)
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (m, c) => `${c.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m, c) => `- ${c.replace(/<[^>]+>/g, '')}\n`)
    .replace(/<hr[^>]*>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return md + decode(t);
}

// POST /api/article/fetch
router.post('/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '请提供文章链接' });
  if (!url.includes('mp.weixin.qq.com')) return res.json({ success: false, error: '请提供有效的微信公众号文章链接' });

  try {
    const html = await fetchUrl(url);
    if (!html || html.length < 200) return res.json({ success: false, error: '无法获取内容，链接可能已失效' });

    if (html.includes('请在微信客户端打开')) return res.json({ success: false, error: '该文章需在微信中打开。请先在微信中打开文章再复制链接到本工具' });
    if (html.includes('验证码') || html.includes('captcha')) return res.json({ success: false, error: '访问频率过高，请在浏览器中手动验证后稍后再试' });

    const a = extractContent(html);

    if (!a.title && !a.body) {
      return res.json({ success: false, error: '无法解析此文章。可以试试切换到"粘贴 HTML 源码"模式' });
    }

    // Clean body
    let body = (a.body || '').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/data-src=/g,'src=').replace(/data-croporisrc=/g,'src=').replace(/\s(style|class|id)\s*=\s*["'][^"']*["']/gi,'').replace(/\sdata-[\w-]+="[^"]*"/g,'').trim();

    const md = htmlToMd(body, a.title || '无标题');
    const wc = body.replace(/<[^>]+>/g, '').length;

    const cleanHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${a.title}</title><style>body{font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;padding:16px;line-height:1.7;color:#333}img{max-width:100%;height:auto;border-radius:4px}h1{font-size:22px}blockquote{border-left:3px solid #ddd;margin:12px 0;padding:8px 16px;color:#666;background:#f9f9f9}pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto}code{background:#f0f0f0;padding:2px 6px;border-radius:3px}</style></head><body><h1>${a.title}</h1><p style="color:#999;font-size:13px">${a.account||''}${a.publishTime?' · '+a.publishTime:''}</p>${body||'<p>（无正文）</p>'}</body></html>`;

    res.json({ success: true, data: { title: a.title||'', account: a.account||'', author: a.author||'', publishTime: a.publishTime||'', coverUrl: a.coverUrl||'', content: body, markdown: md, html: cleanHtml, wordCount: wc } });
  } catch (e) {
    res.json({ success: false, error: e.message.includes('超时') ? '连接超时，请检查网络后重试' : '获取失败: ' + e.message });
  }
});

// Debug
router.get('/debug', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ error: 'need ?url=' });
  try {
    const html = await fetchUrl(url);
    const hasTitle = html.includes('msg_title');
    const hasContent = html.includes('js_content');
    const hasRich = html.includes('rich_media_content');
    const titleMatch = html.match(/var\s+msg_title\s*=\s*'([^']+)'/);
    res.json({ length: html.length, hasTitle, hasContent, hasRich, titleSnippet: titleMatch ? titleMatch[1] : 'not found' });
  } catch (e) { res.json({ error: e.message }); }
});

module.exports = router;
