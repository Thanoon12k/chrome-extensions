(() => {
  if (document.getElementById('public-post-reader-panel')) return;
  const C = globalThis.PublicReaderCore;
  const host = document.createElement('div');
  host.id = 'public-post-reader-panel';
  host.style.cssText = 'position:fixed;right:16px;top:90px;z-index:2147483647';
  const ui = host.attachShadow({mode:'closed'});
  ui.innerHTML = `<style>
  :host{all:initial}section{width:310px;padding:18px;background:#fff;color:#19212c;border:2px solid #2167dc;border-radius:14px;box-shadow:0 6px 32px #0004;font:14px/1.5 Arial;direction:rtl}
  h2{font-size:19px;margin:0 0 8px}button,input{font:inherit}button{padding:7px 11px;margin:4px;border:0;border-radius:7px;background:#2167dc;color:white;cursor:pointer}button:disabled{opacity:.4;cursor:default}input{width:65px}p{margin:8px 0}.small{font-size:12px;color:#546174}#status{white-space:pre-wrap}details{max-height:200px;overflow:auto}pre{white-space:pre-wrap;font:12px Arial}</style>
  <section><h2>قارئ المنشورات العامة</h2><p class="small">يجمع النص فقط عند وجود علامة خصوصية عامة صريحة في رأس المنشور. لا يقرأ الرسائل أو التعليقات.</p>
  <label>حد المنشورات <input id="limit" type="number" min="1" max="2000" value="100"></label>
  <p><button id="start">بدء / متابعة</button><button id="stop" disabled>إيقاف</button><button id="close">إغلاق</button></p>
  <p id="status">افتح تبويب منشورات الصفحة ثم ابدأ.</p>
  <p><input id="query" style="width:95%" placeholder="بحث في النص أو الهاشتاغ"></p>
  <label>الترتيب <select id="sort"><option value="capture">حسب الجمع</option><option value="newest">الأحدث أولاً</option><option value="oldest">الأقدم أولاً</option></select></label>
  <p><button id="import">استيراد JSON سابق</button><input id="file" type="file" accept=".json" hidden></p>
  <button id="txt">تنزيل TXT</button><button id="json">تنزيل JSON</button>
  <p id="saved" class="small">تحميل النتائج المحفوظة…</p>
  <details><summary>معاينة النصوص</summary><pre id="preview"></pre></details>
  <p class="small">حفظ تلقائي محلي لكل صفحة. التصدير يتبع البحث والترتيب. شغّل جلسة واحدة للصفحة. المنشورات غير المؤكدة تُتجاهل؛ لا ضمان لاكتمال الأرشيف.</p></section>`;
  document.documentElement.append(host);
  const $ = id => ui.getElementById(id);
  const records = new Map();
  const pageURL = location.href;
  const sourceKey = raw => {const u=new URL(raw); return u.origin + u.pathname.replace(/\/$/,'') + (u.searchParams.get('id') ? '?id='+u.searchParams.get('id') : '');};
  const storageKey = 'publicReader2:' + sourceKey(pageURL);
  let running = false, busy = false, reason = '', rounds = 0;
  let initialized = false, saveQueue = Promise.resolve();
  let diagnostics = {};
  const reject = name => {diagnostics[name]=(diagnostics[name] || 0)+1; return null;};
  function filtered() {
    const q=C.clean($('query').value).toLowerCase();
    const rows=[...records.values()].filter(r=>r.text.toLowerCase().includes(q));
    if ($('sort').value !== 'capture') rows.sort((a,b)=> {
      if (!a.dateISO) return b.dateISO ? 1 : 0;
      if (!b.dateISO) return -1;
      return a.dateISO.localeCompare(b.dateISO) * ($('sort').value==='newest' ? -1 : 1);
    });
    return rows;
  }
  function persist() {
    const payload = {source:pageURL, posts:[...records.values()], savedAt:new Date().toISOString()};
    saveQueue = saveQueue.then(async()=> {
      try {await chrome.storage.local.set({[storageKey]:payload}); $('saved').textContent=`حُفظ محلياً: ${payload.posts.length} منشور`;} 
      catch(e) {$('saved').textContent='فشل الحفظ المحلي؛ نزّل النتائج الآن. '+e.message;}
    });
    return saveQueue;
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => Boolean(el?.getClientRects().length);
  const owns = (article, el) => el.closest('[role="article"]') === article;
  function inspect(article) {
    if (!visible(article)) return null;
    const message = [...article.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')].find(el => owns(article, el) && visible(el));
    if (!message) return reject('نص غير معروف'); // Unknown layout: never fall back to entire article/comments.
    const before = el => Boolean(el.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING) && !el.contains(message);
    const labels = [...article.querySelectorAll('[aria-label], [title]')].filter(el => owns(article, el) && visible(el) && before(el) && !message.contains(el));
    const evidence = labels.map(el => el.getAttribute('aria-label') || el.getAttribute('title')).find(C.publicLabel);
    if (!evidence) return reject('خصوصية غير مؤكدة');
    const links = [...article.querySelectorAll('a[href]')].filter(el => owns(article, el) && before(el) && visible(el));
    const link = links.find(el => C.permalink(el.href));
    if (!link) return reject('رابط غير معروف'); // Requires a top-level post link, not a shared link in the text.
    return {message, url:C.permalink(link.href), audienceEvidence:evidence, dateLabel:C.clean(link.getAttribute('aria-label') || link.innerText)};
  }
  function update() {
    $('status').textContent = `${running ? 'يجمع الآن' : 'متوقف'} — ${records.size} منشور عام\n${reason}\nجولات الفحص: ${rounds}`;
    const rows=filtered();
    $('status').textContent += `\nالمطابق للبحث: ${rows.length}\nآخر جولة (فحوص، لا منشورات فريدة): ${Object.entries(diagnostics).map(([k,v])=>k+': '+v).join('، ')}`;
    $('preview').textContent = rows.slice(0,10).map(r => `${r.dateLabel || ''}\n${r.text}`).join('\n\n────────\n\n');
    $('start').disabled = busy || !initialized; $('stop').disabled = !running;
    $('import').disabled=busy || !initialized;
  }
  function moreButtons(message) {
    return [...message.querySelectorAll('[role="button"],button')].filter(el => visible(el) && C.moreLabel(el.innerText || el.getAttribute('aria-label')));
  }
  async function scan(limit) {
    diagnostics = {};
    let changed = false;
    for (const article of document.querySelectorAll('[role="article"]')) {
      if (!running || location.href !== pageURL) break;
      let post = inspect(article);
      if (!post || (records.size >= limit && !records.has(post.url))) continue;
      for (let attempt = 0; attempt < 3 && running; attempt++) {
        const button = moreButtons(post.message)[0];
        if (!button) break;
        const previous=post.message.innerText, expectedURL=post.url;
        button.click();
        for (let wait=0; wait<8 && running; wait++) {
          await sleep(500);
          const current=inspect(article);
          if (!current || current.url!==expectedURL) break;
          if (current.message.innerText!==previous && !moreButtons(current.message).length) break;
        }
        post = inspect(article);
        if (post?.url!==expectedURL) post=null;
        if (!post) break;
      }
      if (!post || !running) continue;
      const text = C.cleanText(post.message.innerText);
      if (!text) continue;
      const row = C.normalize({url:post.url, text, audience:'public', audienceEvidence:post.audienceEvidence,
        dateLabel:post.dateLabel, expansionStatus:moreButtons(post.message).length ? 'possibly_truncated' : 'no_expand_button_remaining',
        sourcePage:pageURL, capturedAt:new Date().toISOString()});
      if (!row) continue;
      const old=records.get(row.url), best=C.merge(old,row);
      if (best !== old) changed = true;
      records.set(row.url, best);
    }
    return changed;
  }
  $('start').onclick = async () => {
    if (busy || !initialized) return;
    const route = new URL(location.href);
    if (route.pathname === '/' || /^\/(groups|messages|watch|reel|reels|marketplace)(\/|$)/.test(route.pathname)) {
      reason = 'افتح صفحة محددة وتبويب المنشورات، وليس الرئيسية أو مجموعة أو الرسائل.'; update(); return;
    }
    if (location.href !== pageURL) {reason='تغيرت الصفحة. أغلق اللوحة وافتح الإضافة مجدداً.'; update(); return;}
    running = busy = true; rounds=0; reason = ''; update();
    const limit = Math.max(1, Math.min(2000, Number($('limit').value) || 100));
    let quiet = 0;
    try {
      while (running && records.size < limit && rounds < 1000) {
        if (location.href !== pageURL) {reason='تغير عنوان الصفحة؛ توقف الجمع.'; break;}
        if (document.querySelector('input[type="password"], iframe[src*="captcha"]')) {reason='تسجيل دخول أو تحقق مطلوب؛ توقف الجمع.'; break;}
        if (document.hidden) {reason='التبويب غير نشط؛ فعّله للمتابعة.'; update(); await sleep(1000); continue;}
        const changed = await scan(limit); rounds++;
        if (changed) await persist();
        quiet = changed ? 0 : quiet + 1;
        reason = quiet ? `لا نتائج جديدة في ${quiet} جولة. غير المؤكد يُتجاهل.` : '';
        update();
        if (!running) break;
        if (quiet >= 15) {reason='لا منشورات عامة مؤكدة جديدة. قد يكون المحتوى انتهى أو تغيّر تصميم Facebook؛ هذا ليس إثباتاً لاكتمال الأرشيف.'; break;}
        window.scrollBy({top:Math.round(innerHeight * .7), behavior:'instant'});
        await sleep(Math.min(6000, 2000 + quiet * 350));
      }
      if (records.size >= limit) reason='تم بلوغ الحد المحدد.';
      if (rounds >= 1000) reason='تم بلوغ حد جولات الأمان. نزّل النتائج.';
    } catch (e) {reason='خطأ: ' + e.message;}
    finally {running = busy = false; await persist(); update();}
  };
  $('stop').onclick = () => {running=false; reason='تم طلب الإيقاف.'; update();};
  $('close').onclick = () => {
    if (busy) {running=false; reason='انتظر اكتمال الإيقاف والحفظ ثم أغلق.'; update(); return;}
    host.remove();
  };
  function download(format) {
    if (!records.size) {reason='لا توجد نتائج للتنزيل بعد.'; update(); return;}
    const data = filtered();
    if (!data.length) {reason='لا نتائج مطابقة للبحث.'; update(); return;}
    const content = format === 'json' ? JSON.stringify({schemaVersion:2,source:pageURL,exportedAt:new Date().toISOString(),completeArchive:false,filter:$('query').value,sort:$('sort').value,totalCollected:records.size,posts:data},null,2)
      : '\uFEFF' + data.map((r,i) => `${i+1}. ${r.url}\nAudience evidence: ${r.audienceEvidence}\nDate label: ${r.dateLabel}\nExpansion: ${r.expansionStatus}\n\n${r.text}`).join('\n\n========================================\n\n');
    const url = URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'}));
    const a = document.createElement('a'); a.href=url; a.download=`facebook-public-posts-${Date.now()}.${format}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url),30000);
  }
  $('txt').onclick=()=>download('txt'); $('json').onclick=()=>download('json');
  $('query').oninput=update; $('sort').onchange=update;
  $('import').onclick=()=>$('file').click();
  $('file').onchange=async()=> {
    if (busy || !initialized) return;
    const file=$('file').files[0]; if (!file) return;
    busy=true; update();
    try {
      if (file.size>8*1024*1024) throw new Error('الملف أكبر من 8MB.');
      const data=JSON.parse(await file.text());
      if (sourceKey(data.source)!==sourceKey(pageURL)) throw new Error('الملف يخص صفحة مختلفة.');
      if (!Array.isArray(data.posts)) throw new Error('تنسيق غير صالح.');
      let accepted=0;
      for (const item of data.posts) {
        const row=C.normalize(item); if (!row) continue;
        records.set(row.url,C.merge(records.get(row.url),{...row,importedAt:new Date().toISOString()})); accepted++;
      }
      await persist(); reason=`تم قبول ${accepted} سجل من الملف، ودمج الروابط المكررة. علامات الخصوصية المستوردة لم تُفحص مجدداً على الموقع.`;
    } catch(e) {reason='تعذر الاستيراد: '+e.message;}
    busy=false; $('file').value=''; update();
  };
  update();
  chrome.storage.local.get(storageKey).then(data=> {
    for (const item of data[storageKey]?.posts || []) {const row=C.normalize(item); if(row) records.set(row.url,C.merge(records.get(row.url),row));}
    $('saved').textContent=`استُعيد ${records.size} منشور محفوظ. لا يبدأ الجمع إلا عند الضغط على بدء.`;
  }).catch(e=> {$('saved').textContent='تعذرت الاستعادة: '+e.message;}).finally(()=> {initialized=true; update();});
})();
