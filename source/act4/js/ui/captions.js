// The lower-third caption: one plain sentence at a time, crossfaded, with the chapter it belongs to.
export function createCaptions(el) {
  el.innerHTML = '<div class="ch"><i></i><span></span></div><p class="out"></p>';
  const num = el.querySelector('.ch i'), ch = el.querySelector('.ch span'), p = el.querySelector('p');
  let cur = null, chKey = '', timer = 0;
  function set(chapterIndex, chapterTitle, text) {
    const k = `${chapterIndex}|${chapterTitle}`;
    if (k !== chKey) { chKey = k; num.textContent = chapterIndex != null ? String(chapterIndex + 1).padStart(2, '0') : ''; ch.textContent = chapterTitle || ''; }
    if (text === cur) return; cur = text;
    p.classList.add('out'); clearTimeout(timer);
    timer = setTimeout(() => { p.textContent = text || ''; if (text) p.classList.remove('out'); }, 260);
  }
  return { set, get text() { return cur; } };
}
