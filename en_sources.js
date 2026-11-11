/*!
 * EN Sources 3.1.0 — одиночный плагин для Lampa
 * ---------------------------------------------------------------------------
 * Один модуль, один перехват Lampa.Parser.get. Публичные зарубежные трекеры
 * (Nyaa, AniDex, Torrentio, YTS, EZTV, The Pirate Bay) объединяются со
 * штатным парсером Lampa. Зарубежные раздачи выводятся первыми, внутри них —
 * самые популярные (по сидам).
 *
 * Установка: Настройки -> Расширения -> Добавить плагин -> URL этого файла.
 *
 * Что исправлено относительно 2.13.0:
 *   - не два плагина, а один (раньше два модуля одновременно оборачивали
 *     Lampa.Parser.get и «дрались» за порядок результатов);
 *   - тумблеры источников: Storage.get() для отсутствующего ключа возвращает
 *     '' (пустую строку), поэтому все источники по умолчанию были выключены.
 *     Теперь '' трактуется как «использовать дефолт»;
 *   - Nyaa для сериалов больше не «показывает один последний эпизод»: раньше
 *     шёл поиск по новизне (s=id&o=desc) на 3 страницах, и в топ попадали
 *     только свежие загрузки финальных эпизодов. Теперь поиск идёт по
 *     популярности (s=seeders&o=desc) + добавляются запросы сезона/пака;
 *   - Nyaa HTML-парсер: название бралось из первой ссылки на /view/ID,
 *     которой часто оказывалась ссылка комментария «21 comments». Теперь
 *     берётся ссылка /view/ID без #comments;
 *   - не используем CORS-прокси: у вас своё средство обхода блокировок.
 *     Все запросы прямые, с браузерным User-Agent (для Cloudflare);
 *   - убрана привязка к «en_sources_v2_enabled» (два рубильника путали);
 *   - для YTS/EZTV/Torrentio IMDb ID при необходимости запрашивается из
 *     TMDB external_ids (у карточки Lampa его часто нет).
 *
 * Встроенных API-ключей нет. Используйте только те источники и раздачи, на
 * которые у вас есть права.
 */
(function (window, document) {
    'use strict';

    var VERSION = '3.1.0';
    var NS = '__en_sources_v3__';
    var COMPONENT = 'en_sources3';
    var PREFIX = 'en_sources_v3_';
    var MAX_RESULTS = 300;

    var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

    var ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18' +
        'M12 3a15 15 0 0 0 0 18"/><path d="m9.8 9.7 4.7 2.3-4.7 2.3z" fill="currentColor" ' +
        'stroke="none"/></svg>';

    if (window[NS] && window[NS].version === VERSION) return;
    if (window[NS] && typeof window[NS].destroy === 'function') {
        try { window[NS].destroy(); } catch (e) {}
    }

    var api = { version: VERSION, status: 'loading' };
    window[NS] = api;

    var K = {
        enabled: PREFIX + 'enabled',
        merge: PREFIX + 'merge',
        fallback: PREFIX + 'fallback',
        prefer_en: PREFIX + 'prefer_en',
        hide_ru: PREFIX + 'hide_ru',
        timeout: PREFIX + 'timeout'
    };

    var SOURCES = [
        { id: 'nyaa', title: 'Nyaa.si', def: true },
        { id: 'anidex', title: 'AniDex', def: true },
        { id: 'torrentio', title: 'Torrentio', def: true },
        { id: 'yts', title: 'YTS', def: true },
        { id: 'eztv', title: 'EZTV', def: true },
        { id: 'tpb', title: 'The Pirate Bay', def: false }
    ];

    var YTS_HOSTS = ['yts.mx', 'yts.rs', 'yts.ag', 'yts.lt'];
    var EZTV_HOSTS = ['eztvx.to', 'eztv.re', 'eztv.ch'];

    var RU_AUDIO_RE = /(rus|russian|русск|рус\.)[^\n]{0,45}(dub|dubbed|dubbing|audio|mvo|\bvo\b|озвуч|дубл|закадр)|(dub|dubbed|dubbing|audio|mvo|\bvo\b|озвуч|дубл|закадр)[^\n]{0,45}(rus|russian|русск|рус\.)/i;
    var DUB_RE = /\b(dub|dubbed|dual[ .-]?audio|english[ .-]?dub|eng[ .-]?dub)\b/i;
    var EN_SUB_RE = /\b(eng(lish)?[\s._-]?sub|multi[\s._-]?sub|subs?|subsplease|erai-raws|horriblesubs)\b|\[multi|\beng\b/i;
    var CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/;

    var cfg = {};
    var state = {
        destroyed: false,
        started: false,
        hooked: false,
        sortWrapped: false,
        settings: false,
        bootTimer: null,
        hookTimer: null,
        originalGet: null,
        originalClear: null,
        originalTorrents: null,
        listeners: [],
        searches: {},
        seq: 0,
        clearTime: 0,
        last: null,
        lastByCard: {}
    };

    var resolveCache = {};
    var imdbCache = {};
    var $ = window.jQuery || window.$;

    /* ------------------------------------------------------------------ */
    /* Утилиты                                                             */
    /* ------------------------------------------------------------------ */

    function log() {
        try {
            if (window.console && console.log) {
                var args = ['[EN Sources ' + VERSION + ']'];
                for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
                console.log.apply(console, args);
            }
        } catch (e) {}
    }

    function warn() {
        try {
            if (window.console && console.warn) {
                var args = ['[EN Sources ' + VERSION + ']'];
                for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
                console.warn.apply(console, args);
            }
        } catch (e) {}
    }

    function clean(value) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function bool(key, def) {
        var v;
        try { v = Lampa.Storage.get(key, def); } catch (e) { return def; }
        if (v === true || v === 'true' || v === 1 || v === '1') return true;
        if (v === false || v === 'false' || v === 0 || v === '0') return false;
        return def;
    }

    function str(key, def) {
        var v;
        try { v = Lampa.Storage.get(key, def); } catch (e) { return def; }
        return v == null || v === '' ? def : String(v);
    }

    function int(value, def) {
        var n = parseInt(value, 10);
        return isNaN(n) ? def : n;
    }

    function truthy(v) {
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function srcOn(id) {
        var def = false;
        for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) def = SOURCES[i].def;
        var v;
        try { v = Lampa.Storage.get(PREFIX + 'src_' + id); } catch (e) { return def; }
        // Storage.get() для отсутствующего ключа возвращает '' — это и есть
        // причина, по которой все источники раньше были «выключены».
        if (v === undefined || v === null || v === '') return def;
        return truthy(v);
    }

    function readConfig() {
        cfg.enabled = bool(K.enabled, true);
        cfg.merge = bool(K.merge, true);
        cfg.fallback = bool(K.fallback, true);
        cfg.prefer_en = bool(K.prefer_en, true);
        cfg.hide_ru = bool(K.hide_ru, false);
        cfg.timeout = int(str(K.timeout, '20'), 20);
        if (cfg.timeout < 8) cfg.timeout = 8;
        if (cfg.timeout > 60) cfg.timeout = 60;
    }

    function notify(text) {
        try { if (Lampa.Noty) Lampa.Noty.show(text, { time: 4500 }); } catch (e) {}
    }

    function coreVersion() {
        try {
            if (Lampa.Manifest && Lampa.Manifest.app_version) return String(Lampa.Manifest.app_version);
            if (Lampa.Manifest && Lampa.Manifest.app_digital) return String(Lampa.Manifest.app_digital);
        } catch (e) {}
        return 'не определена';
    }

    function isAndroid() {
        try {
            if (window.AndroidJS && Lampa.Platform && Lampa.Platform.is) {
                return !!Lampa.Platform.is('android');
            }
        } catch (e) {}
        return false;
    }

    function normalizeImdb(raw) {
        var s = clean(raw).toLowerCase();
        if (!s) return '';
        if (/^tt\d{7,10}$/.test(s)) return s;
        if (/^\d{1,10}$/.test(s)) {
            while (s.length < 7) s = '0' + s;
            return 'tt' + s;
        }
        return '';
    }

    function parseSize(value) {
        if (typeof value === 'number' && isFinite(value)) return Math.max(0, Math.round(value));
        var s = clean(value).replace(',', '.');
        if (!s) return 0;
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        var m = s.match(/([\d.]+)\s*(K|M|G|T|К|М|Г|Т)?i?[BБ]/i);
        if (!m) return 0;
        var n = parseFloat(m[1]);
        if (isNaN(n)) return 0;
        var u = (m[2] || '').toLowerCase();
        var mult = 1;
        if (u === 'k' || u === 'к') mult = 1024;
        else if (u === 'm' || u === 'м') mult = 1048576;
        else if (u === 'g' || u === 'г') mult = 1073741824;
        else if (u === 't' || u === 'т') mult = 1099511627776;
        return Math.round(n * mult);
    }

    function bytesText(bytes) {
        if (!bytes) return '';
        try {
            if (Lampa.Utils && Lampa.Utils.bytesToSize) return Lampa.Utils.bytesToSize(bytes);
        } catch (e) {}
        var units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        i = Math.max(0, Math.min(units.length - 1, i));
        return (bytes / Math.pow(1024, i)).toFixed(i ? 2 : 0) + ' ' + units[i];
    }

    function parseTime(value) {
        if (typeof value === 'number' && isFinite(value)) {
            return value < 1e12 ? value * 1000 : value;
        }
        var s = clean(value);
        if (!s) return Date.now();
        if (/^\d+$/.test(s)) {
            var n = parseInt(s, 10);
            return n < 1e12 ? n * 1000 : n;
        }
        var t = Date.parse(s.replace(/\s-0000$/, ' GMT'));
        if (!isNaN(t)) return t;
        var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6] || 0);
        var t2 = Date.parse(s);
        return isNaN(t2) ? Date.now() : t2;
    }

    function viewed(hash) {
        try {
            var list = Lampa.Storage.cache('torrents_view', 5000, []);
            return !!(list && list.indexOf && list.indexOf(hash) >= 0);
        } catch (e) { return false; }
    }

    function magnetFor(hash, title) {
        var trackers = [
            'http://nyaa.tracker.wf:7777/announce',
            'udp://open.stealth.si:80/announce',
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://exodus.desync.com:6969/announce',
            'udp://tracker.torrent.eu.org:451/announce'
        ];
        var url = 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(title || '');
        for (var i = 0; i < trackers.length; i++) url += '&tr=' + encodeURIComponent(trackers[i]);
        return url;
    }

    function decodeXml(value) {
        return String(value == null ? '' : value)
            .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
            .replace(/&#x([0-9a-f]+);/gi, function (m, hex) {
                try { return String.fromCharCode(parseInt(hex, 16)); } catch (e) { return m; }
            })
            .replace(/&#(\d+);/g, function (m, num) {
                try { return String.fromCharCode(parseInt(num, 10)); } catch (e) { return m; }
            });
    }

    function isCloudflare(text) {
        return /just a moment|cf-browser-verification|enable javascript and cookies|attention required/i
            .test(String(text || '').slice(0, 3000));
    }

    function looksJson(text) {
        var s = String(text || '').replace(/^\uFEFF/, '').replace(/^\s+/, '');
        return s.charAt(0) === '{' || s.charAt(0) === '[';
    }

    function looksNyaaRss(text) {
        return /<rss[\s>]|<item[\s>]/i.test(String(text || ''));
    }

    function looksNyaaHtml(text) {
        var s = String(text || '');
        return /torrent-list/i.test(s) || /magnet:\?xt=urn:btih:/i.test(s);
    }

    function isRuAudio(t) {
        return RU_AUDIO_RE.test(String(t || ''));
    }

    function audioState(t) {
        t = String(t || '');
        if (isRuAudio(t)) return false;
        if (DUB_RE.test(t) || EN_SUB_RE.test(t)) return true;
        return null;
    }

    function isAnimeCard(object) {
        if (!object) return false;
        if (object.search_two) return true;
        var movie = object.movie || {};
        var genres = movie.genres || [];
        var animation = false;
        for (var i = 0; i < genres.length; i++) {
            var g = genres[i];
            if ((g && typeof g === 'object' && g.id == 16) || g == 16) animation = true;
        }
        var lang = String(movie.original_language || '').toLowerCase();
        if (animation && (lang === 'ja' || lang === 'zh')) return true;
        if (CJK_RE.test(movie.original_name) || CJK_RE.test(movie.original_title)) return true;
        if (CJK_RE.test(object.search)) return true;
        return false;
    }

    function queryFor(object) {
        object = object || {};
        var movie = object.movie || {};
        var q = object.search_two || movie.original_title || movie.original_name ||
            movie.title || movie.name || object.search || '';
        if (!q && object.query) {
            try { q = decodeURIComponent(object.query); } catch (e) { q = object.query; }
        }
        return cleanQuery(q);
    }

    function cleanQuery(value) {
        var s = clean(value);
        s = s.replace(/\s+\((?:TV|Movie|OVA|ONA|Special)\)\s*$/i, '');
        s = s.replace(/\s+\((?:19|20)\d{2}\)\s*$/, '');
        s = s.replace(/\s+\[(?:19|20)\d{2}\]\s*$/, '');
        s = s.replace(/^[\-–—:;,. ]+|[\-–—:;,. ]+$/g, '');
        return clean(s);
    }

    function pushQuery(list, value) {
        var q = cleanQuery(value);
        if (!q || q.length < 2) return;
        var key = q.toLowerCase();
        for (var i = 0; i < list.length; i++) {
            if (list[i].toLowerCase() === key) return;
        }
        list.push(q);
    }

    function queryScore(q) {
        if (CJK_RE.test(q)) return 1;
        if (/[А-Яа-яЁё]/.test(q)) return 2;
        return 0;
    }

    function baseQueries(object) {
        object = object || {};
        var movie = object.movie || {};
        var out = [];
        pushQuery(out, object.search_two);
        pushQuery(out, movie.original_title);
        pushQuery(out, movie.original_name);
        pushQuery(out, movie.title);
        pushQuery(out, movie.name);
        pushQuery(out, object.search);
        return out;
    }

    function cardKey(object) {
        var movie = (object && object.movie) || {};
        return String(movie.id || '') + ':' +
            (movie.number_of_seasons || movie.original_name || movie.name ? 'tv' : 'movie');
    }

    /* ------------------------------------------------------------------ */
    /* HTTP (прямые запросы, без прокси)                                   */
    /* ------------------------------------------------------------------ */

    function requestText(url, callback, bag, validator) {
        var net;
        try { net = new Lampa.Reguest(); } catch (e) { callback('Reguest недоступен'); return; }
        try { net.timeout(cfg.timeout * 1000); } catch (e) {}

        var params = {
            dataType: 'text',
            headers: { 'Accept': 'text/xml,application/xml,text/html,*/*' }
        };
        if (isAndroid()) {
            params.headers['User-Agent'] = UA;
            params.headers['Accept-Language'] = 'en-US,en;q=0.9,ru;q=0.8';
        }

        var settled = false;
        function ok(text) {
            if (settled) return;
            settled = true;
            if (isCloudflare(text) || (validator && !validator(text))) {
                callback('Cloudflare / неожиданный ответ');
                return;
            }
            callback(null, text);
        }
        function fail(a, b) {
            if (settled) return;
            settled = true;
            var msg = 'сеть';
            try { msg = net.errorDecode(a, b) || msg; } catch (e) {}
            callback(msg);
        }

        try {
            net.native(url, ok, fail, false, params);
        } catch (e) {
            fail({ message: e && e.message ? e.message : 'request error' }, '');
            return;
        }
        if (bag) bag.push(net);
    }

    function requestJson(url, callback, bag) {
        requestText(url, function (err, text) {
            if (err) { callback(err); return; }
            try {
                callback(null, JSON.parse(String(text || '').replace(/^\uFEFF/, '')));
            } catch (e) {
                callback('JSON: ' + (e && e.message ? e.message : 'parse error'));
            }
        }, bag, looksJson);
    }

    function postJson(url, body, callback) {
        var net;
        try { net = new Lampa.Reguest(); } catch (e) { callback('Reguest недоступен'); return; }
        try { net.timeout(12000); } catch (e) {}

        var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (isAndroid()) headers['User-Agent'] = UA;

        var settled = false;
        function ok(j) {
            if (settled) return;
            settled = true;
            callback(null, j);
        }
        function fail(a, b) {
            if (settled) return;
            settled = true;
            var msg = 'сеть';
            try { msg = net.errorDecode(a, b) || msg; } catch (e) {}
            callback(msg);
        }

        try {
            net.native(url, ok, fail, body, { dataType: 'json', headers: headers });
        } catch (e) {
            fail({ message: e && e.message ? e.message : 'request error' }, '');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Названия аниме: Shikimori -> AniList                                */
    /* ------------------------------------------------------------------ */

    function shikimoriTitles(query, callback) {
        requestJson('https://shikimori.io/api/animes?search=' +
            encodeURIComponent(query) + '&limit=5', function (err, json) {
            var out = [];
            if (err || !json || Object.prototype.toString.call(json) !== '[object Array]') {
                callback(out);
                return;
            }
            for (var i = 0; i < json.length; i++) {
                var a = json[i] || {};
                if (a.name) out.push(a.name);
                if (a.english) out.push(a.english);
            }
            callback(out);
        });
    }

    function anilistTitles(query, callback) {
        var body = JSON.stringify({
            query: 'query($s:String){Page(perPage:3){media(search:$s,type:ANIME){' +
                'title{romaji english} synonyms}}}',
            variables: { s: query }
        });
        postJson('https://graphql.anilist.co', body, function (err, json) {
            var out = [];
            if (err || !json) { callback(out); return; }
            try {
                var media = json.data.Page.media || [];
                for (var i = 0; i < media.length; i++) {
                    var t = media[i].title || {};
                    if (t.romaji) out.push(t.romaji);
                    if (t.english) out.push(t.english);
                    var syn = media[i].synonyms || [];
                    for (var k = 0; k < syn.length; k++) out.push(syn[k]);
                }
            } catch (e) {}
            callback(out);
        });
    }

    function resolveTitles(base, callback) {
        if (!base.length) { callback([]); return; }
        var key = base.join('|').toLowerCase();
        var cached = resolveCache[key];
        if (cached && Date.now() - cached.time < (cached.titles.length ? 3600000 : 300000)) {
            callback(cached.titles);
            return;
        }

        var finished = false;
        var timer = setTimeout(function () {
            if (finished) return;
            finished = true;
            callback([]);
        }, 8500);

        function finish(titles) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            var out = [];
            for (var i = 0; i < titles.length; i++) pushQuery(out, titles[i]);
            resolveCache[key] = { time: Date.now(), titles: out };
            callback(out);
        }

        shikimoriTitles(base[0], function (titles) {
            if (titles && titles.length) { finish(titles); return; }
            anilistTitles(base[0], function (more) { finish(more || []); });
        });
    }

    function buildQueries(object, callback) {
        var base = baseQueries(object);
        if (!isAnimeCard(object) || !base.length) {
            var list = base.slice().sort(function (a, b) { return queryScore(a) - queryScore(b); });
            callback(list.length ? list : [queryFor(object)]);
            return;
        }

        resolveTitles(base, function (titles) {
            var out = [];
            // Ромадзи/английское из Shikimori/AniList — лучший запрос для
            // Nyaa и AniDex (там раздачи называются ромадзи, а не полным
            // английским названием TMDB).
            for (var i = 0; i < titles.length; i++) pushQuery(out, titles[i]);
            // Затем названия карточки (search_two, original_name, title, ...).
            for (var j = 0; j < base.length; j++) pushQuery(out, base[j]);
            out = out.slice(0, 6).sort(function (a, b) { return queryScore(a) - queryScore(b); });
            callback(out.length ? out : [queryFor(object)]);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Сборка элементов результата                                         */
    /* ------------------------------------------------------------------ */

    function makeItem(o) {
        var hash = String(o.hash || '').toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(hash)) {
            var hm = String(o.magnet || '').match(/btih:([a-fA-F0-9]{40})/i);
            hash = hm ? hm[1].toLowerCase() : '';
        }
        var size = typeof o.size === 'number' ? o.size : parseSize(o.size);
        var date = parseTime(o.date);
        var title = clean(o.title);
        if (!title) title = 'Unknown';
        var magnet = o.magnet || (hash ? magnetFor(hash, title) : '');

        return {
            Title: title,
            Tracker: o.tracker || 'EN',
            Seeders: int(o.seeds, 0),
            Peers: int(o.peers, 0),
            Size: size,
            size: bytesText(size),
            MagnetUri: magnet,
            Link: o.link || magnet || '',
            PublishDate: date,
            PublisTime: date,
            hash: hash || magnet || title,
            viewed: hash ? viewed(hash) : false,
            checked_at: Date.now(),
            en_audio: audioState(title),
            en_dub: DUB_RE.test(title),
            en_public: true,
            en_sources_v3: true,
            en_source_name: o.tracker || 'EN'
        };
    }

    function dedupeItems(items) {
        var map = {};
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item) continue;
            var key = item.hash ? 'h:' + String(item.hash).toLowerCase()
                : (item.MagnetUri || item.Link || (item.Title + '|' + item.Size));
            var prev = map[key];
            if (!prev) {
                map[key] = item;
                out.push(item);
            } else if ((item.Seeders || 0) > (prev.Seeders || 0)) {
                var index = out.indexOf(prev);
                if (index >= 0) out[index] = item;
                map[key] = item;
            }
        }
        return out;
    }

    function compareForeign(a, b) {
        if (cfg.prefer_en) {
            var ea = a.en_audio === true ? 0 : 1;
            var eb = b.en_audio === true ? 0 : 1;
            if (ea !== eb) return ea - eb;
        }
        return (b.Seeders || 0) - (a.Seeders || 0);
    }

    /* ------------------------------------------------------------------ */
    /* Nyaa                                                                */
    /* ------------------------------------------------------------------ */

    function xmlText(node, name) {
        var all = node.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var local = all[i].localName || String(all[i].nodeName || '').split(':').pop();
            if (String(local).toLowerCase() === name.toLowerCase()) {
                return clean(all[i].textContent || all[i].text || '');
            }
        }
        return '';
    }

    function textOf(el) {
        return clean(el ? (el.textContent != null ? el.textContent : el.innerText) : '');
    }

    function nyaaRssUrl(q, cat) {
        return 'https://nyaa.si/?page=rss&c=' + cat + '&f=0&s=seeders&o=desc&q=' + encodeURIComponent(q);
    }

    function nyaaHtmlUrl(q, cat, page) {
        return 'https://nyaa.si/?f=0&c=' + cat + '&q=' + encodeURIComponent(q) +
            '&s=seeders&o=desc&p=' + page;
    }

    function parseNyaaDom(text) {
        if (typeof window.DOMParser === 'undefined') return null;
        var doc;
        try { doc = new window.DOMParser().parseFromString(text, 'text/xml'); } catch (e) { return null; }
        if (!doc || !doc.getElementsByTagName) return null;
        if (doc.getElementsByTagName('parsererror').length) return null;
        var nodes = doc.getElementsByTagName('item');
        if (!nodes || !nodes.length) return null;

        var out = [];
        for (var i = 0; i < nodes.length; i++) {
            var guid = xmlText(nodes[i], 'guid');
            var idm = guid.match(/\/view\/(\d+)/);
            var item = makeItem({
                title: xmlText(nodes[i], 'title'),
                hash: xmlText(nodes[i], 'infoHash'),
                seeds: xmlText(nodes[i], 'seeders'),
                peers: xmlText(nodes[i], 'leechers'),
                size: xmlText(nodes[i], 'size'),
                date: xmlText(nodes[i], 'pubDate'),
                tracker: 'Nyaa',
                link: idm ? ('https://nyaa.si/download/' + idm[1] + '.torrent') : ''
            });
            if (item) out.push(item);
        }
        return out.length ? out : null;
    }

    function parseNyaaRegex(text) {
        var out = [];
        var items = String(text || '').match(/<item\b[\s\S]*?<\/item>/gi);
        if (!items) return out;

        function tag(block, name) {
            var re = new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '>', 'i');
            var m = block.match(re);
            if (!m) {
                re = new RegExp('<[\\w.-]+:' + name + '\\b[^>]*>([\\s\\S]*?)<\\/[\\w.-]+:' + name + '>', 'i');
                m = block.match(re);
            }
            return m ? decodeXml(m[1]) : '';
        }

        for (var i = 0; i < items.length; i++) {
            var block = items[i];
            var guid = tag(block, 'guid');
            var idm = guid.match(/\/view\/(\d+)/);
            var item = makeItem({
                title: tag(block, 'title'),
                hash: tag(block, 'infoHash'),
                seeds: tag(block, 'seeders'),
                peers: tag(block, 'leechers'),
                size: tag(block, 'size'),
                date: tag(block, 'pubDate'),
                tracker: 'Nyaa',
                link: idm ? ('https://nyaa.si/download/' + idm[1] + '.torrent') : ''
            });
            if (item) out.push(item);
        }
        return out;
    }

    function parseNyaa(text) {
        if (!text) return [];
        var out = null;
        try { out = parseNyaaDom(text); } catch (e) {}
        if (!out || !out.length) out = parseNyaaRegex(text);
        return out || [];
    }

    /*
     * HTML-парсер Nyaa (без querySelector — совместим со старыми WebView).
     * Структура строки таблицы: [0]category [1]name(+comments) [2]link
     * [3]size [4]date [5]seeders [6]leechers [7]downloads.
     */
    function parseNyaaHtml(text) {
        var out = [];
        if (!text || typeof window.DOMParser === 'undefined') return out;
        var doc;
        try { doc = new window.DOMParser().parseFromString(text, 'text/html'); } catch (e) { return out; }
        if (!doc || !doc.getElementsByTagName) return out;

        var rows = doc.getElementsByTagName('tr');
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i].getElementsByTagName('td');
            if (!cells || cells.length < 7) continue;

            // название + id: берём ссылку /view/ID без #comments
            var links = cells[1].getElementsByTagName('a');
            var viewLink = null;
            for (var j = 0; j < links.length; j++) {
                var href = links[j].getAttribute('href') || '';
                if (/\/view\/\d+$/.test(href)) { viewLink = links[j]; break; }
            }
            if (!viewLink) {
                for (var k = 0; k < links.length; k++) {
                    var h2 = links[k].getAttribute('href') || '';
                    if (h2.indexOf('/view/') >= 0) { viewLink = links[k]; }
                }
            }
            var title = '';
            var id = '';
            if (viewLink) {
                title = clean(viewLink.getAttribute('title') || viewLink.textContent || '');
                var idm = (viewLink.getAttribute('href') || '').match(/\/view\/(\d+)/);
                if (idm) id = idm[1];
            }

            var magnet = '';
            var magLinks = cells[2].getElementsByTagName('a');
            for (var m = 0; m < magLinks.length; m++) {
                var mhref = magLinks[m].getAttribute('href') || '';
                if (mhref.indexOf('magnet:') === 0) { magnet = mhref; break; }
            }
            if (!magnet) continue;

            var hm = magnet.match(/btih:([a-zA-Z0-9]{32,40})/);
            if (!title || !hm) continue;

            var ts = cells[4].getAttribute ? cells[4].getAttribute('data-timestamp') : '';
            var date = ts ? (parseInt(ts, 10) * 1000) : textOf(cells[4]);

            var item = makeItem({
                title: title,
                hash: hm[1],
                seeds: textOf(cells[5]),
                peers: textOf(cells[6]),
                size: textOf(cells[3]),
                date: date,
                tracker: 'Nyaa',
                link: id ? ('https://nyaa.si/download/' + id + '.torrent') : ''
            });
            if (item) { item.MagnetUri = magnet; out.push(item); }
        }
        return out;
    }

    function nyaaSearch(object, queries, done, bag) {
        var movie = object.movie || {};
        var anime = isAnimeCard(object);
        var isSeries = !!(movie.number_of_seasons || movie.original_name || movie.name || movie.first_air_date);
        var season = int(movie.season_number, 0);
        var cat = anime ? '1_2' : '4_1';

        var cands = (queries && queries.length ? queries : [queryFor(object)]).slice(0, 3);
        if (!cands.length) { done([], []); return; }

        // Все кандидаты (ромадзи, английский, японский...). Для первого
        // (лучшего) дополнительно ищем сезонные паки и батчи.
        var qlist = [];
        for (var c = 0; c < cands.length; c++) {
            qlist.push(cands[c]);
            if (c === 0) {
                if (isSeries && season > 0) {
                    qlist.push(cands[c] + ' S' + ('0' + season).slice(-2));
                    qlist.push(cands[c] + ' season ' + season);
                }
                if (isSeries) qlist.push(cands[c] + ' batch');
            }
        }

        var seen = {};
        var unique = [];
        for (var q = 0; q < qlist.length; q++) {
            var key = qlist[q].toLowerCase();
            if (!seen[key] && unique.length < 6) { seen[key] = true; unique.push(qlist[q]); }
        }

        var all = [];
        var errors = [];
        var remaining = unique.length;
        var finished = false;

        function finishOnce() {
            if (finished) return;
            finished = true;
            done(dedupeItems(all), errors);
        }

        function onQuery(items, err) {
            if (err) errors.push(err);
            if (items && items.length) all = all.concat(items);
            remaining--;
            if (remaining <= 0) finishOnce();
        }

        // RSS у Nyaa всегда отдаёт новинки (s=seeders игнорируется), поэтому
        // для «популярных первыми» основной — HTML с s=seeders; RSS — запасной.
        function runRss(query) {
            requestText(nyaaRssUrl(query, cat), function (err, text) {
                if (err) { onQuery([], 'Nyaa «' + query + '»: ' + err); return; }
                onQuery(parseNyaa(text));
            }, bag, looksNyaaRss);
        }

        for (var i = 0; i < unique.length; i++) {
            (function (query) {
                requestText(nyaaHtmlUrl(query, cat, 1), function (err, html) {
                    if (err) { runRss(query); return; }
                    var found = parseNyaaHtml(html);
                    if (found.length) { onQuery(found); return; }
                    runRss(query);
                }, bag, looksNyaaHtml);
            })(unique[i]);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Прочие источники                                                    */
    /* ------------------------------------------------------------------ */

    function anidexSearch(object, queries, done, bag) {
        var cands = (queries && queries.length ? queries : [queryFor(object)]).slice(0, 3);
        var idx = 0;
        var finished = false;

        function finish(items, errors) {
            if (finished) return;
            finished = true;
            done(items || [], errors || []);
        }

        function next() {
            if (finished) return;
            if (idx >= cands.length) { finish([], []); return; }
            var q = cands[idx++];
            requestJson('https://anidex.info/api/?q=' + encodeURIComponent(q) + '&s=seeders&o=desc',
                function (err, json) {
                    if (finished) return;
                    if (err || !json) { next(); return; }
                    var list = json && (json.length ? json : (json.torrents || null));
                    if (!list || Object.prototype.toString.call(list) !== '[object Array]' || !list.length) {
                        next();
                        return;
                    }
                    var out = [];
                    for (var i = 0; i < list.length; i++) {
                        var t = list[i] || {};
                        var hash = String(t.hash || t.info_hash || '').toLowerCase();
                        var magnet = t.magnet || t.link || '';
                        if (!magnet && /^[a-f0-9]{40}$/.test(hash)) {
                            magnet = magnetFor(hash, t.torrent_name || t.name || t.title);
                        }
                        if (!magnet) continue;
                        out.push(makeItem({
                            title: t.torrent_name || t.name || t.title,
                            tracker: 'AniDex' + (t.lang_name ? ' (' + t.lang_name + ')' : ''),
                            seeds: (t.seeders != null ? t.seeders : (t.seeded != null ? t.seeded : t.seeds)),
                            peers: (t.leechers != null ? t.leechers : t.peers),
                            size: parseSize(t.size), date: t.date_uploaded || t.date || '',
                            hash: hash, magnet: magnet, link: ''
                        }));
                    }
                    finish(out, []);
                }, bag);
        }

        next();
    }

    function parseTorrentio(json) {
        var out = [];
        var streams = json && json.streams ? json.streams : [];
        for (var i = 0; i < streams.length; i++) {
            var s = streams[i] || {};
            var hash = String(s.infoHash || '').toLowerCase();
            if (!/^[a-f0-9]{40}$/.test(hash)) continue;
            var name = clean(String(s.name || '').replace(/\n/g, ' '));
            var info = String(s.title || '').replace(/\n/g, ' ');
            var seeds = info.match(/👤\s*([\d.,]+)/) || info.match(/seeds?\s*:?\s*([\d.,]+)/i);
            var size = info.match(/💾\s*([\d.,]+\s*[KMGT]?B)/i);
            var src = info.match(/⚙️\s*([^\n]+)/);
            var tracker = src ? clean(src[1]) : 'Torrentio';
            var title = clean((name || 'Torrentio') + ' — ' + tracker + ' [Torrentio]');
            out.push(makeItem({
                title: title, tracker: tracker,
                seeds: seeds ? int(String(seeds[1]).replace(/[^\d]/g, ''), 0) : 0,
                peers: 0, size: size ? size[1] : '',
                hash: hash,
                magnet: 'magnet:?xt=urn:btih:' + hash +
                    (s.fileIdx != null ? '&so=' + s.fileIdx : '') +
                    '&dn=' + encodeURIComponent(title),
                link: ''
            }));
        }
        return out;
    }

    function torrentioSearch(object, done, bag) {
        var movie = object.movie || {};
        var imdb = normalizeImdb(movie.imdb_id);
        if (!imdb) { done([], []); return; }
        var isSeries = !!movie.number_of_seasons;
        var season = int(movie.season_number, 0);
        var episode = int(movie.episode_number, 0);
        if (isSeries && !episode) { done([], []); return; }
        var path = isSeries
            ? 'series/' + imdb + ':' + (season || 1) + ':' + episode
            : 'movie/' + imdb;
        requestJson('https://torrentio.strem.fun/stream/' + path + '.json',
            function (err, json) {
                if (err) { done([], [err]); return; }
                done(parseTorrentio(json), []);
            }, bag);
    }

    function parseYts(json) {
        var out = [];
        var movies = json && json.data && json.data.movies ? json.data.movies : [];
        for (var i = 0; i < movies.length; i++) {
            var m = movies[i] || {};
            var torrents = m.torrents || [];
            for (var j = 0; j < torrents.length; j++) {
                var t = torrents[j] || {};
                var hash = String(t.hash || '').toLowerCase();
                if (!/^[a-f0-9]{40}$/.test(hash)) continue;
                var title = clean(m.title + ' (' + m.year + ') [' + (t.quality || '?') +
                    '] [' + (t.type || '?') + '] [YTS]');
                out.push(makeItem({
                    title: title, tracker: 'YTS',
                    seeds: t.seeds, peers: t.peers,
                    size: t.size, date: t.date_uploaded || '',
                    hash: hash,
                    magnet: /^magnet:/i.test(String(t.url || '')) ? t.url : '',
                    link: ''
                }));
            }
        }
        return out;
    }

    function ytsSearch(object, done, bag) {
        var movie = object.movie || {};
        if (movie.number_of_seasons) { done([], []); return; }
        var imdb = normalizeImdb(movie.imdb_id);
        var title = queryFor(object);
        var query = imdb || title;
        if (!query) { done([], []); return; }

        var hosts = YTS_HOSTS.slice();
        var hostIndex = 0;
        var finished = false;

        function finish(items, errors) {
            if (finished) return;
            finished = true;
            done(items || [], errors || []);
        }

        function next() {
            if (finished) return;
            if (hostIndex >= hosts.length) { finish([], ['YTS: нет ответа']); return; }
            var url = 'https://' + hosts[hostIndex++] + '/api/v2/list_movies.json?limit=50&query_term=' +
                encodeURIComponent(query);
            requestJson(url, function (err, json) {
                if (finished) return;
                if (err || !json || !json.data) { next(); return; }
                var items = parseYts(json);
                if (items.length) { finish(items, []); return; }
                if (imdb && title && query === imdb) {
                    query = title;
                    hostIndex = 0;
                    next();
                    return;
                }
                finish([], []);
            }, bag);
        }

        next();
    }

    function parseEztv(json, season) {
        var out = [];
        var list = json && json.torrents ? json.torrents : [];
        for (var i = 0; i < list.length; i++) {
            var t = list[i] || {};
            if (season && int(t.season, 0) !== season) continue;
            var hash = String(t.hash || '').toLowerCase();
            if (!/^[a-f0-9]{40}$/.test(hash)) continue;
            var title = clean(t.filename || t.title || '');
            if (!title) continue;
            out.push(makeItem({
                title: title, tracker: 'EZTV',
                seeds: t.seeds, peers: t.peers,
                size: int(t.size_bytes, 0) || parseSize(t.small_size),
                date: t.date_released_unix ? parseInt(t.date_released_unix, 10) * 1000 : '',
                hash: hash,
                magnet: /^magnet:/i.test(String(t.torrent_url || '')) ? t.torrent_url : '',
                link: ''
            }));
        }
        return out;
    }

    function eztvSearch(object, done, bag) {
        var movie = object.movie || {};
        if (!movie.number_of_seasons) { done([], []); return; }
        var imdb = normalizeImdb(movie.imdb_id);
        if (!imdb) { done([], []); return; }
        var season = int(movie.season_number, 0);

        var hosts = EZTV_HOSTS.slice();
        var hostIndex = 0;
        var finished = false;

        function finish(items, errors) {
            if (finished) return;
            finished = true;
            done(items || [], errors || []);
        }

        function next() {
            if (finished) return;
            if (hostIndex >= hosts.length) { finish([], ['EZTV: нет ответа']); return; }
            var url = 'https://' + hosts[hostIndex++] + '/api/get-torrents?imdb_id=' +
                encodeURIComponent(imdb) + '&limit=100';
            requestJson(url, function (err, json) {
                if (finished) return;
                if (err || !json || !json.torrents) { next(); return; }
                finish(parseEztv(json, season), []);
            }, bag);
        }

        next();
    }

    function parseTpb(json) {
        var out = [];
        for (var i = 0; i < json.length; i++) {
            var t = json[i] || {};
            var hash = String(t.info_hash || '').toLowerCase();
            if (!/^[a-f0-9]{40}$/.test(hash) || /^0+$/.test(hash)) continue;
            out.push(makeItem({
                title: t.name, tracker: 'TPB',
                seeds: t.seeders, peers: t.leechers,
                size: parseInt(t.size, 10) || 0,
                date: t.added ? parseInt(t.added, 10) * 1000 : '',
                hash: hash, magnet: '', link: ''
            }));
        }
        return out;
    }

    function tpbSearch(object, queries, done, bag) {
        var cands = (queries && queries.length ? queries : [queryFor(object)]).slice(0, 2);
        var idx = 0;
        var finished = false;

        function finish(items, errors) {
            if (finished) return;
            finished = true;
            done(items || [], errors || []);
        }

        function next() {
            if (finished) return;
            if (idx >= cands.length) { finish([], []); return; }
            var q = cands[idx++];
            requestJson('https://apibay.org/q.php?q=' + encodeURIComponent(q),
                function (err, json) {
                    if (finished) return;
                    if (err || !json || Object.prototype.toString.call(json) !== '[object Array]' || !json.length) {
                        next();
                        return;
                    }
                    finish(parseTpb(json), []);
                }, bag);
        }

        next();
    }

    /* ------------------------------------------------------------------ */
    /* IMDb ID из TMDB external_ids                                        */
    /* ------------------------------------------------------------------ */

    function ensureImdb(object, callback) {
        var movie = object.movie || {};
        var imdb = normalizeImdb(movie.imdb_id);
        if (imdb) { callback(imdb); return; }
        var id = movie.id;
        if (!id) { callback(''); return; }

        var key = String(id);
        if (Object.prototype.hasOwnProperty.call(imdbCache, key)) {
            callback(imdbCache[key]);
            return;
        }

        var type = movie.number_of_seasons ? 'tv' : 'movie';
        var url;
        try {
            url = Lampa.TMDB.api(type + '/' + id + '/external_ids?api_key=' + Lampa.TMDB.key());
        } catch (e) { callback(''); return; }

        requestJson(url, function (err, json) {
            var out = (json && json.imdb_id) ? String(json.imdb_id) : '';
            imdbCache[key] = out;
            callback(out);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Оркестрация                                                         */
    /* ------------------------------------------------------------------ */

    function runExternal(object, callback) {
        readConfig();

        var search = {
            id: ++state.seq,
            done: false,
            canceled: false,
            nets: [],
            items: [],
            errors: [],
            counts: {},
            query: '',
            variants: [],
            started: Date.now(),
            timer: null
        };
        state.searches[search.id] = search;

        var guard = setTimeout(function () {
            search.errors.push('общий таймаут');
            finish();
        }, cfg.timeout * 1000 + 15000);
        search.timer = guard;

        function finish() {
            if (search.done) return;
            search.done = true;
            clearTimeout(guard);
            delete state.searches[search.id];

            var items = dedupeItems(search.items);
            if (cfg.hide_ru) {
                var filtered = [];
                for (var i = 0; i < items.length; i++) {
                    if (!isRuAudio(items[i].Title || '')) filtered.push(items[i]);
                }
                items = filtered;
            }
            items.sort(compareForeign);
            if (items.length > MAX_RESULTS) items = items.slice(0, MAX_RESULTS);

            state.last = {
                time: Date.now(),
                query: search.query,
                variants: search.variants.slice(),
                counts: search.counts,
                errors: search.errors.slice(),
                found: items.length,
                duration: Date.now() - search.started
            };

            try { callback(items, search.errors.slice()); } catch (e) { warn('callback', e); }
        }

        buildQueries(object, function (queries) {
            if (search.done || search.canceled) return;

            search.query = queries[0] || queryFor(object);
            search.variants = queries.slice();

            var movie = object.movie || {};
            var isSeries = !!(movie.number_of_seasons || movie.original_name || movie.name || movie.first_air_date);
            var anime = isAnimeCard(object);

            var pending = 0;
            var plannedDone = false;

            function runTask(task) {
                if (search.done || search.canceled) return;
                pending++;
                var called = false;
                var timer = setTimeout(function () {
                    taskDone(task, [], ['таймаут']);
                }, cfg.timeout * 1000 + 8000);

                function taskDone(t, items, errors) {
                    if (called) return;
                    called = true;
                    clearTimeout(timer);
                    if (search.done || search.canceled) return;
                    search.counts[t.id] = (items || []).length;
                    if (errors && errors.length) {
                        search.errors.push(t.title + ': ' + errors.join('; '));
                    }
                    if (items && items.length) search.items = search.items.concat(items);
                    pending--;
                    if (pending <= 0 && plannedDone) finish();
                }

                try {
                    task.run(function (items, errors) {
                        taskDone(task, items, errors || []);
                    });
                } catch (e) {
                    taskDone(task, [], [e && e.message ? e.message : 'ошибка']);
                }
            }

            function finalizePlan() {
                if (plannedDone) return;
                plannedDone = true;
                if (pending <= 0) finish();
            }

            // Источники, которым не нужен IMDb, запускаем сразу — они не
            // должны ждать TMDB external_ids.
            if (srcOn('nyaa')) runTask({ id: 'nyaa', title: 'Nyaa', run: function (done) { nyaaSearch(object, queries, done, search.nets); } });
            if (anime && srcOn('anidex')) runTask({ id: 'anidex', title: 'AniDex', run: function (done) { anidexSearch(object, queries, done, search.nets); } });
            if (!isSeries && !anime && srcOn('yts')) runTask({ id: 'yts', title: 'YTS', run: function (done) { ytsSearch(object, done, search.nets); } });
            if (srcOn('tpb')) runTask({ id: 'tpb', title: 'TPB', run: function (done) { tpbSearch(object, queries, done, search.nets); } });

            var imdbTasks = [];
            if (srcOn('torrentio')) imdbTasks.push({ id: 'torrentio', title: 'Torrentio', run: function (done) { torrentioSearch(object, done, search.nets); } });
            if (isSeries && !anime && srcOn('eztv')) imdbTasks.push({ id: 'eztv', title: 'EZTV', run: function (done) { eztvSearch(object, done, search.nets); } });

            if (imdbTasks.length) {
                ensureImdb(object, function (imdb) {
                    if (imdb) { try { object.movie.imdb_id = imdb; } catch (e) {} }
                    for (var i = 0; i < imdbTasks.length; i++) runTask(imdbTasks[i]);
                    finalizePlan();
                });
            } else {
                finalizePlan();
            }
        });

        return search.id;
    }

    function cancelAll() {
        for (var id in state.searches) {
            if (!Object.prototype.hasOwnProperty.call(state.searches, id)) continue;
            var search = state.searches[id];
            search.canceled = true;
            clearTimeout(search.timer);
            for (var i = 0; i < search.nets.length; i++) {
                try { search.nets[i].clear(); } catch (e) {}
            }
        }
        state.searches = {};
    }

    /* ------------------------------------------------------------------ */
    /* Перехват Parser.get                                                 */
    /* ------------------------------------------------------------------ */

    function wrapParser() {
        if (state.hooked) return true;
        if (!window.Lampa || !Lampa.Parser || typeof Lampa.Parser.get !== 'function') return false;

        state.originalGet = Lampa.Parser.get;
        state.originalClear = Lampa.Parser.clear;

        Lampa.Parser.get = function (object, oncomplete, onerror) {
            var self = this;
            var params = object || {};
            readConfig();

            if (!cfg.enabled) return state.originalGet.call(self, params, oncomplete, onerror);

            var finished = false;
            var started = Date.now();
            var standardDone = !cfg.merge;
            var externalDone = false;
            var standard = null;
            var external = null;
            var key = cardKey(params);

            var guard = setTimeout(function () { finish(true); }, cfg.timeout * 1000 + 18000);

            function deliver(data) {
                if (finished) return;
                finished = true;
                clearTimeout(guard);
                state.lastByCard[key] = data;
                try { oncomplete(data); } catch (e) { warn('oncomplete', e); }
            }

            function finish(force) {
                if (finished) return;
                if (state.clearTime >= started) {
                    finished = true;
                    clearTimeout(guard);
                    return;
                }
                if (!force && (!standardDone || !externalDone)) return;

                var foreign = external && external.Results ? external.Results.slice() : [];
                var std = (standard && standard.Results) ? standard.Results.slice() : [];
                var results = dedupeItems(foreign.concat(std));

                if (!results.length && !cfg.merge && cfg.fallback) {
                    finished = true;
                    clearTimeout(guard);
                    try {
                        return state.originalGet.call(self, params, oncomplete, onerror);
                    } catch (e) {
                        warn('fallback', e);
                        try { onerror(e && e.message ? e.message : 'fallback error'); } catch (err) {}
                        return;
                    }
                }

                deliver({ Results: results });
            }

            runExternal(params, function (items, errors) {
                external = { Results: items || [], errors: errors || [] };
                externalDone = true;
                if (errors && errors.length) log('источники:', errors.join(' · '));
                finish(false);
            });

            if (cfg.merge) {
                try {
                    state.originalGet.call(self, params, function (data) {
                        standard = data;
                        standardDone = true;
                        finish(false);
                    }, function () {
                        standardDone = true;
                        finish(false);
                    });
                } catch (e) {
                    warn('standard parser', e);
                    standardDone = true;
                    finish(false);
                }
            }
        };

        Lampa.Parser.clear = function () {
            state.clearTime = Date.now();
            cancelAll();
            if (state.originalClear) return state.originalClear.apply(this, arguments);
        };

        Lampa.Parser.__en_sources_v3 = true;
        state.hooked = true;
        api.status = 'ready';
        log('Parser.get перехвачен; ядро Lampa:', coreVersion());
        return true;
    }

    /*
     * Зарубежные раздачи — всегда первыми (Lampa после нашего oncomplete
     * сортирует список по своему «popular», поэтому порядок пере-применяем).
     */
    function wrapSort() {
        if (state.sortWrapped) return true;
        try {
            if (!Lampa.Component || !Lampa.Component.get || !Lampa.Component.add) return false;
            var Orig = Lampa.Component.get('torrents');
            if (!Orig || Orig.__en_v3_sort) { state.sortWrapped = true; return true; }
            state.originalTorrents = Orig;

            function Wrapped(object) {
                Orig.call(this, object);
                var sortResults = this.sortResults;
                if (typeof sortResults !== 'function') return;
                var key = cardKey(object || {});

                this.sortResults = function (need) {
                    sortResults.call(this, need);
                    var data = state.lastByCard[key];
                    if (!data || !data.Results || !data.Results.length) return;

                    var foreign = [];
                    var standard = [];
                    for (var i = 0; i < data.Results.length; i++) {
                        var it = data.Results[i];
                        if (it && (it.en_sources_v3 || it.en_public)) foreign.push(it);
                        else standard.push(it);
                    }
                    if (!foreign.length) return;

                    data.Results.length = 0;
                    for (var f = 0; f < foreign.length; f++) data.Results.push(foreign[f]);
                    for (var s = 0; s < standard.length; s++) data.Results.push(standard[s]);
                };
            }

            Wrapped.__en_v3_sort = true;
            if (Orig.prototype) Wrapped.prototype = Orig.prototype;
            Lampa.Component.add('torrents', Wrapped);
            state.sortWrapped = true;
            return true;
        } catch (e) {
            warn('component wrap', e);
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Настройки и диагностика                                             */
    /* ------------------------------------------------------------------ */

    function addParam(name, type, def, title, description, values, onChange, onRender) {
        var param = { name: PREFIX + name, type: type };
        if (typeof def !== 'undefined') param['default'] = def;
        if (values) param.values = values;
        var data = {
            component: COMPONENT,
            param: param,
            field: { name: title, description: description || '' }
        };
        if (onChange) data.onChange = onChange;
        if (onRender) data.onRender = onRender;
        try { Lampa.SettingsApi.addParam(data); } catch (e) { warn('addParam ' + name, e); }
    }

    function statusText() {
        var on = 0;
        for (var i = 0; i < SOURCES.length; i++) if (srcOn(SOURCES[i].id)) on++;
        return 'v' + VERSION + ' · ядро ' + coreVersion() + ' · ' +
            (state.hooked ? 'поиск перехвачен' : 'ожидание Parser') + ' · источников ' + on + '/' + SOURCES.length;
    }

    function registerSettings() {
        if (state.settings) return;
        if (!window.Lampa || !Lampa.SettingsApi || !Lampa.SettingsApi.addComponent) return;

        try {
            Lampa.SettingsApi.addComponent({
                component: COMPONENT,
                name: 'EN Sources 3',
                icon: ICON
            });
        } catch (e) {
            warn('addComponent', e);
        }

        addParam('section_search', 'title', undefined, 'Поиск', '');
        addParam('enabled', 'trigger', true, 'Включить плагин',
            'Добавлять зарубежные источники к поиску Lampa.', null, function () { readConfig(); });
        addParam('merge', 'trigger', true, 'Объединять со штатным поиском',
            'Показывать и результаты встроенного парсера Lampa (Jackett/Prowlarr/TorrServer).', null, function () { readConfig(); });
        addParam('fallback', 'trigger', true, 'Откат к штатному поиску',
            'Если зарубежные источники ничего не нашли в режиме замены.', null, function () { readConfig(); });
        addParam('prefer_en', 'trigger', true, 'Предпочитать английский (озвучку/сабы)',
            'Сначала релизы с английским дубляжом или английскими субтитрами.', null, function () { readConfig(); });
        addParam('hide_ru', 'trigger', false, 'Скрывать русскую озвучку',
            'Скрывает только явную русскую озвучку/дубляж. Метка [RUS] в субтитрах не скрывает раздачу.', null, function () { readConfig(); });
        addParam('timeout', 'select', '20', 'Таймаут',
            'Сколько ждать ответа источников.', {
                '10': '10 секунд',
                '15': '15 секунд',
                '20': '20 секунд',
                '30': '30 секунд'
            }, function () { readConfig(); });

        addParam('section_sources', 'title', undefined, 'Источники', '');
        for (var i = 0; i < SOURCES.length; i++) {
            (function (s) {
                addParam('src_' + s.id, 'trigger', s.def, s.title,
                    s.id === 'nyaa' ? 'Основной источник аниме; для фильмов/сериалов — категория Live Action.' : '',
                    null, function () { readConfig(); });
            })(SOURCES[i]);
        }

        addParam('section_test', 'title', undefined, 'Проверка', '');
        addParam('test', 'button', undefined, 'Проверить источники', 'Фильм, сериал и аниме; результат с количеством по каждому источнику.', null, testAll);
        addParam('diagnostics', 'button', undefined, 'Диагностика', 'Состояние и последний поиск.', null, showDiagnostics);
        addParam('status', 'static', undefined, 'Состояние', ' ', null, null, function (item) {
            try { item.find('.settings-param__descr').text(statusText()); } catch (e) {}
        });

        state.settings = true;
        log('настройки зарегистрированы');
    }

    function restoreController(name) {
        try { Lampa.Controller.toggle(name || 'settings_component'); } catch (e) {}
    }

    function modal(title, html) {
        try {
            if (!Lampa.Modal) { notify(title); return; }
            var previous = 'settings_component';
            try { previous = Lampa.Controller.enabled().name || previous; } catch (e) {}
            var body = html;
            if ($) body = $('<div class="en-src-modal"></div>').html(html);
            Lampa.Modal.open({
                title: title,
                html: body,
                size: 'medium',
                onBack: function () {
                    try { Lampa.Modal.close(); } catch (e) {}
                    restoreController(previous);
                }
            });
        } catch (e) {
            warn('modal', e);
            notify(title);
        }
    }

    function sourceLine(id) {
        if (!srcOn(id)) return 'выкл';
        var last = state.last;
        if (last && Object.prototype.hasOwnProperty.call(last.counts, id)) return String(last.counts[id]);
        return '—';
    }

    function showDiagnostics() {
        var last = state.last;
        var html = '<h3>Состояние</h3>' +
            '<p>Версия: <b>' + esc(VERSION) + '</b><br>' +
            'Ядро Lampa: ' + esc(coreVersion()) + '<br>' +
            'Перехват поиска: ' + (state.hooked ? 'активен' : 'не активен') + '<br>' +
            'Плагин: ' + (cfg.enabled ? 'включён' : 'выключен') + '</p>';

        html += '<h3>Источники</h3>';
        for (var i = 0; i < SOURCES.length; i++) {
            html += '<p>' + esc(SOURCES[i].title) + ': ' + sourceLine(SOURCES[i].id) + '</p>';
        }

        if (last) {
            html += '<h3>Последний поиск</h3>' +
                '<p>Запрос: <b>' + esc(last.query || '—') + '</b><br>' +
                'Найдено: ' + last.found + '<br>' +
                'Время: ' + Math.round(last.duration / 1000) + ' сек.</p>';
            if (last.errors && last.errors.length) {
                html += '<h3>Ошибки</h3>';
                for (var j = 0; j < last.errors.length; j++) html += '<p>' + esc(last.errors[j]) + '</p>';
            }
        } else {
            html += '<h3>Последний поиск</h3><p>Ещё не выполнялся.</p>';
        }

        html += '<h3>Блокировки</h3>' +
            '<p>Плагин ходит напрямую, без прокси. Добавьте в ваше средство обхода домены:<br>' +
            '<b>nyaa.si, anidex.info, torrentio.strem.fun, yts.mx, eztvx.to, apibay.org, ' +
            'shikimori.io, graphql.anilist.co, api.themoviedb.org</b>.<br>' +
            'Если источник отдаёт «сеть/Cloudflare» — его домен не обойдён или недоступен.</p>';

        modal('EN Sources · диагностика', html);
    }

    function testAll() {
        notify('Проверяю источники...');
        var probes = [
            { name: 'фильм', search: 'Inception', movie: { id: 27205, title: 'Inception', original_title: 'Inception', imdb_id: 'tt1375666' } },
            { name: 'сериал', search: 'Breaking Bad', movie: { id: 1396, title: 'Breaking Bad', original_name: 'Breaking Bad', number_of_seasons: 5, season_number: 1, episode_number: 1, imdb_id: 'tt0903747' } },
            { name: 'аниме', search: 'Frieren', movie: { id: 145064, title: 'Frieren', original_name: '葬送のフリーレン', number_of_seasons: 1, season_number: 1, episode_number: 1, original_language: 'ja', genres: [{ id: 16 }] } }
        ];

        var agg = { counts: {}, errors: {}, names: {} };
        var idx = 0;

        function step() {
            if (idx >= probes.length) {
                var html = '<h3>Результат проверки</h3>';
                for (var i = 0; i < SOURCES.length; i++) {
                    var id = SOURCES[i].id;
                    var count = agg.counts[id] !== undefined ? agg.counts[id] : '—';
                    html += '<p>' + esc(SOURCES[i].title) + ': <b>' + count + '</b>' +
                        (srcOn(id) ? '' : ' (выкл)') + '</p>';
                }
                var keys = [];
                for (var e in agg.errors) if (Object.prototype.hasOwnProperty.call(agg.errors, e)) keys.push(e);
                if (keys.length) {
                    html += '<h3>Ошибки</h3>';
                    for (var k = 0; k < keys.length; k++) html += '<p>' + esc(keys[k]) + '</p>';
                }
                modal('EN Sources · проверка', html);
                return;
            }
            var probe = probes[idx++];
            runExternal(probe, function () {
                var last = state.last;
                if (last) {
                    for (var id in last.counts) {
                        if (!Object.prototype.hasOwnProperty.call(last.counts, id)) continue;
                        agg.counts[id] = Math.max(agg.counts[id] || 0, last.counts[id]);
                    }
                    for (var e2 = 0; e2 < last.errors.length; e2++) agg.errors[last.errors[e2]] = 1;
                }
                step();
            });
        }

        step();
    }

    /* ------------------------------------------------------------------ */
    /* Жизненный цикл                                                      */
    /* ------------------------------------------------------------------ */

    function follow(target, event, callback) {
        if (!target || !target.follow) return;
        target.follow(event, callback);
        state.listeners.push({ target: target, event: event, callback: callback });
    }

    function removeListeners() {
        for (var i = 0; i < state.listeners.length; i++) {
            var l = state.listeners[i];
            try {
                if (l.target.remove) l.target.remove(l.event, l.callback);
            } catch (e) {}
        }
        state.listeners = [];
    }

    function onStorageChange(event) {
        if (!event || !event.name) return;
        if (event.name.indexOf(PREFIX) === 0) readConfig();
    }

    function neutralizeOld() {
        try {
            Lampa.Storage.set('en_sources_v2_enabled', false);
            Lampa.Storage.set('en_pub_enabled', false);
        } catch (e) {}
    }

    function addStyle() {
        if (document.getElementById('en-sources-v3-style')) return;
        var style = document.createElement('style');
        style.id = 'en-sources-v3-style';
        style.type = 'text/css';
        style.appendChild(document.createTextNode([
            '.en-src-modal{max-height:62vh;overflow:auto;line-height:1.55;padding-right:.4em}',
            '.en-src-modal h3{margin:.6em 0 .35em;color:#5eead4;font-size:1.05em}',
            '.en-src-modal p{margin:.3em 0;color:#e2e8f0}',
            '.en-src-modal b{color:#f8fafc}',
            '.en-src-modal::-webkit-scrollbar{width:8px}',
            '.en-src-modal::-webkit-scrollbar-thumb{background:#14b8a6;border-radius:8px}'
        ].join('\n')));
        (document.head || document.documentElement).appendChild(style);
    }

    function init() {
        if (state.started || state.destroyed) return;
        state.started = true;

        try {
            readConfig();
            addStyle();
            neutralizeOld();
            registerSettings();
            if (!state.settings) {
                setTimeout(function () {
                    if (!state.settings && !state.destroyed) registerSettings();
                }, 1500);
            }

            var parserOk = wrapParser();
            var sortOk = wrapSort();
            if (!parserOk || !sortOk) {
                var tries = 0;
                state.hookTimer = setInterval(function () {
                    tries++;
                    if (state.destroyed) {
                        clearInterval(state.hookTimer);
                        state.hookTimer = null;
                        return;
                    }
                    if (!state.hooked) wrapParser();
                    if (!state.sortWrapped) wrapSort();
                    if ((state.hooked && state.sortWrapped) || tries >= 240) {
                        clearInterval(state.hookTimer);
                        state.hookTimer = null;
                        if (!state.hooked) {
                            api.status = 'parser-unavailable';
                            warn('Lampa.Parser.get не найден; поиск не перехвачен');
                        }
                    }
                }, 500);
            }

            try {
                if (Lampa.Storage && Lampa.Storage.listener) {
                    follow(Lampa.Storage.listener, 'change', onStorageChange);
                }
            } catch (e) {}

            api.status = state.hooked ? 'ready' : 'waiting-parser';
            log('загружен; ядро:', coreVersion(), '; перехват:', state.hooked);
        } catch (e) {
            api.status = 'error';
            warn('init', e);
        }
    }

    function destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        api.status = 'destroyed';

        cancelAll();
        clearInterval(state.bootTimer);
        clearInterval(state.hookTimer);
        removeListeners();

        try {
            if (state.hooked && window.Lampa && Lampa.Parser) {
                Lampa.Parser.get = state.originalGet;
                Lampa.Parser.clear = state.originalClear;
                delete Lampa.Parser.__en_sources_v3;
            }
        } catch (e) {}

        try {
            if (state.originalTorrents && Lampa.Component && Lampa.Component.add) {
                Lampa.Component.add('torrents', state.originalTorrents);
            }
        } catch (e) {}

        try {
            var style = document.getElementById('en-sources-v3-style');
            if (style && style.parentNode) style.parentNode.removeChild(style);
        } catch (e) {}

        try {
            if (Lampa.SettingsApi && Lampa.SettingsApi.removeComponent) {
                Lampa.SettingsApi.removeComponent(COMPONENT);
            }
        } catch (e) {}
    }

    api.destroy = destroy;
    api._test = {
        parseNyaa: parseNyaa,
        parseNyaaHtml: parseNyaaHtml,
        parseSize: parseSize,
        bytesText: bytesText,
        parseTime: parseTime,
        normalizeImdb: normalizeImdb,
        magnetFor: magnetFor,
        audioState: audioState,
        baseQueries: baseQueries,
        isAnimeCard: isAnimeCard,
        cleanQuery: cleanQuery
    };

    function boot() {
        if (state.destroyed) return;

        if (window.appready && window.Lampa && Lampa.Parser) {
            init();
            return;
        }

        try {
            if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
                Lampa.Listener.follow('app', function (event) {
                    if (event && event.type === 'ready') init();
                });
            }
        } catch (e) {}

        var tries = 0;
        state.bootTimer = setInterval(function () {
            tries++;
            if (state.destroyed) {
                clearInterval(state.bootTimer);
                state.bootTimer = null;
                return;
            }
            if (window.appready && window.Lampa && Lampa.Parser) {
                clearInterval(state.bootTimer);
                state.bootTimer = null;
                init();
            } else if (tries >= 240) {
                clearInterval(state.bootTimer);
                state.bootTimer = null;
                warn('Lampa не инициализировалась за 120 секунд');
            }
        }, 500);
    }

    if (!window.__EN_SOURCES_TEST__) boot();
})(window, document);
