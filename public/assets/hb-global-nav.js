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

  // Sai-selected curve; see src/brand/canonical/manifest.json for source provenance.
  function beaconMarkPath() {
    return "M66.6027 20.2605 C68.3761 20.1142 70.6667 19.4645 74.5634 21.0034 C78.4601 22.5424 84.2989 25.7148 89.9827 29.4942 C95.6665 33.2736 102.3832 38.5177 108.6661 43.6798 C114.9491 48.8419 122.2218 55.11 127.6805 60.4669 C133.1392 65.8239 138.4676 71.4605 141.4184 75.8216 C144.3691 80.1827 145.189 83.4879 145.3848 86.6337 C145.5806 89.7794 144.1301 92.2929 142.5931 94.6962 C141.0561 97.0995 139.2115 98.8751 136.1628 101.0533 C133.114 103.2315 129.1023 105.5164 124.3005 107.7653 C119.4988 110.0143 113.8236 112.0355 107.3521 114.5472 C100.8806 117.0589 92.6239 120.378 85.4714 122.8355 C78.3189 125.293 70.7169 126.9262 64.4373 129.2921 C58.1577 131.6581 51.8225 134.3727 47.7938 137.0313 C43.7651 139.6899 41.4017 142.9068 40.2652 145.2437 C39.1288 147.5807 40.1151 149.0267 40.9752 151.053 C41.8352 153.0792 43.0862 155.1658 45.4256 157.4013 C47.765 159.6369 51.1818 162.2637 55.0115 164.4661 C58.8413 166.6684 63.2767 168.6749 68.404 170.6155 C73.5313 172.5561 79.5625 174.6382 85.7753 176.1096 C91.9882 177.5811 99.0434 178.8087 105.6811 179.4443 C112.3188 180.08 119.6601 180.0612 125.6015 179.9235 C131.543 179.7859 136.6858 179.4589 141.3298 178.6185 C145.9737 177.7781 150.788 176.0636 153.4653 174.8811 C156.1427 173.6987 156.2654 172.8518 157.3939 171.5237 C158.5224 170.1956 160.188 169.0993 160.2363 166.9124 C160.2846 164.7255 159.7556 161.4701 157.6836 158.4022 C155.6116 155.3343 151.5365 151.6804 147.8042 148.5052 C144.0718 145.33 139.7891 142.5388 135.2896 139.3511 C130.79 136.1635 125.8708 132.8607 120.8069 129.3793 C115.743 125.8979 109.9227 121.8202 104.906 118.4625 C99.8893 115.1049 95.3531 112.3832 90.7069 109.2333 C86.0606 106.0835 81.1838 102.5423 77.0285 99.5635 C72.8731 96.5848 68.824 93.7781 65.7748 91.3608 C62.7257 88.9435 60.3165 87.0087 58.7335 85.0598 C57.1506 83.1109 56.8935 81.8145 56.2772 79.6673 C55.661 77.5201 54.5282 74.9197 55.0362 72.1766 C55.5442 69.4335 56.9076 66.2059 59.3253 63.2087 C61.7429 60.2115 65.9564 57.1381 69.5421 54.1934 C73.1278 51.2487 76.658 48.2761 80.8395 45.5406 C85.0211 42.805 90.1056 40.0589 94.6314 37.7801 C99.1573 35.5014 103.4766 33.4647 107.9945 31.8681 C112.5125 30.2715 117.8173 28.9524 121.7391 28.2006 C125.6609 27.4487 128.9606 27.2901 131.5254 27.357 C134.0902 27.4239 135.8061 28.0267 137.1278 28.6021 C138.4496 29.1775 139.0145 29.7092 139.456 30.8094 C139.8975 31.9097 140.3701 33.4087 139.7767 35.2035 C139.1834 36.9983 137.6456 39.44 135.896 41.5782 C134.1465 43.7163 131.7542 45.6362 129.2795 48.0327 C126.8047 50.4291 123.7897 53.3478 121.0476 55.9568 C118.3055 58.5658 115.6343 60.9601 112.8271 63.6865 C110.0199 66.4129 107.0243 69.1817 104.2046 72.3152 C101.3849 75.4486 98.4589 79.0807 95.909 82.4872 C93.359 85.8936 91.1132 89.2511 88.9051 92.7539 C86.697 96.2568 84.5711 99.8092 82.6602 103.5044 C80.7493 107.1997 79.0993 111.0726 77.4397 114.9255 C75.7801 118.7785 73.8558 122.6562 72.7026 126.6219 C71.5495 130.5876 71.0805 135.0311 70.5209 138.7198 C69.9613 142.4086 69.2884 145.7495 69.3452 148.7544 C69.4021 151.7594 70.1783 154.6752 70.862 156.7494 C71.5457 158.8237 72.3351 159.9959 73.4474 161.1999 C74.5598 162.4038 75.7142 163.1562 77.5361 163.9729 C79.358 164.7895 81.7789 165.4147 84.3789 166.0997 C86.9788 166.7846 89.9833 167.8496 93.1359 168.0827 C96.2886 168.3158 100.0761 168.063 103.2947 167.4983 C106.5132 166.9335 109.8291 165.8258 112.4471 164.694 C115.0652 163.5621 117.3779 161.9206 119.003 160.7071 C120.6281 159.4936 121.2695 158.7132 122.1975 157.413 C123.1254 156.1128 123.8673 154.6954 124.5706 152.9059 C125.2739 151.1164 126.0801 148.9564 126.4174 146.676 C126.7546 144.3956 126.9884 141.978 126.5941 139.2235 C126.1998 136.4689 125.0276 133.3334 124.0513 130.1485 C123.075 126.9636 121.7823 123.0894 120.7363 120.1141 C119.6903 117.1388 119.2163 115.3763 117.7752 112.2968 C116.3341 109.2172 114.5208 105.4635 112.0899 101.6368 C109.659 97.8101 105.7493 93.1015 103.19 89.3366 C100.6306 85.5716 98.912 82.5333 96.7338 79.0471 C94.5556 75.5609 92.4323 71.8093 90.1208 68.4193 C87.8093 65.0293 85.2196 61.788 82.8647 58.7073 C80.5098 55.6267 78.1007 52.7691 75.9916 49.9356 C73.8825 47.1021 71.8825 44.3585 70.2103 41.7065 C68.5381 39.0546 67.0636 36.5303 65.9584 34.0238 C64.8532 31.5172 63.9183 28.6912 63.5791 26.6674 C63.2399 24.6437 63.4194 22.9491 63.9233 21.8813 C64.4272 20.8135 64.8294 20.4069 66.6027 20.2605 Z";
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
    .mark path { fill:none; stroke:currentColor; stroke-width:10; stroke-linecap:round; stroke-linejoin:round; }
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
