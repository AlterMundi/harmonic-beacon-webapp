(() => {
  'use strict';
  const script = document.currentScript;
  if (!script || window.hbAnalytics) return;
  try { if (localStorage.getItem('hb_analytics_disabled') === '1') return; } catch {}
  const collector = String(script.dataset.collector || new URL(script.src).origin).replace(/\/$/, '');
  const surface = script.dataset.surface || 'home';
  const environment = script.dataset.environment || 'production';
  const accountLink = script.dataset.accountLink || '';
  const allowed = new Set(['harmonicbeacon.com', 'www.harmonicbeacon.com', 'account.harmonicbeacon.com', 'listen.harmonicbeacon.com', 'live.harmonicbeacon.com', 'account-staging.harmonicbeacon.com', 'earlybirds-staging.harmonicbeacon.com', 'live-staging.harmonicbeacon.com']);
  const uuid = () => crypto.randomUUID();
  const safeGet = (store, key) => { try { return store.getItem(key); } catch { return null; } };
  const safeSet = (store, key, value) => { try { store.setItem(key, value); } catch {} };
  const SESSION_IDLE_MS = 1800000;
  const now = Date.now();
  let visitorId = safeGet(localStorage, 'hb_analytics_visitor');
  if (!/^[0-9a-f-]{36}$/i.test(visitorId || '')) { visitorId = uuid(); safeSet(localStorage, 'hb_analytics_visitor', visitorId); }
  let session = (() => { try { return JSON.parse(safeGet(sessionStorage, 'hb_analytics_session') || 'null'); } catch { return null; } })();
  if (!session || !/^[0-9a-f-]{36}$/i.test(session.id || '') || now - Number(session.seen || 0) > SESSION_IDLE_MS) session = { id: uuid(), seen: now };
  session.seen = now;
  safeSet(sessionStorage, 'hb_analytics_session', JSON.stringify(session));

  const params = new URLSearchParams(location.search);
  const clickKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid', 'ttclid'];
  const touchKeys = [...clickKeys, 'referrer', 'landing'];
  const currentTouch = Object.fromEntries(clickKeys.map(key => [key, (params.get(key) || '').slice(0, key.endsWith('clid') ? 500 : 200) || null]));
  const hasCampaign = Object.values(currentTouch).some(Boolean);
  const referrer = (() => { try { const value = new URL(document.referrer); return `${value.origin}${value.pathname}`.slice(0, 500); } catch { return null; } })();
  const externalReferrer = (() => { try { return referrer && new URL(referrer).hostname !== location.hostname; } catch { return false; } })();
  const touch = { ...currentTouch, referrer: externalReferrer ? referrer : null, landing: location.pathname.slice(0, 500) };
  let firstTouch = (() => { try { return JSON.parse(safeGet(localStorage, 'hb_analytics_first_touch') || 'null'); } catch { return null; } })();
  let lastTouch = (() => { try { return JSON.parse(safeGet(localStorage, 'hb_analytics_last_touch') || 'null'); } catch { return null; } })();
  if (!firstTouch) { firstTouch = touch; safeSet(localStorage, 'hb_analytics_first_touch', JSON.stringify(firstTouch)); }
  if (!lastTouch || hasCampaign || externalReferrer) { lastTouch = touch; safeSet(localStorage, 'hb_analytics_last_touch', JSON.stringify(lastTouch)); }

  let handoff = params.get('hb_at');
  let handoffSessionId = null;
  let handoffExpiresAt = 0;
  let sessionTimer = null;
  let handoffTimer = null;
  if (handoff) {
    params.delete('hb_at');
    const remaining = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${remaining ? `?${remaining}` : ''}${location.hash}`);
  }
  const browser = (() => {
    const ua = navigator.userAgent;
    return /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  })();
  const os = (() => {
    const ua = navigator.userAgent;
    return /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  })();
  const deviceClass = /iPad|Tablet/.test(navigator.userAgent) ? 'tablet' : /Mobi|Android|iPhone/.test(navigator.userAgent) ? 'mobile' : 'desktop';

  const payload = (eventName, properties = {}) => ({
    schema_version: 'hb.analytics.event.v1', event_id: uuid(), event_name: eventName,
    occurred_at: new Date().toISOString(), source: 'browser', surface, environment,
    visitor_id: visitorId, session_id: session.id, traffic_class: 'real', handoff,
    page: { path: location.pathname, title: document.title.slice(0, 200), referrer, landing: firstTouch.landing || location.pathname },
    first_attribution: Object.fromEntries(touchKeys.map(key => [key, firstTouch[key] || null])),
    last_attribution: Object.fromEntries(touchKeys.map(key => [key, lastTouch[key] || null])),
    device: { class: deviceClass, browser, os, language: navigator.language.slice(0, 20), screen: `${screen.width}x${screen.height}` },
    properties,
  });
  const scheduleSessionRotation = () => {
    if (sessionTimer !== null) clearTimeout(sessionTimer);
    const remaining = Math.max(100, SESSION_IDLE_MS - (Date.now() - Number(session.seen || 0)) + 10);
    sessionTimer = setTimeout(() => {
      if (Date.now() - Number(session.seen || 0) < SESSION_IDLE_MS) return scheduleSessionRotation();
      session = { id: uuid(), seen: Date.now() };
      handoff = null; handoffSessionId = null; handoffExpiresAt = 0;
      safeSet(sessionStorage, 'hb_analytics_session', JSON.stringify(session));
      scheduleSessionRotation();
      void refreshIdentity();
    }, remaining);
  };
  const touchSession = () => {
    const touchedAt = Date.now();
    if (touchedAt - Number(session.seen || 0) >= SESSION_IDLE_MS) {
      session = { id: uuid(), seen: touchedAt };
      handoff = null; handoffSessionId = null; handoffExpiresAt = 0;
      void refreshIdentity();
    } else session.seen = touchedAt;
    safeSet(sessionStorage, 'hb_analytics_session', JSON.stringify(session));
    scheduleSessionRotation();
  };
  const send = (eventName, properties) => {
    try {
      touchSession();
      const body = JSON.stringify(payload(eventName, properties));
      if (navigator.sendBeacon && navigator.sendBeacon(`${collector}/v1/events`, new Blob([body], { type: 'application/json' }))) return;
      fetch(`${collector}/v1/events`, { method: 'POST', mode: 'cors', credentials: 'omit', keepalive: true, headers: { 'content-type': 'application/json' }, body }).catch(() => {});
    } catch {}
  };
  window.hbAnalytics = { track: send, visitorId: () => visitorId, sessionId: () => session.id };

  const decorate = (token, boundSessionId, expiresIn) => {
    if (!token) return;
    handoff = token;
    handoffSessionId = boundSessionId;
    handoffExpiresAt = Date.now() + Math.max(1, Number(expiresIn || 0)) * 1000;
    if (handoffTimer !== null) clearTimeout(handoffTimer);
    handoffTimer = setTimeout(() => { void refreshIdentity(); }, 600000);
    document.querySelectorAll('a[href]').forEach(link => {
      try {
        const url = new URL(link.href, location.href);
        if (url.protocol === 'https:' && allowed.has(url.hostname) && url.hostname !== location.hostname) {
          url.searchParams.set('hb_at', token);
          link.href = url.toString();
        }
      } catch {}
    });
  };
  const refreshIdentity = () => {
    const boundVisitorId = visitorId;
    const boundSessionId = session.id;
    const handoffQuery = new URLSearchParams({ visitor_id: boundVisitorId, session_id: boundSessionId, first_touch: JSON.stringify(firstTouch), last_touch: JSON.stringify(lastTouch) });
    fetch(`${collector}/v1/handoff?${handoffQuery}`, { mode: 'cors', credentials: 'omit' })
      .then(r => r.ok ? r.json() : null)
      .then(v => {
        if (v && visitorId === boundVisitorId && session.id === boundSessionId) {
          decorate(v.token, boundSessionId, v.expires_in);
        }
      }).catch(() => {});
    if (accountLink) {
      fetch(accountLink, { method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visitor_id: boundVisitorId, session_id: boundSessionId }) }).catch(() => {});
    }
  };
  const begin = async () => {
    if (handoff) {
      try {
        const response = await fetch(`${collector}/v1/handoff/resolve?token=${encodeURIComponent(handoff)}`, { mode: 'cors', credentials: 'omit' });
        const resolved = response.ok ? await response.json() : null;
        if (resolved && /^[0-9a-f-]{36}$/i.test(resolved.visitor_id || '') && /^[0-9a-f-]{36}$/i.test(resolved.session_id || '')) {
          visitorId = resolved.visitor_id;
          session = { id: resolved.session_id, seen: Date.now() };
          if (resolved.first_touch) firstTouch = resolved.first_touch;
          if (resolved.last_touch) lastTouch = resolved.last_touch;
          safeSet(localStorage, 'hb_analytics_visitor', visitorId);
          safeSet(localStorage, 'hb_analytics_first_touch', JSON.stringify(firstTouch));
          safeSet(localStorage, 'hb_analytics_last_touch', JSON.stringify(lastTouch));
          safeSet(sessionStorage, 'hb_analytics_session', JSON.stringify(session));
        }
      } catch {}
    }
    handoff = null;
    refreshIdentity();
    scheduleSessionRotation();
    send('page.viewed');
  };
  void begin();

  let lastPath = `${location.pathname}${location.search}`;
  const routeChanged = navigation => queueMicrotask(() => {
    const path = `${location.pathname}${location.search}`;
    if (path !== lastPath) { lastPath = path; send('page.viewed', { navigation }); }
  });
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) { const result = original.apply(this, args); routeChanged(method); return result; };
  }
  addEventListener('popstate', () => routeChanged('popstate'));
  const pageStarted = performance.now();
  document.addEventListener('submit', event => {
    const form = event.target;
    send('form.submitted', { form_id: String(form.id || form.getAttribute('name') || 'anonymous').slice(0, 80) });
  }, { capture: true, passive: true });
  document.addEventListener('click', event => {
    const explicit = event.target.closest && event.target.closest('[data-hb-event]');
    if (explicit) {
      send(String(explicit.dataset.hbEvent).slice(0, 64), { component: String(explicit.dataset.hbComponent || explicit.tagName).slice(0, 80) });
      return;
    }
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    try {
      touchSession();
      const url = new URL(link.href, location.href);
      if (url.protocol === 'https:' && allowed.has(url.hostname) && url.hostname !== location.hostname) {
        if (handoff && handoffSessionId === session.id && Date.now() < handoffExpiresAt) url.searchParams.set('hb_at', handoff);
        else url.searchParams.delete('hb_at');
        link.href = url.toString();
      }
      send('navigation.clicked', { destination_host: url.hostname.slice(0, 120), destination_path: url.pathname.slice(0, 300) });
    } catch {}
  }, { capture: true, passive: true });
  addEventListener('pagehide', () => send('page.engagement', { elapsed_ms: Math.max(0, Math.round(performance.now() - pageStarted)) }));
})();
