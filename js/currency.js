/* ============================================================
   MODULE: js/currency.js
   Operating currency + live FX. Nothing here is hardcoded to AED.
   Admin picks the code (economyConfig/currency). The app and desk
   convert every displayed amount in real time against a USD book.

   Inventory is the full ISO 4217 current list, including UGX.
   ============================================================ */
(function (root) {
  const POPULAR = ['AED', 'USD', 'UGX', 'EUR', 'GBP', 'KES', 'TZS', 'RWF', 'NGN', 'INR', 'SAR', 'QAR', 'EGP', 'ZAR', 'CAD', 'AUD', 'CHF', 'JPY', 'CNY'];
  /* [code, name, minorDigits, symbol] — digits default 2 if omitted. */
  const ROWS = [
    ['AED', 'United Arab Emirates dirham', 2, 'د.إ'],
    ['AFN', 'Afghan afghani', 2, '؋'],
    ['ALL', 'Albanian lek', 2, 'L'],
    ['AMD', 'Armenian dram', 2, '֏'],
    ['ANG', 'Netherlands Antillean guilder', 2, 'ƒ'],
    ['AOA', 'Angolan kwanza', 2, 'Kz'],
    ['ARS', 'Argentine peso', 2, '$'],
    ['AUD', 'Australian dollar', 2, 'A$'],
    ['AWG', 'Aruban florin', 2, 'ƒ'],
    ['AZN', 'Azerbaijani manat', 2, '₼'],
    ['BAM', 'Bosnia-Herzegovina convertible mark', 2, 'KM'],
    ['BBD', 'Barbadian dollar', 2, 'Bds$'],
    ['BDT', 'Bangladeshi taka', 2, '৳'],
    ['BGN', 'Bulgarian lev', 2, 'лв'],
    ['BHD', 'Bahraini dinar', 3, 'BD'],
    ['BIF', 'Burundian franc', 0, 'FBu'],
    ['BMD', 'Bermudian dollar', 2, '$'],
    ['BND', 'Brunei dollar', 2, 'B$'],
    ['BOB', 'Bolivian boliviano', 2, 'Bs'],
    ['BRL', 'Brazilian real', 2, 'R$'],
    ['BSD', 'Bahamian dollar', 2, '$'],
    ['BTN', 'Bhutanese ngultrum', 2, 'Nu'],
    ['BWP', 'Botswana pula', 2, 'P'],
    ['BYN', 'Belarusian ruble', 2, 'Br'],
    ['BZD', 'Belize dollar', 2, 'BZ$'],
    ['CAD', 'Canadian dollar', 2, 'C$'],
    ['CDF', 'Congolese franc', 2, 'FC'],
    ['CHF', 'Swiss franc', 2, 'CHF'],
    ['CLP', 'Chilean peso', 0, '$'],
    ['CNY', 'Chinese yuan', 2, '¥'],
    ['COP', 'Colombian peso', 2, '$'],
    ['CRC', 'Costa Rican colón', 2, '₡'],
    ['CUP', 'Cuban peso', 2, '$'],
    ['CVE', 'Cape Verdean escudo', 2, '$'],
    ['CZK', 'Czech koruna', 2, 'Kč'],
    ['DJF', 'Djiboutian franc', 0, 'Fdj'],
    ['DKK', 'Danish krone', 2, 'kr'],
    ['DOP', 'Dominican peso', 2, 'RD$'],
    ['DZD', 'Algerian dinar', 2, 'DA'],
    ['EGP', 'Egyptian pound', 2, 'E£'],
    ['ERN', 'Eritrean nakfa', 2, 'Nfk'],
    ['ETB', 'Ethiopian birr', 2, 'Br'],
    ['EUR', 'Euro', 2, '€'],
    ['FJD', 'Fijian dollar', 2, 'FJ$'],
    ['FKP', 'Falkland Islands pound', 2, '£'],
    ['GBP', 'Pound sterling', 2, '£'],
    ['GEL', 'Georgian lari', 2, '₾'],
    ['GHS', 'Ghanaian cedi', 2, 'GH₵'],
    ['GIP', 'Gibraltar pound', 2, '£'],
    ['GMD', 'Gambian dalasi', 2, 'D'],
    ['GNF', 'Guinean franc', 0, 'FG'],
    ['GTQ', 'Guatemalan quetzal', 2, 'Q'],
    ['GYD', 'Guyanese dollar', 2, '$'],
    ['HKD', 'Hong Kong dollar', 2, 'HK$'],
    ['HNL', 'Honduran lempira', 2, 'L'],
    ['HTG', 'Haitian gourde', 2, 'G'],
    ['HUF', 'Hungarian forint', 2, 'Ft'],
    ['IDR', 'Indonesian rupiah', 2, 'Rp'],
    ['ILS', 'Israeli new shekel', 2, '₪'],
    ['INR', 'Indian rupee', 2, '₹'],
    ['IQD', 'Iraqi dinar', 3, 'ع.د'],
    ['IRR', 'Iranian rial', 2, '﷼'],
    ['ISK', 'Icelandic króna', 0, 'kr'],
    ['JMD', 'Jamaican dollar', 2, 'J$'],
    ['JOD', 'Jordanian dinar', 3, 'JD'],
    ['JPY', 'Japanese yen', 0, '¥'],
    ['KES', 'Kenyan shilling', 2, 'KSh'],
    ['KGS', 'Kyrgyzstani som', 2, 'сом'],
    ['KHR', 'Cambodian riel', 2, '៛'],
    ['KMF', 'Comorian franc', 0, 'CF'],
    ['KPW', 'North Korean won', 2, '₩'],
    ['KRW', 'South Korean won', 0, '₩'],
    ['KWD', 'Kuwaiti dinar', 3, 'KD'],
    ['KYD', 'Cayman Islands dollar', 2, '$'],
    ['KZT', 'Kazakhstani tenge', 2, '₸'],
    ['LAK', 'Lao kip', 2, '₭'],
    ['LBP', 'Lebanese pound', 2, 'ل.ل'],
    ['LKR', 'Sri Lankan rupee', 2, 'Rs'],
    ['LRD', 'Liberian dollar', 2, '$'],
    ['LSL', 'Lesotho loti', 2, 'L'],
    ['LYD', 'Libyan dinar', 3, 'LD'],
    ['MAD', 'Moroccan dirham', 2, 'MAD'],
    ['MDL', 'Moldovan leu', 2, 'L'],
    ['MGA', 'Malagasy ariary', 2, 'Ar'],
    ['MKD', 'Macedonian denar', 2, 'ден'],
    ['MMK', 'Myanmar kyat', 2, 'K'],
    ['MNT', 'Mongolian tögrög', 2, '₮'],
    ['MOP', 'Macanese pataca', 2, 'MOP$'],
    ['MRU', 'Mauritanian ouguiya', 2, 'UM'],
    ['MUR', 'Mauritian rupee', 2, '₨'],
    ['MVR', 'Maldivian rufiyaa', 2, 'Rf'],
    ['MWK', 'Malawian kwacha', 2, 'MK'],
    ['MXN', 'Mexican peso', 2, 'MX$'],
    ['MYR', 'Malaysian ringgit', 2, 'RM'],
    ['MZN', 'Mozambican metical', 2, 'MT'],
    ['NAD', 'Namibian dollar', 2, 'N$'],
    ['NGN', 'Nigerian naira', 2, '₦'],
    ['NIO', 'Nicaraguan córdoba', 2, 'C$'],
    ['NOK', 'Norwegian krone', 2, 'kr'],
    ['NPR', 'Nepalese rupee', 2, 'Rs'],
    ['NZD', 'New Zealand dollar', 2, 'NZ$'],
    ['OMR', 'Omani rial', 3, '﷼'],
    ['PAB', 'Panamanian balboa', 2, 'B/.'],
    ['PEN', 'Peruvian sol', 2, 'S/'],
    ['PGK', 'Papua New Guinean kina', 2, 'K'],
    ['PHP', 'Philippine peso', 2, '₱'],
    ['PKR', 'Pakistani rupee', 2, '₨'],
    ['PLN', 'Polish złoty', 2, 'zł'],
    ['PYG', 'Paraguayan guaraní', 0, '₲'],
    ['QAR', 'Qatari riyal', 2, 'QR'],
    ['RON', 'Romanian leu', 2, 'lei'],
    ['RSD', 'Serbian dinar', 2, 'дин'],
    ['RUB', 'Russian ruble', 2, '₽'],
    ['RWF', 'Rwandan franc', 0, 'FRw'],
    ['SAR', 'Saudi riyal', 2, '﷼'],
    ['SBD', 'Solomon Islands dollar', 2, 'SI$'],
    ['SCR', 'Seychellois rupee', 2, '₨'],
    ['SDG', 'Sudanese pound', 2, 'ج.س'],
    ['SEK', 'Swedish krona', 2, 'kr'],
    ['SGD', 'Singapore dollar', 2, 'S$'],
    ['SHP', 'Saint Helena pound', 2, '£'],
    ['SLE', 'Sierra Leonean leone', 2, 'Le'],
    ['SOS', 'Somali shilling', 2, 'Sh'],
    ['SRD', 'Surinamese dollar', 2, '$'],
    ['SSP', 'South Sudanese pound', 2, '£'],
    ['STN', 'São Tomé and Príncipe dobra', 2, 'Db'],
    ['SYP', 'Syrian pound', 2, '£S'],
    ['SZL', 'Swazi lilangeni', 2, 'L'],
    ['THB', 'Thai baht', 2, '฿'],
    ['TJS', 'Tajikistani somoni', 2, 'SM'],
    ['TMT', 'Turkmenistani manat', 2, 'm'],
    ['TND', 'Tunisian dinar', 3, 'DT'],
    ['TOP', 'Tongan paʻanga', 2, 'T$'],
    ['TRY', 'Turkish lira', 2, '₺'],
    ['TTD', 'Trinidad and Tobago dollar', 2, 'TT$'],
    ['TWD', 'New Taiwan dollar', 2, 'NT$'],
    ['TZS', 'Tanzanian shilling', 2, 'TSh'],
    ['UAH', 'Ukrainian hryvnia', 2, '₴'],
    ['UGX', 'Ugandan shilling', 0, 'USh'],
    ['USD', 'United States dollar', 2, '$'],
    ['UYU', 'Uruguayan peso', 2, '$U'],
    ['UZS', 'Uzbekistani som', 2, 'soʻm'],
    ['VES', 'Venezuelan bolívar soberano', 2, 'Bs'],
    ['VND', 'Vietnamese đồng', 0, '₫'],
    ['VUV', 'Vanuatu vatu', 0, 'Vt'],
    ['WST', 'Samoan tālā', 2, 'T'],
    ['XAF', 'Central African CFA franc', 0, 'FCFA'],
    ['XCD', 'East Caribbean dollar', 2, 'EC$'],
    ['XOF', 'West African CFA franc', 0, 'CFA'],
    ['XPF', 'CFP franc', 0, '₣'],
    ['YER', 'Yemeni rial', 2, '﷼'],
    ['ZAR', 'South African rand', 2, 'R'],
    ['ZMW', 'Zambian kwacha', 2, 'ZK'],
    ['ZWG', 'Zimbabwe gold', 2, 'ZiG'],
  ];

  /* Offline book, USD = 1. Pegs and widely-used rates so conversion still
     works if the live feed is unreachable. Live fetch overwrites these. */
  const FALLBACK_USD = {
    USD: 1, AED: 3.6725, EUR: 0.86, GBP: 0.74, UGX: 3650, KES: 129, TZS: 2500,
    RWF: 1420, NGN: 1480, INR: 83.5, SAR: 3.75, QAR: 3.64, EGP: 48.5, ZAR: 18.2,
    CAD: 1.37, AUD: 1.52, CHF: 0.80, JPY: 149, CNY: 7.12, HKD: 7.78, SGD: 1.29,
    TRY: 41.2, BRL: 5.45, MXN: 19.1, PKR: 278, BDT: 122, IDR: 16200, PHP: 58.2,
    THB: 33.4, VND: 25400, KRW: 1380, TWD: 32.2, PLN: 3.65, CZK: 21.4, SEK: 9.55,
    NOK: 10.1, DKK: 6.42, HUF: 355, RON: 4.38, ILS: 3.32, MAD: 9.15, DZD: 133,
    TND: 2.95, JOD: 0.709, BHD: 0.376, KWD: 0.307, OMR: 0.3845, LBP: 89500,
    IQD: 1310, ETB: 128, GHS: 12.1, XOF: 564, XAF: 564, CDF: 2850, MZN: 63.9,
    AOA: 912, ZMW: 24.5, MWK: 1740, MGA: 4500, MUR: 45.8, SCR: 14.4, LKR: 300,
    NPR: 133.6, MMK: 2100, KHR: 4100, LAK: 21600, MNT: 3390, UZS: 12800,
    KZT: 512, GEL: 2.72, AMD: 387, AZN: 1.70, BYN: 3.28, UAH: 41.4, RUB: 84,
    ARS: 1430, CLP: 940, COP: 4120, PEN: 3.72, UYU: 40.4, BOB: 6.91, PYG: 7900,
    CRC: 505, GTQ: 7.72, HNL: 26.2, NIO: 36.7, PAB: 1, DOP: 60.2, JMD: 157,
    TTD: 6.78, BBD: 2, BSD: 1, BMD: 1, KYD: 0.833, XCD: 2.70, FJD: 2.25,
    PGK: 4.05, WST: 2.75, TOP: 2.38, VUV: 122, NZD: 1.66, ISK: 127, RSD: 101,
    MKD: 53, ALL: 85, BAM: 1.68, BGN: 1.68, HRK: 6.48, MDL: 17.2, GEL: 2.72,
  };

  const BY_CODE = {};
  const LIST = ROWS.map(function (r) {
    const row = { code: r[0], name: r[1], digits: r[2] == null ? 2 : r[2], symbol: r[3] || r[0] };
    BY_CODE[row.code] = row;
    return row;
  });

  const DEFAULT_CODE = 'AED';
  const FX_TTL_MS = 10 * 60 * 1000;
  const CACHE_KEY = 'nalunoCurrency:v1';

  let __code = DEFAULT_CODE;
  let __rates = Object.assign({ USD: 1 }, FALLBACK_USD);
  let __fetchedAt = 0;
  let __source = 'fallback';
  let __unsub = null;
  let __timer = null;
  let __fetching = false;

  function norm(code) {
    const c = String(code || '').trim().toUpperCase();
    return BY_CODE[c] ? c : '';
  }
  function find(code) {
    return BY_CODE[norm(code) || __code] || BY_CODE[DEFAULT_CODE];
  }
  function digits(code) {
    const row = find(code);
    return row ? row.digits : 2;
  }
  function nameOf(code) {
    const row = find(code);
    return row ? row.name : String(code || '');
  }
  function symbolOf(code) {
    const row = find(code);
    return row ? row.symbol : String(code || '');
  }
  function code() { return __code; }
  function rates() { return __rates; }
  function fetchedAt() { return __fetchedAt; }
  function source() { return __source; }

  function rateOf(code) {
    const c = norm(code) || 'USD';
    if (c === 'USD') return 1;
    const n = Number(__rates[c]);
    if (isFinite(n) && n > 0) return n;
    const fb = Number(FALLBACK_USD[c]);
    return (isFinite(fb) && fb > 0) ? fb : 0;
  }

  function convert(amount, from, to) {
    const n = Number(amount);
    if (!isFinite(n)) return 0;
    const a = norm(from) || 'USD';
    const b = norm(to) || __code;
    if (a === b) return n;
    const ra = rateOf(a);
    const rb = rateOf(b);
    if (!(ra > 0) || !(rb > 0)) return n;
    return n * (rb / ra);
  }

  function toMinor(major, ccy) {
    const d = digits(ccy);
    const n = Number(major);
    if (!isFinite(n)) return 0;
    return Math.round(n * Math.pow(10, d));
  }
  function fromMinor(minor, ccy) {
    const d = digits(ccy);
    const n = Number(minor);
    if (!isFinite(n)) return 0;
    return n / Math.pow(10, d);
  }
  function convertMinor(minor, from, to) {
    const major = fromMinor(minor, from);
    return toMinor(convert(major, from, to), to);
  }

  function prettyMajor(major, ccy) {
    const d = digits(ccy);
    let n = Number(major);
    if (!isFinite(n)) return 0;
    const abs = Math.abs(n);
    if (d === 0) {
      if (abs >= 100000) n = Math.round(n / 1000) * 1000;
      else if (abs >= 10000) n = Math.round(n / 100) * 100;
      else if (abs >= 1000) n = Math.round(n / 50) * 50;
      else n = Math.round(n);
      return n;
    }
    if (d === 3) {
      if (abs >= 10) return Math.round(n * 100) / 100;
      return Math.round(n * 1000) / 1000;
    }
    if (abs >= 1000) return Math.round(n);
    if (abs >= 100) return Math.round(n * 10) / 10;
    return Math.round(n * 100) / 100;
  }

  function formatMajor(major, ccy, opts) {
    opts = opts || {};
    const row = find(ccy);
    const code = row.code;
    const d = row.digits;
    const n = Number(major);
    if (!isFinite(n)) return '—';
    let maxD = d;
    let minD = d;
    if (d > 0 && Math.abs(n) > 0 && Math.abs(n) < 0.01 && !opts.fixed) {
      maxD = Math.min(4, d + 2);
      minD = Math.min(2, d);
    }
    if (d === 0) { minD = 0; maxD = 0; }
    let body = n.toLocaleString('en-GB', {
      minimumFractionDigits: minD,
      maximumFractionDigits: maxD,
    });
    if (!opts.fixed && Math.abs(n) > 0 && Math.abs(n) < Math.pow(10, -d) / 2) {
      body = '< ' + (1 / Math.pow(10, d)).toLocaleString('en-GB', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });
    }
    if (opts.compact) return body + ' ' + code;
    return code + ' ' + body;
  }

  function formatFrom(major, fromCode, opts) {
    const to = (opts && opts.to) || __code;
    return formatMajor(convert(major, fromCode || 'AED', to), to, opts);
  }
  function formatMinor(minor, fromCode, opts) {
    const from = fromCode || 'AED';
    return formatFrom(fromMinor(minor, from), from, opts);
  }
  function pairFrom(major, fromCode) {
    const a = Number(major);
    const usd = convert(a, fromCode || 'AED', 'USD');
    const op = convert(a, fromCode || 'AED', __code);
    if (__code === 'USD') return formatMajor(usd, 'USD');
    return formatMajor(op, __code) + ' · ' + formatMajor(usd, 'USD');
  }

  function emit() {
    try {
      if (typeof document !== 'undefined') {
        document.dispatchEvent(new CustomEvent('naluno-currency', {
          detail: { code: __code, rates: __rates, fetchedAt: __fetchedAt, source: __source },
        }));
      }
    } catch (_) {}
  }

  function persistCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        code: __code, rates: __rates, fetchedAt: __fetchedAt, source: __source,
      }));
    } catch (_) {}
  }
  function loadCached() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!raw) return;
      if (raw.code && BY_CODE[raw.code]) __code = raw.code;
      if (raw.rates && typeof raw.rates === 'object') {
        Object.keys(raw.rates).forEach(function (k) {
          const n = Number(raw.rates[k]);
          if (isFinite(n) && n > 0) __rates[k.toUpperCase()] = n;
        });
      }
      if (raw.fetchedAt) __fetchedAt = Number(raw.fetchedAt) || 0;
      if (raw.source) __source = String(raw.source);
    } catch (_) {}
  }

  function setCode(next, opts) {
    const c = norm(next);
    if (!c) return __code;
    const prev = __code;
    __code = c;
    persistCache();
    if (prev !== __code || (opts && opts.force)) emit();
    return __code;
  }

  function applyRates(map, meta) {
    if (!map || typeof map !== 'object') return __rates;
    let n = 0;
    Object.keys(map).forEach(function (k) {
      const code = String(k || '').toUpperCase();
      const v = Number(map[k]);
      if (!BY_CODE[code] && code !== 'USD') return;
      if (!isFinite(v) || v <= 0) return;
      __rates[code] = v;
      n += 1;
    });
    __rates.USD = 1;
    if (n) {
      __fetchedAt = (meta && meta.fetchedAt) || Date.now();
      __source = (meta && meta.source) || 'live';
      persistCache();
      emit();
    }
    return __rates;
  }

  function parseOpenEr(body) {
    if (!body || body.result !== 'success' || !body.rates) return null;
    return body.rates;
  }
  function parseFawaz(body) {
    const bag = body && (body.usd || body.USD);
    if (!bag || typeof bag !== 'object') return null;
    const out = {};
    Object.keys(bag).forEach(function (k) {
      out[String(k).toUpperCase()] = bag[k];
    });
    return out;
  }

  function fetchLive(force) {
    if (__fetching) return Promise.resolve(__rates);
    if (!force && __fetchedAt && (Date.now() - __fetchedAt < FX_TTL_MS) && __source === 'live') {
      return Promise.resolve(__rates);
    }
    __fetching = true;
    const urls = [
      { href: 'https://open.er-api.com/v6/latest/USD', parse: parseOpenEr },
      { href: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json', parse: parseFawaz },
    ];
    function tryAt(i) {
      if (typeof fetch !== 'function' || i >= urls.length) {
        __fetching = false;
        return Promise.resolve(__rates);
      }
      return fetch(urls[i].href, { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('fx ' + res.status);
        return res.json();
      }).then(function (body) {
        const map = urls[i].parse(body);
        if (!map) throw new Error('fx parse');
        applyRates(map, { source: 'live', fetchedAt: Date.now() });
        __fetching = false;
        return __rates;
      }).catch(function () {
        return tryAt(i + 1);
      });
    }
    return tryAt(0);
  }

  function list(opts) {
    opts = opts || {};
    const rows = LIST.slice();
    if (opts.popularFirst) {
      rows.sort(function (a, b) {
        const ap = POPULAR.indexOf(a.code);
        const bp = POPULAR.indexOf(b.code);
        const aP = ap < 0 ? 999 : ap;
        const bP = bp < 0 ? 999 : bp;
        if (aP !== bP) return aP - bP;
        return a.name.localeCompare(b.name);
      });
    }
    return rows;
  }

  function selectHtml(id, selected) {
    const cur = norm(selected) || __code;
    const popular = {};
    POPULAR.forEach(function (c) { popular[c] = true; });
    function opt(row) {
      return '<option value="' + row.code + '"' + (row.code === cur ? ' selected' : '') + '>'
        + row.code + ' — ' + row.name + '</option>';
    }
    const pop = LIST.filter(function (r) { return popular[r.code]; })
      .sort(function (a, b) { return POPULAR.indexOf(a.code) - POPULAR.indexOf(b.code); });
    const rest = LIST.filter(function (r) { return !popular[r.code]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    return '<select id="' + id + '">'
      + '<optgroup label="Often used">' + pop.map(opt).join('') + '</optgroup>'
      + '<optgroup label="All currencies">' + rest.map(opt).join('') + '</optgroup>'
      + '</select>';
  }

  function quoteLine() {
    const usd = rateOf(__code);
    const aed = convert(1, 'AED', __code);
    const when = __fetchedAt
      ? new Date(__fetchedAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
      : 'offline book';
    const bits = [];
    bits.push('1 USD = ' + formatMajor(usd, __code));
    if (__code !== 'AED') bits.push('1 AED = ' + formatMajor(aed, __code));
    if (__code !== 'UGX') bits.push('1 UGX = ' + formatMajor(convert(1, 'UGX', __code), __code));
    bits.push((__source === 'live' ? 'live' : 'stored') + ' · ' + when);
    return bits.join(' · ');
  }

  /* Support presets were designed as AED 5 / 10 / 25. Convert those
     dirham amounts into the operating currency so the sheet stays fair. */
  const SUPPORT_AED_MAJOR = [5, 10, 25];
  function supportPresets() {
    return SUPPORT_AED_MAJOR.map(function (aed) {
      const major = prettyMajor(convert(aed, 'AED', __code), __code);
      return {
        aed: aed,
        major: major,
        minor: toMinor(major, __code),
        currency: __code,
        label: formatMajor(major, __code),
      };
    });
  }

  function dbOf(passed) {
    if (passed) return passed;
    try {
      if (typeof fbDb !== 'undefined' && fbDb) return fbDb;
    } catch (_) {}
    try {
      if (typeof firebase !== 'undefined' && firebase.firestore) return firebase.firestore();
    } catch (_) {}
    return null;
  }

  function listen(passedDb) {
    if (__unsub) return;
    const db = dbOf(passedDb);
    if (!db || !db.collection) return;
    try {
      __unsub = db.collection('economyConfig').doc('currency').onSnapshot(function (snap) {
        if (!snap || !snap.exists) return;
        const d = snap.data() || {};
        if (d.code) setCode(d.code);
        if (d.rates) applyRates(d.rates, { source: d.source || 'desk', fetchedAt: d.fetchedAt || Date.now() });
      }, function () { __unsub = null; });
    } catch (_) {}
    try {
      db.collection('economyConfig').doc('fxRates').onSnapshot(function (snap) {
        if (!snap || !snap.exists) return;
        const d = snap.data() || {};
        if (d.rates) applyRates(d.rates, { source: 'live', fetchedAt: d.fetchedAt || Date.now() });
      }, function () {});
    } catch (_) {}
  }

  function saveCode(passedDb, uid, next) {
    const c = setCode(next);
    const db = dbOf(passedDb);
    if (!db) return Promise.resolve(c);
    const doc = {
      code: c,
      name: nameOf(c),
      updatedAt: Date.now(),
      updatedBy: uid || '',
    };
    return db.collection('economyConfig').doc('currency').set(doc, { merge: true })
      .then(function () { return c; })
      .catch(function () { return c; });
  }

  function publishRates(passedDb) {
    const db = dbOf(passedDb);
    if (!db) return Promise.resolve();
    return db.collection('economyConfig').doc('fxRates').set({
      base: 'USD',
      rates: __rates,
      fetchedAt: __fetchedAt || Date.now(),
      source: __source,
    }, { merge: true }).catch(function () {});
  }

  function boot() {
    loadCached();
    fetchLive(false);
    if (__timer) return;
    if (typeof setInterval !== 'function') return;
    __timer = setInterval(function () { fetchLive(false); }, FX_TTL_MS);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } else {
    boot();
  }

  root.NalunoCurrency = {
    LIST: LIST,
    POPULAR: POPULAR,
    DEFAULT_CODE: DEFAULT_CODE,
    FALLBACK_USD: FALLBACK_USD,
    find: find,
    list: list,
    norm: norm,
    digits: digits,
    nameOf: nameOf,
    symbolOf: symbolOf,
    code: code,
    setCode: setCode,
    rates: rates,
    rateOf: rateOf,
    fetchedAt: fetchedAt,
    source: source,
    convert: convert,
    convertMinor: convertMinor,
    toMinor: toMinor,
    fromMinor: fromMinor,
    prettyMajor: prettyMajor,
    formatMajor: formatMajor,
    formatFrom: formatFrom,
    formatMinor: formatMinor,
    pairFrom: pairFrom,
    selectHtml: selectHtml,
    quoteLine: quoteLine,
    supportPresets: supportPresets,
    fetchLive: fetchLive,
    applyRates: applyRates,
    listen: listen,
    saveCode: saveCode,
    publishRates: publishRates,
    attach: listen,
  };
})(typeof window !== 'undefined' ? window : globalThis);
