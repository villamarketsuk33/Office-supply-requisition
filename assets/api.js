/* Public settings only: never put a LINE channel secret in this repository. */
(() => {
  'use strict';
  const config = window.VILLA_CONFIG || {};
  const sessionKey = 'villa-supplies:session:v3';
  let lineReady;
  function validateConfig() {
    let url;
    try { url = new URL(String(config.webAppUrl || '').trim()); } catch (_) {}
    if (!url || url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(url.pathname) || url.search || url.hash)
      throw new Error('กรุณาตั้งค่า webAppUrl ใน config.js ด้วย URL Apps Script ที่ลงท้าย /exec');
    if (!/^\d+-[A-Za-z0-9]+$/.test(String(config.liffId || '')))
      throw new Error('กรุณาตั้งค่า liffId สำหรับระบบเบิกพัสดุใน config.js');
    return url.href;
  }
  async function request(action, ...args) {
    const url = validateConfig();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      // A simple POST avoids a CORS preflight. ContentService redirects are followed.
      // Tokens are sent in the body, never in a URL, JSONP, or query string.
      response = await fetch(url, {
        method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'follow',
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({action, args}), signal: controller.signal,
        referrerPolicy: 'no-referrer'
      });
    } catch (error) {
      throw new Error(error.name === 'AbortError'
        ? 'API ตอบกลับช้า กรุณาลองอีกครั้ง รายการเดิมจะไม่ถูกบันทึกซ้ำ'
        : 'เชื่อมต่อ API ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตและ Deploy Apps Script ให้เข้าถึงได้โดย Anyone');
    } finally { clearTimeout(timer); }
    let result;
    try { result = await response.json(); }
    catch (_) { throw new Error('API ไม่ได้ตอบกลับเป็น JSON กรุณาตรวจ URL /exec และ Deploy เวอร์ชันล่าสุด'); }
    if (!response.ok || !result || typeof result.ok !== 'boolean') throw new Error('API ตอบกลับไม่ถูกต้อง');
    if (!result.ok) throw new Error(result.error || 'ทำรายการไม่สำเร็จ');
    return result.data;
  }
  function readSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(sessionKey));
      if (saved && typeof saved.token === 'string' && Number(saved.expiresAt) > Date.now()) return saved;
      localStorage.removeItem(sessionKey);
    } catch (_) {}
    return null;
  }
  function saveSession(user) {
    // Store only the app session; LINE ID/access tokens are never persisted here.
    try { localStorage.setItem(sessionKey, JSON.stringify({token:user.token, expiresAt:user.expiresAt})); return true; }
    catch (_) { return false; }
  }
  function clearSession() { try { localStorage.removeItem(sessionKey); } catch (_) {} }
  async function initLine() {
    validateConfig();
    if (!window.liff) throw new Error('โหลด LINE SDK ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรช');
    if (!lineReady) lineReady = liff.init({liffId:config.liffId}).catch(error => { lineReady = null; throw error; });
    try { await lineReady; }
    catch (_) { throw new Error('เริ่ม LINE Login ไม่สำเร็จ กรุณาตรวจ LIFF ID และ Endpoint URL ใน LINE Developers'); }
  }
  function pendingLogin(value) {
    try {
      if (value === true) sessionStorage.setItem('villa-supplies:line-pending', String(Date.now()));
      if (value === false) sessionStorage.removeItem('villa-supplies:line-pending');
      const at = Number(sessionStorage.getItem('villa-supplies:line-pending'));
      return at > 0 && Date.now() - at < 600000;
    } catch (_) { return false; }
  }
  async function login() {
    await initLine();
    if (!liff.isLoggedIn()) {
      pendingLogin(true);
      liff.login({redirectUri:location.origin + location.pathname});
      return null;
    }
    pendingLogin(false);
    const idToken = liff.getIDToken();
    if (!idToken) throw new Error('LINE ไม่ส่ง ID token กรุณาเปิด scope openid ใน LIFF และเข้าสู่ระบบใหม่');
    return request('loginWithLine', idToken);
  }
  window.VillaAPI = {request,validateConfig,readSession,saveSession,clearSession,initLine,login,pendingLogin,sessionKey};
})();
