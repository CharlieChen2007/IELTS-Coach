const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict'), {pathToFileURL} = require('url');
const {chromium} = require('playwright-core');
const root = path.resolve(__dirname, '..');
const evidenceRoot = process.env.IELTS_QA_DIR || os.tmpdir();
fs.mkdirSync(evidenceRoot, {recursive: true});
const dir = fs.mkdtempSync(path.join(evidenceRoot, 'writing-final-'));
(async () => {
  const {build} = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const dist = path.join(dir, 'dist');
  await build({root, logLevel: 'error', build: {outDir: dist}});
  const {speakingApi} = await import(pathToFileURL(path.join(root, 'scripts/speaking-api.mjs')));
  const {openLocalBindings} = await import(pathToFileURL(path.join(root, 'modules/speaking/scripts/local-bindings.mjs')));
  const db = openLocalBindings(path.join(dir, 'db'), {campus: true});
  const env = {...db, DEEPSEEK_API_KEY: 'offline-browser-fixture', WRITING_AI_DAILY_LIMIT: '20'};
  const read = name => JSON.parse(fs.readFileSync(path.join(root, 'modules/writing-engine', name), 'utf8'));
  const req1 = read('task1/examples/request.sample.json'), rpt1 = read('task1/examples/report.sample.json');
  const req2 = read('task2/examples/task2/request.sample.json'), rpt2 = read('task2/examples/task2/report.sample.json');
  const originalFetch = globalThis.fetch; let requests = 0;
  function ids(value, from, to) {
    return Array.isArray(value) ? value.map(x => ids(x, from, to)) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ids(v, from, to)]))
      : typeof value === 'string' && value.startsWith(from + ':') ? to + value.slice(from.length) : value;
  }
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).host, 'api.deepseek.com'); requests++;
    const payload = JSON.parse(options.body), content = payload.messages.findLast(m => m.role === 'user').content;
    const data = JSON.parse(Array.isArray(content) ? content.find(x => x.type === 'text').text : content);
    let output;
    if (data.essay) {
      const r = data.sourceAnalysis ? rpt1 : rpt2;
      output = ids(structuredClone(r.feedback), r.submissionId, data.sentences[0].id.split(':')[0]);
      output.sentences = output.sentences.map(({start, end, paragraph, index, text, ...x}) => x);
      if (data.sourceAnalysis) {
        // A valid assessment with one over-budget optional rewrite produces the
        // manual-review card, while preserving grades, original and model text.
        const sentence = output.sentences[0];
        sentence.status = 'improve'; sentence.issueType = 'lexis';
        sentence.reason = '核对引言的图表对象、年份和单位，再保留原句中已经准确的表达；避免为了改写而加入过长的补充说明。';
        sentence.suggestion = data.sentences[0].text + ' ' + 'The same accurately stated information should remain concise and clear. '.repeat(8);
        output.review.decision = 'revise';
        output.review.summary = '文章结构清楚，概述和主要比较到位，语言控制较好。优先检查引言的简洁程度，保留已经准确的图表事实和原始表达。';
        output.review.remainingIssues = [{sentenceId: sentence.id, issueType: 'lexis', action: sentence.reason}];
      }
    } else output = rpt2.source.analysis;
    return Response.json({model: 'deepseek-flash', choices: [{finish_reason: 'stop', message: {content: JSON.stringify(output)}}], usage: {prompt_tokens: 30, completion_tokens: 80}});
  };
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || process.env.USERPROFILE + '/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe', ignoreDefaultArgs: ['--hide-scrollbars']});
  const page = await browser.newPage({viewport: {width: 1440, height: 900}}), origin = 'https://writing-final.test', errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      const headers = new Headers(await req.allHeaders()); headers.set('origin', origin);
      const response = await speakingApi(new Request(u, {method: req.method(), headers, body: req.postDataBuffer() ?? undefined}), env);
      return route.fulfill({status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer())});
    }
    const file = path.join(dist, u.pathname === '/' ? 'index.html' : u.pathname);
    return fs.existsSync(file) ? route.fulfill({path: file}) : route.fulfill({status: 404, body: ''});
  });
  try {
    await page.goto(origin + '/?demo=1#/auth');
    await page.getByPlaceholder('例如：Alex').fill('写作终验');
    await page.getByPlaceholder('you@example.com').fill('writing-final@example.org');
    await page.getByRole('button', {name: '进入学习首页'}).click(); await page.waitForURL(/#\/home/);
    await page.evaluate(() => location.hash = '#/subject/writing');
    await page.locator('iframe.writing-frame.is-ready').waitFor();
    const frame = page.frames().find(f => f.url().includes('/writing/index.html'));
    await frame.getByRole('button', {name: /开始今天的写作/}).click();
    await frame.locator('textarea').first().waitFor();
    await frame.getByRole('button', {name: /更换题目/}).click();
    await frame.locator('.question-bank-dialog').waitFor();
    await page.getByRole('button', {name: '练习概览', exact: true}).click();
    await frame.getByRole('button', {name: /开始今天的写作/}).waitFor();
    await frame.locator('button').filter({hasText: 'Academic Writing Task 1'}).click();
    await frame.getByRole('button', {name: /开始今天的写作/}).click();
    await frame.locator('.task1-workspace textarea').fill(req1.text);
    await frame.getByRole('button', {name: '提交 AI 批改', exact: true}).click();
    await frame.locator('.t1-report .coach-task1-manual').waitFor();
    assert.equal(requests, 1, 'Task 1 produces a complete report on the first evaluation; no format retry');
    assert.equal(await frame.locator('.task1-error').count(), 0);
    assert((await frame.locator('.t1-model-text').innerText()).length > 400);
    const geometry = [];
    for (const width of [320, 390, 1440, 2048]) {
      await page.setViewportSize({width, height: 900});
      await page.waitForTimeout(180);
      const fit = await frame.evaluate(() => {
        const problems = [];
        for (const card of document.querySelectorAll('.t1-report > .t1-review,.t1-report > .t1-model,.t1-report > .t1-practice,.t1-report > .coach-task1-manual')) {
          const rect = card.getBoundingClientRect(), s = getComputedStyle(card);
          if (parseFloat(s.paddingLeft) < 18 || parseFloat(s.paddingRight) < 18) problems.push(card.className + ': missing inset');
          const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode; if (!node.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const r of range.getClientRects()) {
              if (!r.width || !r.height) continue;
              if (r.left < rect.left + parseFloat(s.paddingLeft) - 1 || r.right > rect.right - parseFloat(s.paddingRight) + 1 || r.top < rect.top + parseFloat(s.paddingTop) - 1 || r.bottom > rect.bottom - parseFloat(s.paddingBottom) + 1) problems.push({card:card.className,text:node.textContent.slice(0,35),range:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},box:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom},padding:[s.paddingLeft,s.paddingRight,s.paddingTop,s.paddingBottom]});
            }
          }
        }
        return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, cards: document.querySelectorAll('.t1-report > .t1-review,.t1-report > .t1-model,.t1-report > .t1-practice,.t1-report > .coach-task1-manual').length, problems};
      });
      assert.equal(fit.cards, 4); assert.deepEqual(fit.problems, [], JSON.stringify(fit));
      assert(fit.scrollWidth <= fit.width, JSON.stringify(fit));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      geometry.push({viewport: width, ...fit});
      await frame.locator('.t1-model').scrollIntoViewIfNeeded(); await page.waitForTimeout(700);
      await frame.locator('.t1-model').screenshot({path: path.join(dir, 'task1-model-' + width + '.png')});
    }
    await page.setViewportSize({width: 1440, height: 900});
    await page.getByRole('button', {name: '写作训练', exact: true}).click();
    await page.getByRole('button', {name: '写作精修', exact: true}).click();
    await frame.locator('.task1-workspace textarea').fill(req1.text + ' The description remains accurate.');
    await page.getByRole('button', {name: '批改与复盘', exact: true}).click();
    await page.getByRole('button', {name: '二稿对比', exact: true}).click();
    await frame.locator('.coach-task1-compare').waitFor();
    assert((await frame.locator('.coach-task1-compare').innerText()).includes('The description remains accurate.'));
    await page.getByRole('button', {name: '写作训练', exact: true}).click();
    await page.getByRole('button', {name: '练习概览', exact: true}).click();
    await frame.getByRole('button', {name: /开始今天的写作/}).waitFor();
    await frame.locator('button').filter({hasText: 'Academic Writing Task 2'}).click();
    await page.waitForTimeout(250);
    const selection=await frame.evaluate(() => ({selected:window.coachWritingRuntime.selectTopic('t2-026'),catalog:window.coachWritingCatalog?.task2?.slice(0,2)})); assert(selection.selected,JSON.stringify(selection));
    await frame.locator('.task1-workspace').waitFor({state:'hidden'});
    await frame.locator('.essay-input').fill(req2.text);
    assert.equal(await frame.locator('.essay-input').inputValue(),req2.text);
    await frame.getByRole('button', {name: '提交 AI 批改', exact: true}).click();
    await frame.locator('.report-meta').waitFor();
    assert.equal(requests, 2, 'Task 2 also needs only one evaluation');
    await page.getByRole('button', {name: '批改与复盘', exact: true}).click();
    await page.getByRole('button', {name: '二稿对比', exact: true}).click();
    await frame.locator('.comparison-toolbar').waitFor();
    assert((await frame.locator('.comparison-toolbar').innerText()).includes('尚未创建二稿'));
    await page.getByRole('button', {name: '练习记录', exact: true}).click();
    await frame.waitForFunction(() => window.coachWritingRuntime?.view() === 'history');
    assert((await frame.locator('body').innerText()).includes('Task 2'));
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(dir, 'geometry.json'), JSON.stringify(geometry, null, 2));
    console.log('PASS writing final: Task1/Task2 first submission, real server+SQLite, bank, model answer, manual review, second draft comparison, history, four report cards with text ranges inside padding at 320/390/1440/2048; no paid requests. Evidence ' + dir);
  } catch (error) {
    for (const f of page.frames().slice(1)) fs.writeFileSync(path.join(dir, 'frame-error.txt'), await f.locator('body').innerText());
    await page.screenshot({path: path.join(dir, 'error.png'), fullPage: true});
    console.error('Evidence ' + dir); throw error;
  } finally { await browser.close(); db.close(); globalThis.fetch = originalFetch; }
})().catch(error => {console.error(error); process.exitCode = 1;});
