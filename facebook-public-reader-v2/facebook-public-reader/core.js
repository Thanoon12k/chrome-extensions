(() => {
  const clean = value => (value || '').replace(/[\u200e\u200f\u061c]/g, '').replace(/\s+/g, ' ').trim();
  const publicLabel = value => /^(public|shared with public|shared with: public|عام|العامة|تمت المشاركة مع العامة)$/i.test(clean(value));
  const moreLabel = value => /^(see more|show more|عرض المزيد|مشاهدة المزيد)$/i.test(clean(value));
  const permalink = raw => {
    try {
      const u = new URL(raw, 'https://www.facebook.com');
      if (u.hostname !== 'www.facebook.com') return null;
      const id = u.searchParams.get('story_fbid');
      if (id && u.searchParams.get('id')) return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(id)}&id=${encodeURIComponent(u.searchParams.get('id'))}`;
      if (/\/posts\/[^/]+/.test(u.pathname)) return u.origin + u.pathname.replace(/\/$/, '');
      return null;
    } catch { return null; }
  };
  const cleanText = value => String(value || '').replace(/[\u200e\u200f\u061c]/g, '').replace(/\s+(عرض أقل|See less|Show less)\s*$/i, '').trim();
  const dateISO = value => {
    const s = clean(value).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
    const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
    if (!m || !months.includes(m[2])) return null; // Never guess relative/localized dates.
    const month = months.indexOf(m[2]) + 1, day = Number(m[1]), year = Number(m[3]);
    const d = new Date(Date.UTC(year, month-1, day));
    return d.getUTCMonth() === month-1 && d.getUTCDate() === day ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null;
  };
  const normalize = row => {
    if (!row || typeof row.text !== 'string' || row.audience !== 'public' || !publicLabel(row.audienceEvidence)) return null;
    const url = permalink(row.url);
    if (!url) return null;
    const text = cleanText(row.text);
    if (!text) return null;
    return {...row, url, text, dateISO:dateISO(row.dateLabel),
      hashtags:[...new Set(text.match(/#[\p{L}\p{N}_]+/gu) || [])],
      links:[...new Set(text.match(/https?:\/\/[^\s<>]+/g) || [])]};
  };
  const merge = (old, next) => !old || next.text.length > old.text.length ? next : old;
  const api = {clean, publicLabel, moreLabel, permalink, cleanText, dateISO, normalize, merge};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.PublicReaderCore = api;
})();
