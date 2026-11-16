'use strict';

/* GitHub Releases 的 Atom feed 解析（CommonJS，供 server.js 与自检共用）。
 * Atom 没有 REST API 的 60 次/小时未认证配额，因此版本列表走它最稳。
 * 资产名由发布脚本固定，故下载直链可按 tag 推导。
 */
const REPO = 'wzdfk/kafka-desk';
const RELEASES_BASE = `https://github.com/${REPO}/releases`;
const ATOM_URL = `${RELEASES_BASE}.atom`;

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(html) {
  // 先解码再剥标签：Atom 的 content 是转义过的 HTML（&lt;p&gt;...）
  return decodeXml(String(html || ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(source, re) {
  const m = re.exec(source);
  return m ? m[1] : '';
}

/* 优先从 alternate 链接取 tag，其次从 id 取；再退回 title。 */
function extractTag(entry, link, id, title) {
  const fromLink = /\/releases\/tag\/([^/"\s]+)\s*$/.exec(link || '');
  if (fromLink) return decodeXml(fromLink[1]);
  const fromId = /\/releases\/(?:tag\/)?([^/"<\s]+)\s*$/.exec(id || '');
  if (fromId) return decodeXml(fromId[1]);
  const t = decodeXml(title || '').trim();
  return /^v?\d+\.\d+\.\d+$/.test(t) ? t : '';
}

function parseReleasesAtom(xml) {
  const entries = [...String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const out = [];
  for (const entry of entries) {
    const link = firstMatch(entry, /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)
      || firstMatch(entry, /<link[^>]*href="([^"]+)"/);
    const id = firstMatch(entry, /<id>([^<]+)<\/id>/);
    const title = firstMatch(entry, /<title[^>]*>([^<]*)<\/title>/);
    const updated = firstMatch(entry, /<updated>([^<]+)<\/updated>/);
    const tag = extractTag(entry, link, id, title);
    if (!tag) continue;
    const version = tag.replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const notes = stripTags(firstMatch(entry, /<content[^>]*>([\s\S]*?)<\/content>/)).slice(0, 500);
    const downloadBase = `${RELEASES_BASE}/download/${tag}/KafkaDesk-${version}-portable.exe`;
    out.push({
      tag_name: tag,
      published_at: updated,
      html_url: `${RELEASES_BASE}/tag/${tag}`,
      body: notes,
      draft: false,
      prerelease: false,
      assets: [
        { name: `KafkaDesk-${version}-portable.exe`, browser_download_url: downloadBase, size: 0 },
        { name: `KafkaDesk-${version}-portable.exe.sha256`, browser_download_url: `${downloadBase}.sha256`, size: 0 },
      ],
    });
  }
  return out;
}

module.exports = { REPO, ATOM_URL, RELEASES_BASE, parseReleasesAtom, stripTags };
