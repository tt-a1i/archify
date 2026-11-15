import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripPublishedArtifactMetadata } from '../scripts/publish-seo.mjs';
import { parse } from 'parse5';
import { parseSitemap } from '../scripts/indexnow.mjs';

const cloudflare = process.env.ARCHIFY_SITE_TARGET === 'cloudflare';
const output = new URL(cloudflare ? '../dist-cloudflare/' : '../dist/', import.meta.url);
const nodes = node => [node, ...(node.childNodes || []).flatMap(nodes)];
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

test('agent guide is readable without JavaScript, honest about examples, and linked from the homepage and both entry points', () => {
  for (const lang of ['en', 'zh']) {
    const prefix = lang === 'zh' ? 'zh/' : '';
    const all = nodes(parse(fs.readFileSync(new URL(`${prefix}agent-diagrams.html`, output), 'utf8')));
    const documentUrl = new URL(`${prefix}agent-diagrams${cloudflare ? '' : '.html'}`, cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/');
    const baseUri = new URL(attr(all.find(node => node.tagName === 'base'), 'href'), documentUrl);
    const article = all.find(node => node.tagName === 'article');
    assert.ok(article);
    assert.equal(nodes(article).filter(node => node.tagName === 'h1').length, 1);
    const visible = text(article);
    assert.match(visible, lang === 'en' ? /two separate sequence diagrams/i : /分别画两张时序图/);
    assert.match(visible, lang === 'en' ? /not the output of this prompt/ : /不是上述提示词的生成结果/);
    assert.match(text(all.find(node => node.tagName === 'main')), lang === 'en' ? /not recorded agent runs/ : /并非 Agent 实测记录/);
    for (const name of ['Claude Code', 'Codex', 'Cursor', 'OpenCode', 'GitHub Copilot']) assert.ok(visible.includes(name));
    const schema = JSON.parse(text(all.find(node => node.tagName === 'script' && attr(node, 'type') === 'application/ld+json')));
    const structuredArticle = schema['@graph'].find(item => item['@type'] === 'TechArticle');
    assert.equal(structuredArticle.url, `https://archify.si/${prefix}agent-diagrams`);
    assert.equal(structuredArticle.inLanguage, lang === 'zh' ? 'zh-Hans' : 'en');
    const ids = new Set(all.map(node => attr(node, 'id')).filter(Boolean));
    for (const id of ['responsibilities', 'setup', 'description-workflow', 'mermaid-input', 'cache-scenarios', 'repository-evidence', 'review-and-share', 'questions']) assert.ok(ids.has(id), `${lang}: stable cross-language section ${id}`);
    const toc = all.find(node => attr(node, 'class') === 'article-toc');
    for (const link of nodes(toc).filter(node => node.tagName === 'a')) {
      const destination = new URL(attr(link, 'href'), baseUri);
      assert.equal(destination.origin + destination.pathname, documentUrl.origin + documentUrl.pathname, 'TOC fragments resolve on this page, not the root base');
      const id = decodeURIComponent(destination.hash.slice(1));
      const anchors = nodes(article).filter(node => attr(node, 'id') === id);
      assert.equal(anchors.length, 1, `unique article anchor: ${id}`);
      const anchor = anchors[0];
      // Markdown wraps a standalone inline span in a paragraph.
      const boundary = anchor.parentNode.tagName === 'p' ? anchor.parentNode : anchor;
      const siblings = boundary.parentNode.childNodes;
      const nextElement = siblings.slice(siblings.indexOf(boundary) + 1).find(node => node.tagName);
      assert.equal(nextElement?.tagName, 'h2', `${id}: anchor immediately precedes its section heading`);
      assert.equal(text(nextElement), text(link), `${id}: TOC label must identify the section it reaches, including after reordering`);
    }
    assert.doesNotMatch(visible, /editorial draft|publication checks|workspace\/shared|factcheck\.md/i);
    const homeFile = lang === 'zh' ? 'zh.html' : 'index.html';
    const homeNodes = nodes(parse(fs.readFileSync(new URL(homeFile, output), 'utf8')));
    const discovery = homeNodes.find(node => attr(node, 'class') === 'guide-discovery');
    assert.ok(discovery, `${lang}: homepage discovery is present without JavaScript`);
    const homeLink = nodes(discovery).find(node => node.tagName === 'a');
    assert.equal(text(homeLink), lang === 'en' ? 'Learn to create and check diagrams with your agent →' : '学习用 Agent 画图并检查结果 →');
    const homeUrl = new URL(homeFile, documentUrl.origin + (cloudflare ? '/' : '/archify/'));
    const homeBase = new URL(attr(homeNodes.find(node => node.tagName === 'base'), 'href'), homeUrl);
    assert.equal(new URL(attr(homeLink, 'href'), homeBase).href, documentUrl.href);
    for (const entry of ['start', 'guide']) {
      const entryNodes = nodes(parse(fs.readFileSync(new URL(`${prefix}${entry}.html`, output), 'utf8')));
      const guideLink = entryNodes.find(node => node.tagName === 'a' && attr(node, 'href') === `${prefix}agent-diagrams${cloudflare ? '' : '.html'}`);
      assert.ok(guideLink, `${prefix}${entry}: contextual discovery`);
      assert.equal(attr(guideLink.parentNode, 'aria-label'), lang === 'zh' ? 'Agent 画图指南' : 'Agent diagramming guide');
    }
  }
});

test('both agent guide routes are included in the actual sitemap and allowed IndexNow inventory', () => {
  const urls = parseSitemap(fs.readFileSync(new URL('sitemap.xml', output), 'utf8'));
  for (const url of ['https://archify.si/agent-diagrams', 'https://archify.si/zh/agent-diagrams']) assert.ok(urls.includes(url));
});

test('README entry points link directly to the matching language guide', () => {
  for (const name of ['README.md', 'README_EN.md', 'README_ZH.md']) {
    const source = fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
    const link = name === 'README_ZH.md'
      ? '[用 Agent 画图并检查结果](https://archify.si/zh/agent-diagrams)'
      : '[Create and check diagrams with your agent](https://archify.si/agent-diagrams)';
    assert.ok(source.includes(link), `${name}: descriptive guide discovery`);
    assert.ok(source.indexOf(link) < source.indexOf('<a id="sponsors">'), `${name}: link stays with quick start`);
  }
  assert.equal(fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), fs.readFileSync(new URL('../../README_EN.md', import.meta.url), 'utf8'));
});


test('description workflow exposes pinned evidence, honest limits and localized setup without changing the artifact', () => {
  const origin = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
  for (const lang of ['en', 'zh']) {
    const prefix = lang === 'zh' ? 'zh/' : '';
    const all = nodes(parse(fs.readFileSync(new URL(`${prefix}agent-diagrams.html`, output), 'utf8')));
    const base = new URL(attr(all.find(node => node.tagName === 'base'), 'href'), origin + `${prefix}agent-diagrams.html`);
    const article = all.find(node => node.tagName === 'article');
    const start = nodes(article).find(node => attr(node, 'id') === 'description-workflow').parentNode;
    const siblings = start.parentNode.childNodes;
    const rest = siblings.slice(siblings.indexOf(start) + 1);
    const end = rest.findIndex(node => nodes(node).some(child => attr(child, 'id') === 'mermaid-input'));
    const section = rest.slice(0, end).flatMap(nodes);
    const visible = rest.slice(0, end).map(text).join('');
    assert.match(visible, /1 \+ 4 \+ 3 \+ 2/);
    assert.match(visible, lang === 'en' ? /not additional leave deductions/ : /不是再次扣减休假额度/);
    assert.match(visible, lang === 'en' ? /not a fresh agent execution record/ : /不是一次新的 Agent 执行记录/);
    assert.match(visible, lang === 'en' ? /not real calendar or company leave-policy advice/ : /不是实际日历或公司休假政策建议/);
    assert.match(visible, lang === 'en' ? /not a real-world guarantee/ : /不是现实保证/);
    const links = section.filter(node => node.tagName === 'a').map(node => new URL(attr(node, 'href'), base));
    assert.ok(links.some(url => url.href === origin + 'cases/life/leave-plan.workflow.html'));
    assert.ok(links.some(url => url.href === 'https://github.com/tt-a1i/archify/blob/68031cf978e0b906aa56c684a394049a3ea9d583/docs/cases/life/leave-plan.workflow.json'));
    const quickstart = links.find(url => url.searchParams.get('type') === 'workflow');
    assert.equal(quickstart.href, origin + `${prefix}start${cloudflare ? '' : '.html'}?type=workflow&input=description`);
  }
  for (const extension of ['json', 'html']) {
    const file = `cases/life/leave-plan.workflow.${extension}`;
    const published = fs.readFileSync(new URL(file, output));
    const original = extension === 'html' ? Buffer.from(stripPublishedArtifactMetadata(published.toString('utf8'))) : published;
    assert.deepEqual(original, fs.readFileSync(new URL(`../../docs/${file}`, import.meta.url)), 'existing artifact bytes remain unchanged outside the publication metadata block');
  }
});

test('Mermaid guidance preserves the literal example, explains semantic reauthoring and is linked from localized Start pages', () => {
  const origin = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
  for (const lang of ['en', 'zh']) {
    const prefix = lang === 'zh' ? 'zh/' : '';
    const all = nodes(parse(fs.readFileSync(new URL(`${prefix}agent-diagrams.html`, output), 'utf8')));
    const base = new URL(attr(all.find(node => node.tagName === 'base'), 'href'), origin + `${prefix}agent-diagrams.html`);
    const article = all.find(node => node.tagName === 'article');
    const start = nodes(article).find(node => attr(node, 'id') === 'mermaid-input').parentNode;
    const siblings = start.parentNode.childNodes;
    const rest = siblings.slice(siblings.indexOf(start) + 1);
    const end = rest.findIndex(node => nodes(node).some(child => attr(child, 'id') === 'cache-scenarios'));
    assert.ok(end > 0, 'the Mermaid section is bounded before the next topic');
    const section = rest.slice(0, end).flatMap(nodes);
    const visible = rest.slice(0, end).map(text).join('');
    const source = text(section.find(node => node.tagName === 'pre'));
    assert.match(source, /^flowchart LR\n/);
    assert.deepEqual(Object.fromEntries([...source.matchAll(/([A-Z])\[([^\]]+)\]/g)].map(match => [match[1], match[2]])), {
      A: 'Submit request', B: 'Review request', C: 'Proceed', D: 'Revise request',
    });
    const relationships = [...source.matchAll(/^\s*([A-Z])(?:\[[^\]]+\])?\s*-->(?:\|([^|]+)\|)?\s*([A-Z])/gm)]
      .map(([, from, label = '', to]) => ({ from, to, label }));
    assert.deepEqual(relationships, [
      { from: 'A', to: 'B', label: '' },
      { from: 'B', to: 'C', label: 'Approved' },
      { from: 'B', to: 'D', label: 'Changes needed' },
      { from: 'D', to: 'B', label: '' },
    ]);
    assert.match(visible, lang === 'en' ? /authors fresh Archify JSON/ : /编写新的 Archify JSON/);
    assert.match(visible, lang === 'en' ? /not a Mermaid parser.*lossless round-trip converter/ : /不是 Mermaid 解析器.*不承诺无损往返转换/);
    assert.match(visible, lang === 'en' ? /not a recorded conversion or a checked output/ : /不是一次实测转换，也不是已经校验过的成品/);
    const prompt = text(section.find(node => node.tagName === 'blockquote'));
    for (const label of ['Approved', 'Changes needed', 'Revise request', 'Review request']) assert.ok(prompt.includes(label));
    assert.match(prompt, lang === 'en' ? /explain the limitation before simplifying/ : /先说明限制，再讨论简化方式/);
    assert.equal(section.filter(node => node.tagName === 'li').length, 4, 'the semantic review checklist is readable without JavaScript');
    const links = section.filter(node => node.tagName === 'a').map(node => new URL(attr(node, 'href'), base).href);
    assert.ok(links.includes('https://github.com/tt-a1i/archify/blob/88d1ae4498b6a1df610badf690c5406882622d15/archify/SKILL.md#mermaid-input'));
    assert.ok(links.includes('https://mermaid.ai/open-source/config/usage.html'));
    assert.ok(nodes(article).some(node => node.tagName === 'a' && new URL(attr(node, 'href'), base).hash === '#mermaid-input'), 'the FAQ points to the full explanation');

    const entryNodes = nodes(parse(fs.readFileSync(new URL(`${prefix}start.html`, output), 'utf8')));
    const entryBase = new URL(attr(entryNodes.find(node => node.tagName === 'base'), 'href'), origin + `${prefix}start.html`);
    const help = entryNodes.find(node => (attr(node, 'class') || '').split(/\s+/).includes('mermaid-guide-link'));
    const link = nodes(help).find(node => node.tagName === 'a');
    assert.equal(text(link), lang === 'en' ? 'Already have Mermaid? Learn how to use it as agent input →' : '已有 Mermaid？了解怎样把它交给 Agent →');
    assert.equal(new URL(attr(link, 'href'), entryBase).href, origin + `${prefix}agent-diagrams${cloudflare ? '' : '.html'}#mermaid-input`);
    assert.deepEqual(entryNodes.filter(node => attr(node, 'data-input')).map(node => attr(node, 'data-input')), ['description', 'repository'], 'Mermaid help does not introduce a new input mode');
  }
});


test('setup answers are readable without scripts and distinguish prerequisites from optional source code', () => {
  const origin = cloudflare ? 'https://archify.si/' : 'https://tt-a1i.github.io/archify/';
  for (const lang of ['en', 'zh']) {
    const prefix = lang === 'zh' ? 'zh/' : '';
    const page = nodes(parse(fs.readFileSync(new URL(`${prefix}agent-diagrams.html`, output), 'utf8')));
    const article = page.find(node => node.tagName === 'article');
    const visible = text(article);
    assert.match(visible, lang === 'en' ? /read and write files and execute commands with Node.js/ : /读写文件、通过 Node.js 执行命令/);
    assert.match(visible, lang === 'en' ? /without existing source code/ : /不必已有源码/);
    assert.match(visible, lang === 'en' ? /Claude.ai depends on Node.js access/ : /Claude.ai 取决于沙箱是否能使用 Node.js/);
    assert.match(visible, lang === 'en' ? /prompt-driven fallback/ : /提示词驱动的回退方式/);
    const base = new URL(attr(page.find(node => node.tagName === 'base'), 'href'), origin + `${prefix}agent-diagrams.html`);
    for (const [agent, directory] of [['claude-code', '.claude'], ['codex', '.agents']]) {
      assert.equal(page.filter(node => attr(node, 'id') === `setup-${agent}`).length, 1);
      const command = `npx -y skills add tt-a1i/archify --skill archify --agent ${agent} --global --copy --yes`;
      assert.ok(nodes(article).some(node => node.tagName === 'pre' && text(node).trim() === command), `${agent}: exact existing Start command is visible in SSR`);
      for (const location of [`~/${directory}/skills/`, `${directory}/skills/`]) assert.ok(visible.includes(location));
      const link = nodes(article).find(node => node.tagName === 'a' && attr(node, 'href')?.includes(`agent=${agent}#install`));
      assert.equal(new URL(attr(link, 'href'), base).href, origin + `${prefix}start${cloudflare ? '' : '.html'}?agent=${agent}#install`);
    }
    const start = nodes(parse(fs.readFileSync(new URL(`${prefix}start.html`, output), 'utf8')));
    const lead = start.find(node => attr(node, 'class') === 'lead');
    assert.match(text(lead), /Node.js/);
    assert.doesNotMatch(text(start.find(node => node.tagName === 'main')), /normal agent chat|Start in any chat|No files or repository needed|任意.*对话|不需要文件或代码库/);
    const help = start.find(node => attr(node, 'class') === 'question setup-guide-link');
    const helpLink = nodes(help).find(node => node.tagName === 'a');
    assert.match(text(helpLink), lang === 'en' ? /environment requirements/ : /环境要求/);
    assert.equal(new URL(attr(helpLink, 'href'), base).href, origin + `${prefix}agent-diagrams${cloudflare ? '' : '.html'}#setup`);
  }
});
