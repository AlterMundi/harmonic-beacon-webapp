/* Harmonic Beacon global navigation — canonical cross-product asset. */
(function () {
  'use strict';

  var MAIN_ORIGIN = 'https://harmonicbeacon.com';
  var LISTENER_ORIGIN = 'https://listen.harmonicbeacon.com';
  var LISTENER_STAGING_ORIGIN = 'https://earlybirds-staging.harmonicbeacon.com';
  var LIVE_ORIGIN = 'https://live.harmonicbeacon.com';
  var LIVE_STAGING_ORIGIN = 'https://live-staging.harmonicbeacon.com';
  var ACCOUNT_ORIGIN = 'https://account.harmonicbeacon.com';
  var ACCOUNT_STAGING_ORIGIN = 'https://account-staging.harmonicbeacon.com';
  var ELEMENT_NAME = 'hb-global-nav';

  var links = [
    { key: 'events', href: LIVE_ORIGIN + '/', en: 'Events', es: 'Eventos' },
    { key: 'listen', href: LISTENER_ORIGIN + '/', en: 'Listen', es: 'Escuchar' },
    { key: 'news', href: MAIN_ORIGIN + '/eventos/', en: 'News', es: 'Novedades' },
    { key: 'why', href: MAIN_ORIGIN + '/#porque', en: 'Why it works', es: 'Por qué funciona' },
    { key: 'foundation', href: MAIN_ORIGIN + '/#foundation', en: 'HIT', es: 'HIT' }
  ];

  function validLanguage(value) {
    return value === 'es' || value === 'en' ? value : null;
  }

  function storedLanguage() {
    try {
      return validLanguage(localStorage.getItem('hb-locale')) || validLanguage(localStorage.getItem('hb-lang'));
    } catch (error) {
      return null;
    }
  }

  function currentLanguage() {
    var params = new URLSearchParams(location.search);
    var documentLanguage = validLanguage(document.documentElement.getAttribute('data-lang')) ||
      validLanguage(document.documentElement.getAttribute('data-active-lang'));
    var mainSite = location.hostname === 'harmonicbeacon.com' || location.hostname === 'www.harmonicbeacon.com';
    return validLanguage(params.get('lang')) ||
      (mainSite ? storedLanguage() : documentLanguage) ||
      (mainSite ? documentLanguage : storedLanguage()) ||
      ((document.documentElement.lang || navigator.language || 'en').toLowerCase().indexOf('es') === 0 ? 'es' : 'en');
  }

  function persistLanguage(language) {
    document.documentElement.lang = language;
    document.documentElement.setAttribute('data-lang', language);
    document.documentElement.setAttribute('data-active-lang', language);
    try {
      localStorage.setItem('hb-lang', language);
      localStorage.setItem('hb-locale', language);
    } catch (error) {
      // Hardened browsers may disable local storage; the cookie still works.
    }
    document.cookie = 'hb_locale=' + language + '; Path=/; Max-Age=31536000; SameSite=Lax';
  }

  function applyLinkedLanguage() {
    var url = new URL(location.href);
    var requested = validLanguage(url.searchParams.get('lang'));
    if (!requested) return false;
    var rendered = validLanguage(document.documentElement.getAttribute('data-lang')) ||
      validLanguage(document.documentElement.getAttribute('data-active-lang'));
    persistLanguage(requested);
    url.searchParams.delete('lang');
    if (location.hostname === 'harmonicbeacon.com' || location.hostname === 'www.harmonicbeacon.com') {
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      return false;
    }
    if (rendered !== requested) {
      location.replace(url.toString());
      return true;
    }
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    return false;
  }

  function localizedHref(href, language) {
    var url = new URL(href);
    url.searchParams.set('lang', language);
    return url.toString();
  }

  function activeKey() {
    var host = location.hostname.toLowerCase();
    if (host === 'listen.harmonicbeacon.com' || host === 'earlybirds-staging.harmonicbeacon.com') return 'listen';
    if (host === 'live.harmonicbeacon.com') return 'events';
    if (location.pathname.indexOf('/eventos') === 0) return 'news';
    if (location.hash === '#porque') return 'why';
    if (location.hash === '#foundation') return 'foundation';
    return null;
  }

  function accountControlAvailable(element) {
    var host = location.hostname.toLowerCase();
    return host === 'earlybirds-staging.harmonicbeacon.com' ||
      host === 'live-staging.harmonicbeacon.com' ||
      host === 'account-staging.harmonicbeacon.com' ||
      element.hasAttribute('data-account-available');
  }

  function accountOrigin() {
    var host = location.hostname.toLowerCase();
    return host === 'earlybirds-staging.harmonicbeacon.com' ||
      host === 'live-staging.harmonicbeacon.com' ||
      host === 'account-staging.harmonicbeacon.com'
      ? ACCOUNT_STAGING_ORIGIN
      : ACCOUNT_ORIGIN;
  }

  function accountReturnTo() {
    var host = location.hostname.toLowerCase();
    if (host === 'listen.harmonicbeacon.com') return LISTENER_ORIGIN + '/';
    if (host === 'earlybirds-staging.harmonicbeacon.com') {
      return LISTENER_STAGING_ORIGIN + '/';
    }
    if (host === 'live-staging.harmonicbeacon.com') return LIVE_STAGING_ORIGIN + '/';
    if (host === 'live.harmonicbeacon.com') return LIVE_ORIGIN + '/';
    return MAIN_ORIGIN + '/';
  }

  function accountPageHref(language) {
    var url = new URL('/account', accountOrigin());
    url.searchParams.set('lang', language);
    url.searchParams.set('return_to', accountReturnTo());
    return url.toString();
  }

  function label(item, language) {
    return language === 'es' ? item.es : item.en;
  }

  function beaconMarkPath() {
    var points = [];
    for (var index = 0; index <= 280; index += 1) {
      var angle = Math.PI * 2 * index / 280;
      var x = 100 + 92 * Math.cos(angle * 3);
      var y = 100 + 92 * Math.sin(angle * 2);
      points.push((index === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2));
    }
    return points.join(' ');
  }

  var style = `
    :host { display:block; height:72px; color:#E9E0D0; font-family:Inter,system-ui,-apple-system,sans-serif; }
    :host([overlay]) { height:0; }
    * { box-sizing:border-box; }
    a { color:inherit; text-decoration:none; }
    .nav { position:fixed; inset:0 0 auto; z-index:2147483000; min-height:72px; border-bottom:1px solid rgba(244,238,226,.08); background:rgba(22,18,13,.82); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
    .inner { width:100%; max-width:1180px; min-height:72px; margin:0 auto; padding:12px 24px; display:flex; align-items:center; justify-content:space-between; gap:18px; }
    .brand { display:flex; align-items:center; gap:10px; flex:0 0 auto; border-radius:8px; }
    .mark { width:30px; height:30px; display:block; color:#C9A24E; filter:drop-shadow(0 2px 14px rgba(201,162,78,.18)); }
    .mark path { fill:none; stroke:currentColor; stroke-width:3.4; stroke-linecap:round; stroke-linejoin:round; vector-effect:non-scaling-stroke; }
    .wordmark { color:#F4EEE2; font-size:12px; font-weight:600; letter-spacing:.18em; text-transform:uppercase; white-space:nowrap; }
    .links { display:flex; align-items:center; justify-content:flex-end; gap:1px; margin:0; padding:0; list-style:none; }
    .links a { position:relative; display:block; padding:9px 8px; border-radius:999px; color:#ADA089; font-size:10.5px; font-weight:500; letter-spacing:.12em; line-height:1.2; text-transform:uppercase; white-space:nowrap; transition:color .25s ease,background .25s ease; }
    .links a:hover { color:#F4EEE2; background:rgba(244,238,226,.035); }
    .links a[aria-current=page] { color:#C9A24E; }
    .links a[aria-current=page]::after { content:""; position:absolute; left:9px; right:9px; bottom:3px; height:1.5px; border-radius:2px; background:#C9A24E; }
    .language { min-width:60px; min-height:44px; padding:0 5px; border:0; border-radius:999px; color:#8A7F6B; background:transparent; cursor:pointer; font:500 11px/1 Inter,system-ui,sans-serif; letter-spacing:.1em; }
    .language strong { color:#C9A24E; font-weight:600; }
    .sep { opacity:.42; padding:0 2px; }
    .account-control { position:relative; width:44px; height:44px; flex:0 0 44px; }
    .account-trigger { position:absolute; z-index:2; inset:0; display:grid; place-items:center; width:44px; height:44px; padding:0; border:1px solid rgba(201,162,78,.32); border-radius:999px; color:#E9E0D0; background:rgba(244,238,226,.045); cursor:pointer; transition:color .2s ease,border-color .2s ease,background .2s ease; }
    .account-trigger:hover,.account-trigger[aria-expanded=true] { color:#F4EEE2; border-color:rgba(201,162,78,.62); background:rgba(201,162,78,.12); }
    .account-trigger.signed-in { border-color:rgba(201,162,78,.72); background:rgba(201,162,78,.1); }
    .account-trigger.signed-in::after { content:""; position:absolute; right:3px; bottom:3px; width:7px; height:7px; border:2px solid #16120D; border-radius:999px; background:#C9A24E; }
    .account-trigger svg { width:22px; height:22px; fill:none; stroke:currentColor; stroke-width:1.65; stroke-linecap:round; stroke-linejoin:round; }
    .account-menu { position:absolute; z-index:4; top:calc(100% + 8px); right:0; min-width:164px; padding:6px; border:1px solid rgba(201,162,78,.34); border-radius:12px; background:#16120D; box-shadow:0 18px 48px rgba(0,0,0,.34); }
    .account-menu[hidden] { display:none; }
    .account-menu slot { display:block; }
    .account-menu a { display:flex; min-height:44px; align-items:center; padding:10px 12px; border-radius:8px; color:#E9E0D0; font-size:11px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; white-space:nowrap; }
    .account-menu a:hover { color:#F4EEE2; background:rgba(201,162,78,.1); }
    .toggle { display:none; width:44px; height:44px; padding:0 10px; border:0; background:transparent; cursor:pointer; }
    .toggle span { display:block; height:1.5px; margin:5px 0; background:#ADA089; transition:transform .25s ease,opacity .2s ease; }
    .toggle[aria-expanded=true] span:nth-child(1) { transform:translateY(6.5px) rotate(45deg); }
    .toggle[aria-expanded=true] span:nth-child(2) { opacity:0; }
    .toggle[aria-expanded=true] span:nth-child(3) { transform:translateY(-6.5px) rotate(-45deg); }
    .mobile { display:none; border-top:1px solid rgba(244,238,226,.08); background:rgba(22,18,13,.98); }
    .mobile.open { display:block; }
    .mobile ul { margin:0; padding:8px 24px 18px; list-style:none; }
    .mobile a { display:block; min-height:44px; padding:13px 0; border-top:1px solid rgba(244,238,226,.08); color:#E9E0D0; font-size:12px; letter-spacing:.14em; text-transform:uppercase; }
    .mobile a[aria-current=page] { color:#C9A24E; }
    :focus-visible { outline:2px solid #C9A24E; outline-offset:3px; }
    @media (max-width:1120px) { .links { display:none; } .toggle { display:block; } .inner { min-height:68px; padding-top:10px; padding-bottom:10px; } :host { height:68px; } :host([overlay]) { height:0; } }
    @media (max-width:430px) { .inner { padding-left:16px; padding-right:12px; } .wordmark { font-size:10.5px; letter-spacing:.14em; } .mark { width:27px; height:27px; } .language { min-width:54px; } }
    @media (max-width:365px) { .wordmark { display:none; } }
    @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto !important; transition:none !important; } }
    @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) { .nav { background:#16120D; } }
  `;

  function isCockpitEmbed() {
    return window.self !== window.top && new URLSearchParams(window.location.search).get('surface') === 'cockpit';
  }

  class HarmonicBeaconGlobalNav extends HTMLElement {
    static get observedAttributes() {
      return ['data-account-available', 'data-account-signed-in'];
    }

    attributeChangedCallback(name, previous, next) {
      if (this.constructor.observedAttributes.includes(name) && previous !== next && this.shadowRoot) this.render();
    }

    connectedCallback() {
      if (this.shadowRoot) return;
      // The conductor cockpit embeds the ordinary room as an operational
      // surface. Its outer document already owns the product navigation;
      // repeating it inside the iframe wastes scarce room space and creates
      // two competing global headers.
      if (isCockpitEmbed()) {
        this.hidden = true;
        return;
      }
      this.language = currentLanguage();
      this.attachShadow({ mode: 'open' });
      this.render();
      this.observer = new MutationObserver(() => {
        var next = currentLanguage();
        if (next !== this.language) {
          this.language = next;
          this.render();
        }
      });
      this.observer.observe(document.documentElement, { attributes:true, attributeFilter:['lang','data-lang','data-active-lang'] });
    }

    disconnectedCallback() {
      if (this.observer) this.observer.disconnect();
      if (this.outsideClick) document.removeEventListener('click', this.outsideClick);
    }

    render() {
      var language = this.language;
      var active = this.getAttribute('data-surface') || activeKey();
      var items = links.map(function (item) {
        var current = active === item.key ? ' aria-current="page"' : '';
        return '<li><a data-key="' + item.key + '" href="' + localizedHref(item.href, language) + '"' + current + '>' + label(item, language) + '</a></li>';
      }).join('');
      var brandHref = localizedHref(MAIN_ORIGIN + '/', language);
      var menuLabel = language === 'es' ? 'Menú' : 'Menu';
      var navLabel = language === 'es' ? 'Navegación principal' : 'Primary navigation';
      var accountSignedIn = this.hasAttribute('data-account-signed-in');
      var userMenuLabel = language === 'es'
        ? (accountSignedIn ? 'Menú de usuario, sesión iniciada' : 'Menú de usuario')
        : (accountSignedIn ? 'User menu, signed in' : 'User menu');
      var accountLabel = language === 'es' ? 'Cuenta' : 'Account';
      var accountControl = accountControlAvailable(this)
        ? '<div class="account-control">' +
            '<button class="account-trigger' + (accountSignedIn ? ' signed-in' : '') + '" type="button" aria-label="' + userMenuLabel + '" aria-haspopup="menu" aria-controls="hb-account-menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.25"></circle><path d="M5.75 19c.6-3.25 2.7-5 6.25-5s5.65 1.75 6.25 5"></path></svg></button>' +
            '<div class="account-menu" id="hb-account-menu" role="menu" hidden><slot name="account-menu"><a role="menuitem" href="' + accountPageHref(language) + '">' + accountLabel + '</a></slot></div>' +
          '</div>'
        : '';
      this.shadowRoot.innerHTML = '<style>' + style + '</style>' +
        '<header class="nav"><div class="inner">' +
          '<a class="brand" href="' + brandHref + '" aria-label="Harmonic Beacon">' +
            '<svg class="mark" viewBox="0 0 200 200" aria-hidden="true" focusable="false"><path d="' + beaconMarkPath() + '"></path></svg>' +
            '<span class="wordmark">Harmonic Beacon</span></a>' +
          '<nav aria-label="' + navLabel + '"><ul class="links">' + items + '</ul></nav>' +
          '<div style="display:flex;align-items:center;gap:2px">' +
            '<button class="language" type="button" aria-label="Language / Idioma"><span class="en">EN</span><span class="sep">/</span><span class="es">ES</span></button>' +
            accountControl +
            '<button class="toggle" type="button" aria-label="' + menuLabel + '" aria-expanded="false"><span></span><span></span><span></span></button>' +
          '</div>' +
        '</div><nav class="mobile" aria-label="' + navLabel + '"><ul>' + items + '</ul></nav></header>';
      this.shadowRoot.querySelector('.' + language).outerHTML = '<strong class="' + language + '">' + language.toUpperCase() + '</strong>';
      var languageButton = this.shadowRoot.querySelector('.language');
      languageButton.addEventListener('click', () => {
        var next = this.language === 'es' ? 'en' : 'es';
        persistLanguage(next);
        window.dispatchEvent(new CustomEvent('hb-language-change', { detail:{ language:next } }));
        this.language = next;
        this.render();
        if (location.hostname !== 'harmonicbeacon.com' && location.hostname !== 'www.harmonicbeacon.com') location.reload();
      });
      var accountTrigger = this.shadowRoot.querySelector('.account-trigger');
      var accountMenu = this.shadowRoot.querySelector('.account-menu');
      if (accountTrigger && accountMenu) {
        var accountMenuSlot = accountMenu.querySelector('slot');
        var accountMenuItems = function () {
          var assigned = accountMenuSlot.assignedElements({ flatten:true });
          if (!assigned.length) return Array.from(accountMenu.querySelectorAll('[role="menuitem"]'));
          return assigned.flatMap(function (element) {
            var items = element.matches('[role="menuitem"]') ? [element] : [];
            return items.concat(Array.from(element.querySelectorAll('[role="menuitem"]')));
          });
        };
        var setAccountMenuOpen = function (open) {
          accountTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
          accountMenu.hidden = !open;
        };
        accountTrigger.addEventListener('click', function () {
          setAccountMenuOpen(accountTrigger.getAttribute('aria-expanded') !== 'true');
        });
        accountTrigger.addEventListener('keydown', function (event) {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setAccountMenuOpen(true);
          var firstItem = accountMenuItems()[0];
          if (firstItem) firstItem.focus();
        });
        accountMenu.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape') return;
          setAccountMenuOpen(false);
          accountTrigger.focus();
        });
        accountTrigger.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape') return;
          setAccountMenuOpen(false);
          accountTrigger.focus();
        });
        if (this.outsideClick) document.removeEventListener('click', this.outsideClick);
        this.outsideClick = function (event) {
          if (!event.composedPath().includes(this)) setAccountMenuOpen(false);
        }.bind(this);
        document.addEventListener('click', this.outsideClick);
      }
      var toggle = this.shadowRoot.querySelector('.toggle');
      var mobile = this.shadowRoot.querySelector('.mobile');
      toggle.addEventListener('click', function () {
        var open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        mobile.classList.toggle('open', open);
      });
      mobile.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', function () {
          toggle.setAttribute('aria-expanded', 'false');
          mobile.classList.remove('open');
        });
      });
    }
  }

  if (applyLinkedLanguage()) return;
  if (!customElements.get(ELEMENT_NAME)) customElements.define(ELEMENT_NAME, HarmonicBeaconGlobalNav);
  if (!document.querySelector(ELEMENT_NAME)) {
    var element = document.createElement(ELEMENT_NAME);
    element.setAttribute('overlay', '');
    document.body.insertBefore(element, document.body.firstChild);
  }
})();
