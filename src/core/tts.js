// ================= TTS (українська мова диктора/радіо) =================
/** Озвучити рядки українським голосом. Мовчить при MUTED або без укр. голосу. */
export function speakLines(lines){ if(window.MUTED) return true;
  if(!('speechSynthesis' in window)) return false;
  const vs=speechSynthesis.getVoices(); const uk=vs.find(v=>/^uk/i.test(v.lang));
  if(!uk) return false;
  speechSynthesis.cancel();
  lines.forEach(tx=>{ const u=new SpeechSynthesisUtterance(tx); u.voice=uk; u.lang=uk.lang; u.rate=1.0; speechSynthesis.speak(u); });
  return true;
}
