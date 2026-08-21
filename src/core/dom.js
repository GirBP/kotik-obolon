// ================= DOM-ХЕЛПЕРИ =================

/** HTML-екранування (для будь-якого тексту з мережі/інших гравців перед вставкою в DOM). */
export function esc(s) {
  return String(s).replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// банер-тост: показуємо повідомлення на ~3.4с. Таймер приватний до модуля.
let bannerT;
/** Показати короткий банер-повідомлення гравцю. */
export function toast(msg) {
  const b = document.getElementById('bannerMsg');
  b.textContent = msg;
  b.classList.add('show');
  clearTimeout(bannerT);
  bannerT = setTimeout(() => b.classList.remove('show'), 3400);
}
