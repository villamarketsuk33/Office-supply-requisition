/* Public settings only: never put a LINE channel secret in this repository. */
(() => {
  'use strict';
  const config = window.VILLA_CONFIG || {};
  const sessionKey = 'villa-supplies:session:v3';
  const renewalKey = 'villa-supplies:line-renewal:' + String(config.liffId || '');
  let lineReady;
  function validateConfig(requireLine = true) {
    let url;
    try { url = new URL(String(config.webAppUrl || '').trim()); } catch (_) {}
    if (!url || url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(url.pathname) || url.search || url.hash)
      throw new Error('กรุณาตั้งค่า webAppUrl ใน config.js ด้วย URL Apps Script ที่ลงท้าย /exec');
    if (requireLine && !/^\d+-[A-Za-z0-9]+$/.test(String(config.liffId || '')))
      throw new Error('กรุณาตั้งค่า liffId สำหรับระบบเบิกพัสดุใน config.js');
    return url.href;
  }
  async function request(action, ...args) {
    const url = validateConfig(false);
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
    if (action === 'loginWithLine' && args[0]?.accessToken && result.authProtocol !== 'line-access-v1')
      throw authError('API_UPDATE_REQUIRED', 'กรุณาอัปเดต Code.gs และ Deploy New version ให้ URL /exec แสดง version 3.5.0 ก่อนใช้งานหน้าเว็บชุดนี้');
    if (['startDesktopLogin','inspectDesktopLogin','approveDesktopLogin','pollDesktopLogin','cancelDesktopLogin'].includes(action) && result.qrProtocol !== 'desktop-qr-v1')
      throw authError('API_UPDATE_REQUIRED', 'กรุณาอัปเดต Code.gs และ Deploy New version 3.5.0 เพื่อใช้ QR บนคอม');
    if (['getWarehouseOrders','saveFulfillment','retryReadyNotification'].includes(action) && result.fulfillmentProtocol !== 'warehouse-v1')
      throw authError('API_UPDATE_REQUIRED', 'กรุณาแทนที่ Code.gs และ Deploy New version 3.7.0 เพื่อบันทึกจำนวนจัดจริงและแจ้งพร้อมรับ');
    if (!result.ok) {
      const error = new Error(result.error || 'ทำรายการไม่สำเร็จ');
      error.code = result.code || '';
      if (result.code === 'REGISTRATION_REQUIRED') error.registrationUrl = result.registrationUrl;
      throw error;
    }
    if (action === 'getWeeklyWithdrawalReport' && result.reorderProtocol !== 'par-k-v1')
      throw authError('API_UPDATE_REQUIRED', 'กรุณาแทนที่ Code.gs และ Deploy New version 3.6.0 เพื่อคำนวณพาร์จาก Inventory คอลัมน์ K');
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
    try { localStorage.setItem(sessionKey, JSON.stringify({token:user.token, expiresAt:user.expiresAt,...(user.authMethod==='qr'?{authMethod:'qr'}:{})})); return true; }
    catch (_) { return false; }
  }
  function clearSession() { try { localStorage.removeItem(sessionKey); } catch (_) {} }
  async function restoreDesktopSession() {
    const saved = readSession();
    if (saved?.authMethod !== 'qr') { clearSession(); return null; }
    try {
      const user = await request('restoreSession', saved.token);
      if (user.authMethod === 'qr') return user;
      clearSession();
      return null;
    } catch (error) {
      if (/SESSION_EXPIRED|ACCESS_DENIED|REGISTRATION_REQUIRED/.test(error.code || error.message)) clearSession();
      throw error;
    }
  }
  const scanKey = 'villa-supplies:qr-approval';
  let pendingScan = '';
  function rememberScan() {
    // Call only after liff.init resolves: LIFF first restores liff.state into
    // the endpoint URL. Do not edit the URL during LIFF's primary redirect.
    const scan = new URLSearchParams(location.search || '').get('desktopLogin');
    if (scan && /^[a-f0-9-]{72}$/i.test(scan)) {
      pendingScan = scan;
      try { sessionStorage.setItem(scanKey, JSON.stringify({scan,until:Date.now()+300000})); } catch (_) {}
    }
  }
  function pendingDesktopApproval() {
    if (pendingScan) return pendingScan;
    try {
      const saved=JSON.parse(sessionStorage.getItem(scanKey));
      if (saved && saved.until>Date.now() && /^[a-f0-9-]{72}$/i.test(saved.scan)) return saved.scan;
      sessionStorage.removeItem(scanKey);
    } catch (_) {}
    return '';
  }
  function finishDesktopApproval() {
    pendingScan = '';
    try { sessionStorage.removeItem(scanKey); } catch (_) {}
    try {
      const url = new URL(location.href);
      url.searchParams.delete('desktopLogin');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (_) {}
  }
  function desktopQrUrl(scanToken) {
    validateConfig();
    if (!/^[a-f0-9-]{72}$/i.test(scanToken)) throw new Error('ข้อมูล QR ไม่ถูกต้อง');
    return 'https://liff.line.me/' + config.liffId + '?desktopLogin=' + encodeURIComponent(scanToken);
  }
  function registrationDestination(error) {
    if (error?.code !== 'REGISTRATION_REQUIRED') return null;
    try {
      const url = new URL(error.registrationUrl);
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      if (url.hostname === 'liff.line.me' && url.pathname.split('/')[1] === config.liffId) return null;
      const pagePath = value => value.replace(/\/index\.html$/, '/');
      if (url.origin === location.origin && pagePath(url.pathname) === pagePath(location.pathname)) return null;
      return url.href;
    } catch (_) {}
    return null;
  }
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
  function authError(code, message) {
    const error = new Error(code + ': ' + message);
    error.code = code;
    return error;
  }
  function clearRenewal() { try { sessionStorage.removeItem(renewalKey); } catch (_) {} }
  function reserveRenewal(automatic) {
    try {
      const previous = Number(sessionStorage.getItem(renewalKey));
      if (automatic && previous > 0 && Date.now() - previous < 600000) return false;
      sessionStorage.setItem(renewalKey, String(Date.now()));
      return true;
    } catch (_) {
      // A redirect cannot be bounded across reloads without working storage.
      // Permit an explicit retry, and stop automatic redirects in this case.
      return !automatic;
    }
  }
  function renewLine(automatic) {
    if (!reserveRenewal(automatic)) return false;
    // Preserve the app session. The server reuses its original fixed expiry
    // only after verifying that the current LINE account is the same employee.
    if (liff.isLoggedIn()) liff.logout();
    lineReady = null;
    pendingLogin(true);
    const scan = pendingDesktopApproval();
    const suffix = scan ? '?desktopLogin=' + encodeURIComponent(scan) : '';
    if (liff.isInClient()) {
      location.replace('https://liff.line.me/' + config.liffId + suffix);
    } else {
      liff.login({redirectUri:location.origin + location.pathname + suffix});
    }
    return true;
  }
  async function login(options = {}) {
    await initLine();
    rememberScan();
    if (options.fresh) {
      renewLine(false);
      return null;
    }
    if (!liff.isLoggedIn()) {
      if (renewLine(true)) return null;
      throw authError('LINE_REAUTH_REQUIRED', 'LINE ยังไม่ยืนยันบัญชีหลังเปิดใหม่ กรุณาตรวจสอบการอนุญาต LINE แล้วลองอีกครั้ง');
    }
    pendingLogin(false);
    try {
      const accessToken = liff.getAccessToken();
      if (!accessToken) throw authError('LINE_ACCESS_MISSING', 'LINE ยังไม่ส่งข้อมูลยืนยันบัญชี');
      // Identity is obtained by the server from LINE, after verifying this
      // token's channel and expiry. No cached ID token or client profile is used.
      const user = await request('loginWithLine', {accessToken, token:readSession()?.token || ''});
      clearRenewal();
      return user;
    } catch (error) {
      if (['LINE_ACCESS_INVALID','LINE_ACCESS_MISSING'].includes(error.code) && renewLine(true)) return null;
      if (['REGISTRATION_REQUIRED','ACCESS_DENIED'].includes(error.code)) clearRenewal();
      throw error;
    }
  }
  window.VillaAPI = {request,validateConfig,readSession,saveSession,clearSession,initLine,login,restoreDesktopSession,pendingDesktopApproval,finishDesktopApproval,desktopQrUrl,pendingLogin,registrationDestination,sessionKey};
})();
