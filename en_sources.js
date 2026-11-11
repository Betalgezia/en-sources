
/*!
 * EN Sources 2.0.0 — одиночный плагин для Lampa
 * ---------------------------------------------------------------------------
 * Установка: Настройки -> Расширения -> Добавить плагин -> URL этого файла.
 * Пример: https://betalgezia.github.io/en-sources/en_sources.js?v=2
 *
 * Совместимость: веб-ядро Lampa 2.x/3.x; Android-оболочка LAMPA 1.13.5.
 * Версия 1.13.5 — это версия Android-оболочки, а не обязательно веб-ядра.
 *
 * Что исправлено относительно 1.0.x:
 *   - отдельный раздел настроек через Lampa.SettingsApi.addComponent;
 *   - переключатель в шапке через Lampa.Head.addIcon;
 *   - триггеры Lampa читаются с нормализацией 'true'/'false';
 *   - событие готовности только app/ready + проверка window.appready;
 *   - один обратный вызов на поиск, отмена запросов и очистка таймеров;
 *   - корректные поля результата Lampa: Size, PublishDate, PublisTime, hash;
 *   - IMDb ID сохраняется в формате ttXXXXXXXX для Torznab/Prowlarr.
 *
 * Источники настраиваются пользователем: Jackett, Prowlarr, Torznab и
 * Internet Archive. Подключайте только те индексаторы и раздачи, на
 * использование которых у вас есть права. Встроенный источник Internet
 * Archive ищет по открытым коллекциям и возвращает только найденные
 * .torrent-файлы.
 */
(function (window, document) {
    'use strict';

    var VERSION = '2.0.0';
    var NS = '__lampa_en_sources_v2__';
    var COMPONENT = 'en_sources';
    var PREFIX = 'en_sources_v2_';
    var MAX_SOURCES = 8;
    var PLUGIN_URL = 'https://betalgezia.github.io/en-sources/en_sources.js';

    if (window[NS] && window[NS].version === VERSION) return;
    if (window[NS] && typeof window[NS].destroy === 'function') {
        try { window[NS].destroy(); } catch (e) {}
    }

    var api = { version: VERSION, status: 'loading' };
    window[NS] = api;

    var K = {
        enabled: PREFIX + 'enabled',
        head: PREFIX + 'head',
        merge: PREFIX + 'merge',
        fallback: PREFIX + 'fallback',
        audio: PREFIX + 'audio',
        movies: PREFIX + 'movies',
        tv: PREFIX + 'tv',
        anime: PREFIX + 'anime',
        timeout: PREFIX + 'timeout',
        proxy: PREFIX + 'proxy',
        notify: PREFIX + 'notify',
        sources: PREFIX + 'sources'
    };

    var ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/><path d="m9.8 9.7 4.7 2.3-4.7 2.3z" fill="currentColor" stroke="none"/></svg>';
    var HEAD_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18" cy="17" r="3"/></svg>';

    var $ = window.jQuery || window.$;
    var cfg = {};
    var sources = [];
    var state = {
        destroyed: false,
        hooked: false,
        hookTimer: null,
        bootTimer: null,
        head: null,
        settingsName: '',
        originalGet: null,
        originalClear: null,
        originalTorrents: null,
        listeners: [],
        searches: {},
        searchSeq: 0,
        lastByCard: {},
        last: null
    };

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

    function L(ru, en, uk) {
        return { ru: ru, en: en, uk: uk || ru };
    }

    function T(key) {
        try { return Lampa.Lang.translate(key); } catch (e) { return key; }
    }

    function notify(text) {
        try { if (Lampa.Noty) Lampa.Noty.show(text, { time: 3500 }); } catch (e) {}
    }

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function trim(text) {
        return String(text == null ? '' : text).replace(/^\s+|\s+$/g, '');
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

    function setBool(key, value) {
        try { Lampa.Storage.set(key, value ? 'true' : 'false'); } catch (e) {}
    }

    function readConfig() {
        cfg.enabled = bool(K.enabled, false);
        cfg.head = bool(K.head, true);
        cfg.merge = bool(K.merge, true);
        cfg.fallback = bool(K.fallback, true);
        cfg.audio = str(K.audio, 'prefer');
        cfg.movies = bool(K.movies, true);
        cfg.tv = bool(K.tv, true);
        cfg.anime = bool(K.anime, true);
        cfg.timeout = parseInt(str(K.timeout, '20'), 10);
        if (isNaN(cfg.timeout) || cfg.timeout < 5) cfg.timeout = 20;
        cfg.proxy = trim(str(K.proxy, ''));
        cfg.notify = bool(K.notify, false);
    }

    function defaultSources() {
        return [{
            id: 'ia',
            name: 'Internet Archive',
            type: 'archive',
            url: 'https://archive.org',
            key: '',
            enabled: true,
            kind: 'all',
            collections: 'feature_films',
            rank: 0
        }];
    }

    function cleanSource(src, index) {
        if (!src || typeof src !== 'object') return null;
        var type = String(src.type || 'jackett').toLowerCase();
        if (['jackett', 'prowlarr', 'torznab', 'archive'].indexOf(type) < 0) type = 'jackett';
        var url = trim(src.url || '');
        if (type === 'archive' && !url) url = 'https://archive.org';
        return {
            id: trim(src.id || '') || ('src_' + index + '_' + Math.floor(Math.random() * 100000)),
            name: trim(src.name || '') || type,
            type: type,
            url: url.replace(/\/+$/, ''),
            key: trim(src.key || ''),
            enabled: src.enabled === false || src.enabled === 'false' ? false : true,
            kind: ['all', 'movie', 'tv', 'anime'].indexOf(String(src.kind || 'all')) >= 0 ? String(src.kind || 'all') : 'all',
            collections: trim(src.collections || (type === 'archive' ? 'feature_films' : '')),
            rank: index
        };
    }

    function loadSources() {
        var raw = null;
        try { raw = Lampa.Storage.get(K.sources, null); } catch (e) {}
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { raw = null; }
        }
        if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') raw = defaultSources();
        var out = [];
        for (var i = 0; i < raw.length && out.length < MAX_SOURCES; i++) {
            var src = cleanSource(raw[i], i);
            if (src) out.push(src);
        }
        sources = out;
    }

    function saveSources() {
        for (var i = 0; i < sources.length; i++) sources[i].rank = i;
        try { Lampa.Storage.set(K.sources, sources); } catch (e) {}
    }

    function validUrl(url) {
        return /^https?:\/\/[^\s]+$/i.test(trim(url));
    }

    function addQuery(url, pairs) {
        var parts = [];
        for (var i = 0; i < pairs.length; i++) {
            var p = pairs[i];
            if (p.value == null || p.value === '') continue;
            parts.push(encodeURIComponent(p.name) + '=' + encodeURIComponent(p.value));
        }
        if (!parts.length) return url;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
    }

    function proxied(url) {
        if (!cfg.proxy) return url;
        if (cfg.proxy.indexOf('{url}') >= 0) return cfg.proxy.replace('{url}', encodeURIComponent(url));
        return cfg.proxy + encodeURIComponent(url);
    }

    function request(url, options, done, fail) {
        var net;
        try { net = new Lampa.Reguest(); } catch (e) { fail('Reguest unavailable'); return null; }
        net.timeout(cfg.timeout * 1000);
        var params = { dataType: options && options.text ? 'text' : 'json' };
        if (options && options.headers) params.headers = options.headers;
        try {
            net.native(proxied(url), function (data) { done(data); }, function (a, b) {
                var msg = 'network error';
                try { msg = net.errorDecode(a, b); } catch (e) {}
                fail(msg);
            }, false, params);
        } catch (e) {
            fail(e && e.message ? e.message : 'request error');
        }
        return net;
    }

    function toBytes(value) {
        if (typeof value === 'number' && isFinite(value)) return Math.max(0, Math.round(value));
        var s = trim(value);
        if (!s) return 0;
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        var m = s.replace(',', '.').match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|K|M|G|T|B|Б|КБ|МБ|ГБ|ТБ)?/i);
        if (!m) return 0;
        var n = parseFloat(m[1]);
        if (isNaN(n)) return 0;
        var u = (m[2] || 'B').toLowerCase();
        var mult = 1;
        if (u === 'k' || u === 'kb' || u === 'kib' || u === 'кб') mult = 1024;
        else if (u === 'm' || u === 'mb' || u === 'mib' || u === 'мб') mult = 1048576;
        else if (u === 'g' || u === 'gb' || u === 'gib' || u === 'гб') mult = 1073741824;
        else if (u === 't' || u === 'tb' || u === 'tib' || u === 'тб') mult = 1099511627776;
        return Math.round(n * mult);
    }

    function bytesText(bytes) {
        if (!bytes) return '';
        try { if (Lampa.Utils && Lampa.Utils.bytesToSize) return Lampa.Utils.bytesToSize(bytes); } catch (e) {}
        var units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        i = Math.max(0, Math.min(units.length - 1, i));
        return (bytes / Math.pow(1024, i)).toFixed(i ? 2 : 0) + ' ' + units[i];
    }

    function toTime(value) {
        if (typeof value === 'number' && isFinite(value)) return value < 1e12 ? value * 1000 : value;
        var s = trim(value);
        if (!s) return Date.now();
        if (/^\d+$/.test(s)) {
            var n = parseInt(s, 10);
            return n < 1e12 ? n * 1000 : n;
        }
        var t = Date.parse(s);
        return isNaN(t) ? Date.now() : t;
    }

    function hashText(text) {
        try { if (Lampa.Utils && Lampa.Utils.hash) return String(Lampa.Utils.hash(text)); } catch (e) {}
        var h = 0;
        text = String(text || '');
        for (var i = 0; i < text.length; i++) {
            h = ((h << 5) - h) + text.charCodeAt(i);
            h = h & h;
        }
        return String(Math.abs(h));
    }

    function magnetHash(magnet) {
        var m = String(magnet || '').match(/btih:([a-zA-Z0-9]{32,40})/);
        return m ? m[1].toLowerCase() : '';
    }

    function viewed(hash) {
        try {
            var list = Lampa.Storage.get('torrents_view', []);
            if (typeof list === 'string') list = JSON.parse(list);
            return list && list.indexOf && list.indexOf(hash) >= 0;
        } catch (e) { return false; }
    }

    function normalizeImdb(raw) {
        var s = trim(raw).toLowerCase();
        if (!s) return '';
        if (/^tt\d{7,10}$/.test(s)) return s;
        if (/^\d{1,10}$/.test(s)) {
            while (s.length < 7) s = '0' + s;
            return 'tt' + s;
        }
        return '';
    }

    function clone(obj) {
        var out = {};
        if (!obj || typeof obj !== 'object') return out;
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
        return out;
    }

    function englishState(item) {
        var i, lang;
        var langs = item.languages || item.Languages || [];
        if (typeof langs === 'string') langs = [langs];
        for (i = 0; i < langs.length; i++) {
            lang = String(langs[i] || '').toLowerCase();
            if (lang === 'en' || lang === 'eng' || lang === 'english') return true;
        }
        var probe = item.ffprobe || [];
        for (i = 0; i < probe.length; i++) {
            if (probe[i] && probe[i].codec_type === 'audio' && probe[i].tags) {
                lang = String(probe[i].tags.language || '').toLowerCase();
                if (lang === 'en' || lang === 'eng') return true;
            }
        }
        var title = String(item.Title || item.title || '');
        if (/\b(english|eng)\b/i.test(title)) return true;
        if (/\b(russian|rus|ukrainian|ukr|japanese|jpn|french|german|spanish)\b/i.test(title)) return false;
        return null;
    }

    function normalizeItem(raw, source) {
        if (!raw || typeof raw !== 'object') return null;
        var item = clone(raw);
        var title = trim(raw.Title || raw.title || raw.name || '');
        if (!title) return null;

        var magnet = raw.MagnetUri || raw.magnet || raw.magnetUri || '';
        var link = raw.Link || raw.link || raw.downloadUrl || raw.torrent_url || '';
        if (!magnet && /^magnet:/i.test(String(link))) magnet = link;
        var ih = raw.infoHash || raw.infohash || raw.hash || '';
        if (!magnet && ih && /^[a-zA-Z0-9]{32,40}$/.test(String(ih))) {
            magnet = 'magnet:?xt=urn:btih:' + ih + '&dn=' + encodeURIComponent(title);
        }
        if (!magnet && !link) return null;

        var tracker = trim(raw.Tracker || raw.tracker || raw.indexer || '');
        item.Title = title;
        item.Tracker = source.name + (tracker && tracker !== source.name ? ' / ' + tracker : '');
        item.Size = toBytes(raw.Size != null ? raw.Size : raw.size);
        item.size = item.Size ? bytesText(item.Size) : trim(raw.size || '');
        item.Seeders = parseInt(raw.Seeders != null ? raw.Seeders : (raw.seeders != null ? raw.seeders : raw.seeds), 10) || 0;
        item.Peers = parseInt(raw.Peers != null ? raw.Peers : (raw.leechers != null ? raw.leechers : raw.peers), 10) || 0;
        item.MagnetUri = magnet;
        item.Link = link || magnet;
        item.PublishDate = toTime(raw.PublishDate || raw.publishDate || raw.CreateDate || raw.pubDate || raw.date);
        item.PublisTime = item.PublishDate;
        item.hash = magnetHash(magnet) || String(raw.hash || '') || hashText(title + '|' + item.Size + '|' + item.Tracker);
        item.viewed = viewed(item.hash);
        item.checked_at = Date.now();
        item.source_rank = source.rank || 0;
        item.en_sources_v2 = true;
        item.en_source_name = source.name;
        item.en_audio = englishState(item);
        return item;
    }

    function cardKind(params) {
        var movie = (params && params.movie) || {};
        var tv = !!(movie.number_of_seasons || movie.original_name || movie.name || movie.first_air_date);
        var genres = movie.genres || movie.genre_ids || [];
        var animation = false;
        for (var i = 0; i < genres.length; i++) {
            var g = genres[i];
            if ((typeof g === 'object' && g && g.id == 16) || g == 16) animation = true;
        }
        var anime = animation && (movie.original_language === 'ja' || movie.original_language === 'zh');
        return { tv: tv, anime: anime, movie: !tv };
    }

    function allowedKinds(params) {
        var kind = cardKind(params);
        var out = [];
        if (kind.movie && cfg.movies) out.push('movie');
        if (kind.tv && cfg.tv) out.push('tv');
        if (kind.anime && cfg.anime) out.push('anime');
        return out;
    }

    function sourceMatches(src, kinds) {
        if (!src.enabled) return false;
        if (src.kind === 'all') return kinds.length > 0;
        return kinds.indexOf(src.kind) >= 0;
    }

    function categoriesFor(src, kinds) {
        var cats = [];
        var want = src.kind === 'all' ? kinds : [src.kind];
        for (var i = 0; i < want.length; i++) {
            if (want[i] === 'movie' && cats.indexOf('2000') < 0) cats.push('2000');
            if (want[i] === 'tv' && cats.indexOf('5000') < 0) cats.push('5000');
            if (want[i] === 'anime' && cats.indexOf('5070') < 0) cats.push('5070');
        }
        return cats;
    }

    function queryFor(params) {
        var movie = (params && params.movie) || {};
        var q = movie.original_title || movie.original_name || params.search_two || params.search || movie.title || movie.name || '';
        if (!q && params.query) {
            try { q = decodeURIComponent(params.query); } catch (e) { q = params.query; }
        }
        return trim(q);
    }

    function yearFor(params) {
        var movie = (params && params.movie) || {};
        var d = movie.release_date || movie.first_air_date || movie.year || '';
        var m = String(d).match(/(19|20)\d{2}/);
        return m ? m[0] : '';
    }

    function episodeFor(params) {
        var movie = (params && params.movie) || {};
        var s = parseInt(movie.season_number, 10);
        var e = parseInt(movie.episode_number, 10);
        return { season: isNaN(s) ? 0 : s, episode: isNaN(e) ? 0 : e };
    }

    function parseXml(text) {
        if (typeof window.DOMParser !== 'undefined') {
            try {
                var doc = new DOMParser().parseFromString(text, 'text/xml');
                if (doc && doc.getElementsByTagName && !doc.getElementsByTagName('parsererror').length) return doc;
            } catch (e) {}
        }
        if ($ && $.parseXML) {
            try { return $.parseXML(text); } catch (e) {}
        }
        return null;
    }

    function xmlChildren(node, name) {
        var out = [];
        if (!node || !node.getElementsByTagName) return out;
        var all = node.getElementsByTagName('*');
        for (var i = 0; i < all.length; i++) {
            var local = all[i].localName || String(all[i].nodeName || '').split(':').pop();
            if (local === name) out.push(all[i]);
        }
        return out;
    }

    function xmlText(node, name) {
        var nodes = xmlChildren(node, name);
        if (!nodes.length) return '';
        return trim(nodes[0].textContent || nodes[0].text || '');
    }

    function parseTorznab(text, source) {
        var doc = parseXml(text);
        if (!doc) throw new Error('XML parser unavailable');
        var items = xmlChildren(doc, 'item');
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var raw = {
                Title: xmlText(it, 'title'),
                Link: xmlText(it, 'link'),
                PublishDate: xmlText(it, 'pubDate'),
                Tracker: source.name
            };
            var enclosure = null;
            var enc = it.getElementsByTagName ? it.getElementsByTagName('enclosure') : [];
            if (enc && enc.length) enclosure = enc[0];
            if (enclosure && enclosure.getAttribute) raw.Link = enclosure.getAttribute('url') || raw.Link;
            var attrs = xmlChildren(it, 'attr');
            for (var j = 0; j < attrs.length; j++) {
                var name = attrs[j].getAttribute ? String(attrs[j].getAttribute('name') || '').toLowerCase() : '';
                var value = attrs[j].getAttribute ? attrs[j].getAttribute('value') : '';
                if (name === 'size') raw.Size = value;
                else if (name === 'seeders') raw.Seeders = value;
                else if (name === 'peers') raw.Peers = value;
                else if (name === 'infohash') raw.infoHash = value;
                else if (name === 'magneturl') raw.MagnetUri = value;
            }
            var normalized = normalizeItem(raw, source);
            if (normalized) out.push(normalized);
        }
        return out;
    }

    function parseJackett(json, source) {
        var list = json && (json.Results || json.results);
        if (!list || Object.prototype.toString.call(list) !== '[object Array]') throw new Error('Jackett: нет Results');
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var item = normalizeItem(list[i], source);
            if (item) out.push(item);
        }
        return out;
    }

    function parseProwlarr(json, source) {
        if (Object.prototype.toString.call(json) !== '[object Array]') throw new Error('Prowlarr: ожидался массив');
        var out = [];
        for (var i = 0; i < json.length; i++) {
            var raw = json[i];
            if (!raw || String(raw.protocol || '').toLowerCase() !== 'torrent') continue;
            var item = normalizeItem({
                Title: raw.title,
                Tracker: raw.indexer,
                Size: raw.size,
                Seeders: raw.seeders,
                Peers: raw.leechers,
                PublishDate: raw.publishDate,
                MagnetUri: /^magnet:/i.test(String(raw.downloadUrl || '')) ? raw.downloadUrl : '',
                Link: raw.downloadUrl,
                infoHash: raw.infoHash
            }, source);
            if (item) out.push(item);
        }
        return out;
    }

    function archiveSearch(source, params, done, fail, netBag) {
        var q = queryFor(params);
        if (!q) { done([]); return; }
        var lucene = q.replace(/([+\-!(){}\[\]^"~*?:\\\/])/g, '\\$1');
        var query = 'mediatype:(movies) AND title:(' + lucene + ')';
        if (source.collections) query += ' AND collection:(' + source.collections.replace(/\s*,\s*/g, ' OR ') + ')';
        var base = source.url || 'https://archive.org';
        var url = addQuery(base + '/advancedsearch.php', [
            { name: 'q', value: query },
            { name: 'fl[]', value: 'identifier' },
            { name: 'fl[]', value: 'title' },
            { name: 'fl[]', value: 'year' },
            { name: 'fl[]', value: 'downloads' },
            { name: 'sort[]', value: 'downloads desc' },
            { name: 'rows', value: '12' },
            { name: 'page', value: '1' },
            { name: 'output', value: 'json' }
        ]);
        var net = request(url, {}, function (json) {
            var docs = json && json.response && json.response.docs;
            if (!docs || !docs.length) { done([]); return; }
            var out = [];
            var index = 0;
            var active = 0;
            var finished = false;
            var limit = Math.min(docs.length, 12);

            function finish() {
                if (finished) return;
                finished = true;
                done(out);
            }

            function next() {
                if (finished) return;
                if (index >= limit && active === 0) { finish(); return; }
                while (active < 3 && index < limit) {
                    var doc = docs[index++];
                    active++;
                    checkDoc(doc);
                }
            }

            function checkDoc(doc) {
                var id = trim(doc.identifier || '');
                if (!id) { active--; next(); return; }
                var metaUrl = base + '/metadata/' + encodeURIComponent(id);
                var metaNet = request(metaUrl, {}, function (meta) {
                    active--;
                    try {
                        if (!meta || meta.is_dark) { next(); return; }
                        var files = meta.files || [];
                        var torrent = null;
                        for (var i = 0; i < files.length; i++) {
                            var name = String(files[i].name || '');
                            if (name === id + '_archive.torrent') { torrent = files[i]; break; }
                            if (!torrent && /\.torrent$/i.test(name)) torrent = files[i];
                        }
                        if (torrent) {
                            var lang = meta.metadata && (meta.metadata.language || meta.metadata.lang);
                            var item = normalizeItem({
                                Title: trim(doc.title || id) + (doc.year ? ' (' + doc.year + ')' : ''),
                                Tracker: 'Internet Archive',
                                Size: torrent.size,
                                Link: base + '/download/' + encodeURIComponent(id) + '/' + encodeURIComponent(torrent.name),
                                PublishDate: meta.metadata && (meta.metadata.publicdate || meta.metadata.addeddate),
                                languages: lang ? [lang] : []
                            }, source);
                            if (item) out.push(item);
                        }
                    } catch (e) {}
                    next();
                }, function () {
                    active--;
                    next();
                });
                if (metaNet) netBag.push(metaNet);
            }

            next();
        }, fail);
        if (net) netBag.push(net);
    }

    function runSource(source, params, done, fail) {
        var nets = [];
        var called = false;
        var timer = setTimeout(function () {
            if (called) return;
            called = true;
            for (var i = 0; i < nets.length; i++) { try { nets[i].clear(); } catch (e) {} }
            fail('timeout');
        }, cfg.timeout * 1000 + 1500);

        function ok(items) {
            if (called) return;
            called = true;
            clearTimeout(timer);
            done(items || []);
        }

        function bad(msg) {
            if (called) return;
            called = true;
            clearTimeout(timer);
            fail(msg || 'error');
        }

        try {
            var q = queryFor(params);
            var kinds = allowedKinds(params);
            var cats = categoriesFor(source, kinds);
            var ep = episodeFor(params);
            var imdb = normalizeImdb(params.movie && params.movie.imdb_id);
            var year = yearFor(params);
            var url, headers = {};

            if (source.type === 'archive') {
                archiveSearch(source, params, ok, bad, nets);
                return nets;
            }

            if (!q) { ok([]); return nets; }

            if (source.type === 'jackett') {
                url = source.url;
                if (!/\/api\/v2\.0\/indexers\/.+\/results/i.test(url)) url += '/api/v2.0/indexers/all/results';
                url = addQuery(url, [
                    { name: 'apikey', value: source.key },
                    { name: 'Query', value: q }
                ]);
                if (!params.from_search) {
                    url = addQuery(url, [
                        { name: 'title_original', value: q },
                        { name: 'year', value: year },
                        { name: 'is_serial', value: kinds.indexOf('tv') >= 0 || kinds.indexOf('anime') >= 0 ? '2' : '1' },
                        { name: 'Category[]', value: cats.join(',') }
                    ]);
                }
                var jn = request(url, {}, function (json) { ok(parseJackett(json, source)); }, bad);
                if (jn) nets.push(jn);
            } else if (source.type === 'prowlarr') {
                url = source.url;
                if (!/\/api\/v1\/search/i.test(url)) url += '/api/v1/search';
                var tvq = q;
                if ((kinds.indexOf('tv') >= 0 || kinds.indexOf('anime') >= 0) && imdb) {
                    tvq = '{ImdbId:' + imdb + '}';
                    if (ep.season) tvq += ' {Season:' + ep.season + '}';
                    if (ep.episode) tvq += ' {Episode:' + ep.episode + '}';
                }
                url = addQuery(url, [
                    { name: 'query', value: tvq },
                    { name: 'type', value: kinds.indexOf('tv') >= 0 || kinds.indexOf('anime') >= 0 ? 'tvsearch' : 'search' },
                    { name: 'indexerIds', value: '-2' }
                ]);
                for (var c = 0; c < cats.length; c++) url = addQuery(url, [{ name: 'categories', value: cats[c] }]);
                if (source.key) headers['X-Api-Key'] = source.key;
                var pn = request(url, { headers: headers }, function (json) { ok(parseProwlarr(json, source)); }, bad);
                if (pn) nets.push(pn);
            } else {
                url = source.url;
                var t = kinds.indexOf('tv') >= 0 || kinds.indexOf('anime') >= 0 ? 'tvsearch' : (kinds.indexOf('movie') >= 0 ? 'movie' : 'search');
                url = addQuery(url, [
                    { name: 't', value: t },
                    { name: 'q', value: q },
                    { name: 'apikey', value: source.key },
                    { name: 'cat', value: cats.join(',') },
                    { name: 'imdbid', value: imdb },
                    { name: 'season', value: ep.season || '' },
                    { name: 'ep', value: ep.episode || '' },
                    { name: 'limit', value: '100' }
                ]);
                var tn = request(url, { text: true }, function (text) { ok(parseTorznab(text, source)); }, bad);
                if (tn) nets.push(tn);
            }
        } catch (e) {
            bad(e && e.message ? e.message : 'source error');
        }
        return nets;
    }

    function dedupe(items) {
        var seen = {};
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var key = item.hash || item.MagnetUri || item.Link || (item.Title + '|' + item.Size);
            if (!seen[key]) {
                seen[key] = true;
                out.push(item);
            }
        }
        return out;
    }

    function applyAudio(items) {
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var st = items[i].en_audio;
            if (cfg.audio === 'strict' && st !== true) continue;
            out.push(items[i]);
        }
        if (cfg.audio === 'prefer') {
            out.sort(function (a, b) {
                var ra = a.en_audio === true ? 0 : (a.en_audio === null ? 1 : 2);
                var rb = b.en_audio === true ? 0 : (b.en_audio === null ? 1 : 2);
                if (ra !== rb) return ra - rb;
                return (b.Seeders || 0) - (a.Seeders || 0);
            });
        }
        return out;
    }

    function cardKey(params) {
        var movie = (params && params.movie) || {};
        return String(movie.id || '') + ':' + (movie.number_of_seasons || movie.original_name ? 'tv' : 'movie') + ':' + queryFor(params);
    }

    function runExternal(params, callback, force) {
        readConfig();
        var kinds = allowedKinds(params);
        var active = [];
        for (var i = 0; i < sources.length; i++) {
            if (force ? sources[i].enabled : sourceMatches(sources[i], kinds)) active.push(sources[i]);
        }
        var id = ++state.searchSeq;
        var search = { id: id, canceled: false, nets: [], timer: null, pending: active.length, items: [], errors: [], done: false };
        state.searches[id] = search;

        function finish() {
            if (search.done || search.canceled) return;
            search.done = true;
            clearTimeout(search.timer);
            delete state.searches[id];
            var items = applyAudio(dedupe(search.items));
            state.last = {
                time: Date.now(),
                query: queryFor(params),
                found: items.length,
                errors: search.errors.slice(),
                sources: active.length
            };
            callback({ Results: items, errors: search.errors });
        }

        search.timer = setTimeout(finish, cfg.timeout * 1000 + 3000);

        if (!active.length) {
            search.errors.push('Нет активных источников для этой категории');
            finish();
            return id;
        }

        for (var j = 0; j < active.length; j++) {
            (function (source) {
                var nets = runSource(source, params, function (items) {
                    search.items = search.items.concat(items || []);
                    search.pending--;
                    if (search.pending <= 0) finish();
                }, function (msg) {
                    search.errors.push(source.name + ': ' + msg);
                    search.pending--;
                    if (search.pending <= 0) finish();
                });
                if (nets && nets.length) search.nets = search.nets.concat(nets);
            })(active[j]);
        }
        return id;
    }

    function cancelSearches() {
        for (var id in state.searches) {
            if (!Object.prototype.hasOwnProperty.call(state.searches, id)) continue;
            var s = state.searches[id];
            s.canceled = true;
            clearTimeout(s.timer);
            for (var i = 0; i < s.nets.length; i++) { try { s.nets[i].clear(); } catch (e) {} }
        }
        state.searches = {};
    }

    function follow(target, event, fn) {
        if (!target || !target.follow) return;
        target.follow(event, fn);
        state.listeners.push({ target: target, event: event, fn: fn });
    }

    function removeListeners() {
        for (var i = 0; i < state.listeners.length; i++) {
            var l = state.listeners[i];
            try { if (l.target.remove) l.target.remove(l.event, l.fn); } catch (e) {}
        }
        state.listeners = [];
    }

    function coreVersion() {
        try {
            if (Lampa.Manifest && Lampa.Manifest.app_version) return String(Lampa.Manifest.app_version);
            if (Lampa.Manifest && Lampa.Manifest.app_digital) return String(Lampa.Manifest.app_digital);
        } catch (e) {}
        return 'не определена';
    }

    function neutralizeOldVersion() {
        try {
            if (Lampa.Parser && Lampa.Parser._en_sources_hooked && !Lampa.Parser.__en_sources_v2) {
                Lampa.Storage.set('en_sources_enabled', 'false');
                warn('Обнаружена старая версия 1.0.x. Она отключена; перезапустите Lampa, чтобы убрать её пункты настроек.');
            }
        } catch (e) {}
    }

    function wrapParser() {
        if (state.hooked) return true;
        if (!window.Lampa || !Lampa.Parser || typeof Lampa.Parser.get !== 'function') return false;

        neutralizeOldVersion();
        state.originalGet = Lampa.Parser.get;
        state.originalClear = Lampa.Parser.clear;

        Lampa.Parser.get = function (params, oncomplite, onerror) {
            var self = this;
            var original = state.originalGet;
            readConfig();

            var kinds = allowedKinds(params || {});
            var has = false;
            for (var i = 0; i < sources.length; i++) if (sourceMatches(sources[i], kinds)) has = true;

            if (!cfg.enabled || !has) return original.call(self, params, oncomplite, onerror);

            var called = false;
            var externalDone = false;
            var standardDone = !cfg.merge;
            var external = { Results: [], errors: [] };
            var standard = null;
            var key = cardKey(params || {});

            var guard = setTimeout(function () { finish(true); }, cfg.timeout * 1000 + 5000);

            function deliver(data) {
                if (called) return;
                called = true;
                clearTimeout(guard);
                state.lastByCard[key] = data;
                try { oncomplite(data); } catch (e) { warn('oncomplite', e); }
            }

            function finish(force) {
                if (called) return;
                if (!externalDone && !force) return;
                if (!standardDone && !force) return;

                var results = [];
                if (cfg.merge && standard && standard.Results) results = results.concat(standard.Results);
                results = results.concat(external.Results || []);
                results = applyAudio(dedupe(results));

                if (!results.length && !cfg.merge && cfg.fallback) {
                    called = true;
                    clearTimeout(guard);
                    try { return original.call(self, params, oncomplite, onerror); } catch (e) {
                        warn('fallback', e);
                        try { onerror(e && e.message ? e.message : 'fallback error'); } catch (err) {}
                    }
                }

                deliver({ Results: results });
                if (cfg.notify && external.errors && external.errors.length) notify('EN Sources: ' + external.errors.join('; '));
            }

            runExternal(params || {}, function (data) {
                external = data;
                externalDone = true;
                finish(false);
            }, false);

            if (cfg.merge) {
                try {
                    original.call(self, params, function (data) {
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
            cancelSearches();
            if (state.originalClear) return state.originalClear.apply(this, arguments);
        };

        Lampa.Parser.__en_sources_v2 = true;
        state.hooked = true;
        api.status = 'ready';
        log('Parser.get подключен. Ядро Lampa:', coreVersion());
        return true;
    }

    function wrapTorrentComponent() {
        try {
            if (!Lampa.Component || !Lampa.Component.get || !Lampa.Component.add) return;
            var Original = Lampa.Component.get('torrents');
            if (!Original || Original.__en_sources_v2) return;
            state.originalTorrents = Original;

            function Wrapped(object) {
                Original.call(this, object);
                var sortResults = this.sortResults;
                if (typeof sortResults !== 'function') return;
                var key = cardKey(object || {});
                this.sortResults = function (need) {
                    sortResults.call(this, need);
                    readConfig();
                    if (!cfg.enabled || cfg.audio !== 'prefer' || need !== 'popular') return;
                    var data = state.lastByCard[key];
                    if (data && data.Results) {
                        for (var si = 0; si < data.Results.length; si++) data.Results[si].__en_sort_index = si;
                        data.Results.sort(function (a, b) {
                            var ra = a.en_audio === true ? 0 : (a.en_audio === null ? 1 : 2);
                            var rb = b.en_audio === true ? 0 : (b.en_audio === null ? 1 : 2);
                            if (ra !== rb) return ra - rb;
                            return (a.__en_sort_index || 0) - (b.__en_sort_index || 0);
                        });
                    }
                };
            }
            Wrapped.__en_sources_v2 = true;
            if (Original.prototype) Wrapped.prototype = Original.prototype;
            Lampa.Component.add('torrents', Wrapped);
        } catch (e) {
            warn('component wrap', e);
        }
    }

    function onTorrentRender(e) {
        try {
            if (!e || e.type !== 'render' || !e.element || !e.element.en_sources_v2 || !e.item) return;
            var el = e.element;
            if (e.item.find && e.item.find('.en-sources-tags').length) return;
            var audio = el.en_audio === true ? 'EN' : (el.en_audio === false ? 'не EN' : 'язык ?');
            var cls = el.en_audio === true ? 'en' : (el.en_audio === false ? 'other' : 'unknown');
            var html = '<div class="en-sources-tags">' +
                '<span class="en-sources-tag en-sources-tag--source">' + esc(el.en_source_name || 'EN Sources') + '</span>' +
                '<span class="en-sources-tag en-sources-tag--' + cls + '">' + esc(audio) + '</span>' +
                '</div>';
            var target = e.item.find ? e.item.find('.torrent-item__title').first() : null;
            if (target && target.length) target.after(html);
            else if (e.item.append) e.item.append(html);
        } catch (err) {}
    }

    function addStyle() {
        if (document.getElementById('en-sources-v2-style')) return;
        var style = document.createElement('style');
        style.id = 'en-sources-v2-style';
        style.type = 'text/css';
        style.appendChild(document.createTextNode([
            '.en-sources-head{width:auto!important;min-width:3.4em;padding:0 .6em!important;display:-webkit-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-ms-flex-align:center;align-items:center;gap:.35em;border-radius:.7em;color:#94a3b8;border:1px solid rgba(148,163,184,.25);background:rgba(15,23,42,.55);transition:color .2s,background .2s,border-color .2s}',
            '.en-sources-head svg{width:1.25em;height:1.25em;flex:0 0 auto}',
            '.en-sources-head__label{font-size:.72em;font-weight:800;letter-spacing:.08em;line-height:1}',
            '.en-sources-head.is-on{color:#5eead4;border-color:rgba(45,212,191,.65);background:rgba(13,148,136,.18);box-shadow:0 0 1em rgba(20,184,166,.25)}',
            '.en-sources-head.focus,.en-sources-head:hover{color:#f8fafc;border-color:#2dd4bf}',
            '.en-sources-tags{display:-webkit-box;display:-ms-flexbox;display:flex;-ms-flex-wrap:wrap;flex-wrap:wrap;gap:.35em;margin-top:.4em;font-size:.75em}',
            '.en-sources-tag{padding:.15em .55em;border-radius:.45em;background:rgba(148,163,184,.16);color:#cbd5e1;white-space:nowrap}',
            '.en-sources-tag--en{background:rgba(16,185,129,.2);color:#6ee7b7}',
            '.en-sources-tag--unknown{background:rgba(245,158,11,.18);color:#fcd34d}',
            '.en-sources-tag--other{background:rgba(239,68,68,.16);color:#fca5a5}',
            '.en-sources-modal{max-height:62vh;overflow:auto;padding:.2em .6em .2em 0;line-height:1.55}',
            '.en-sources-modal h3{margin:.2em 0 .5em;color:#5eead4;font-size:1.1em}',
            '.en-sources-modal p{margin:.35em 0;color:#e2e8f0}',
            '.en-sources-modal code{display:block;word-break:break-all;background:rgba(15,23,42,.7);padding:.6em;border-radius:.5em;color:#a7f3d0}',
            '.en-sources-modal::-webkit-scrollbar{width:8px}',
            '.en-sources-modal::-webkit-scrollbar-track{background:#0f172a;border-radius:8px}',
            '.en-sources-modal::-webkit-scrollbar-thumb{background:#14b8a6;border-radius:8px}',
            '.en-sources-modal::-webkit-scrollbar-thumb:hover{background:#2dd4bf}'
        ].join('\n')));
        (document.head || document.documentElement).appendChild(style);
    }

    function updateHead() {
        if (!state.head) return;
        var on = cfg.enabled;
        try {
            state.head.toggleClass('is-on', on);
            state.head.attr('title', on ? 'EN Sources: включено' : 'EN Sources: выключено');
            state.head.attr('aria-pressed', on ? 'true' : 'false');
            state.head.find('.en-sources-head__label').text(on ? 'EN ON' : 'EN OFF');
        } catch (e) {}
    }

    function toggleEnabled() {
        readConfig();
        cfg.enabled = !cfg.enabled;
        setBool(K.enabled, cfg.enabled);
        updateHead();
        refreshSettings();
        notify(cfg.enabled ? 'EN Sources включены' : 'EN Sources выключены: стандартный поиск Lampa');
    }

    function addHead() {
        if (!cfg.head || state.head) return;
        var el = null;
        try {
            if (Lampa.Head && Lampa.Head.addIcon) el = Lampa.Head.addIcon(HEAD_ICON, toggleEnabled);
        } catch (e) {}
        if (!el && $) {
            el = $('<div class="head__action selector"></div>');
            $('.head__actions').prepend(el);
            el.on('hover:enter click', toggleEnabled);
        }
        if (!el) return;
        if (el.addClass) el.addClass('en-sources-head');
        else el.className += ' en-sources-head';
        try {
            el.append('<span class="en-sources-head__label">EN OFF</span>');
        } catch (e) {}
        state.head = el;
        updateHead();
    }

    function removeHead() {
        if (!state.head) return;
        try { state.head.remove(); } catch (e) {}
        state.head = null;
    }

    function refreshSettings() {
        try {
            if (state.settingsName === COMPONENT && Lampa.Settings && Lampa.Settings.update) Lampa.Settings.update();
        } catch (e) {}
    }

    function ask(title, value, cb, password) {
        try {
            if (Lampa.Input && Lampa.Input.edit) {
                Lampa.Input.edit({ title: title, value: value || '', free: true, nosave: true, password: !!password }, function (v) {
                    cb(trim(v));
                });
                return;
            }
        } catch (e) {}
        var v = window.prompt(title, value || '');
        if (v !== null) cb(trim(v));
    }

    function restoreController(name) {
        try { Lampa.Controller.toggle(name || 'settings_component'); } catch (e) {}
    }

    function choose(title, items, onSelect, onBack) {
        var controller = 'settings_component';
        try { controller = Lampa.Controller.enabled().name || controller; } catch (e) {}
        try {
            Lampa.Select.show({
                title: title,
                items: items,
                onSelect: function (a) { onSelect(a, controller); },
                onBack: function () { if (onBack) onBack(controller); else restoreController(controller); }
            });
        } catch (e) { warn('select', e); }
    }

    function typeLabel(type) {
        if (type === 'jackett') return 'Jackett / JacRed';
        if (type === 'prowlarr') return 'Prowlarr';
        if (type === 'torznab') return 'Torznab / Newznab';
        return 'Internet Archive';
    }

    function kindLabel(kind) {
        if (kind === 'movie') return 'фильмы';
        if (kind === 'tv') return 'сериалы';
        if (kind === 'anime') return 'аниме';
        return 'все категории';
    }

    function sourceSubtitle(src) {
        var mask = src.key ? 'ключ задан' : 'без ключа';
        return typeLabel(src.type) + ' · ' + kindLabel(src.kind) + ' · ' + (src.enabled ? 'включен' : 'выключен') + ' · ' + mask;
    }

    function saveAndRefresh() {
        saveSources();
        refreshSettings();
    }

    function deleteSource(index, controller) {
        choose('Удалить источник?', [
            { title: 'Да, удалить', yes: true },
            { title: 'Отмена', no: true }
        ], function (a) {
            if (a.yes) {
                sources.splice(index, 1);
                saveAndRefresh();
                notify('Источник удалён');
            }
            restoreController(controller);
        }, function () { restoreController(controller); });
    }

    function testSource(index, controller) {
        ask('Проверочный запрос', 'Plan 9 from Outer Space', function (q) {
            if (!q) { restoreController(controller); return; }
            var src = sources[index];
            if (!src) { restoreController(controller); return; }
            notify('Проверяю ' + src.name + '...');
            var params = { search: q, from_search: true, movie: { title: q, original_title: q } };
            runSource(src, params, function (items) {
                notify(src.name + ': найдено ' + items.length);
                log('test', src.name, items.length);
                restoreController(controller);
            }, function (msg) {
                notify(src.name + ': ' + msg);
                warn('test', src.name, msg);
                restoreController(controller);
            });
        });
    }

    function sourceMenu(index) {
        var src = sources[index];
        if (!src) return;
        var items = [
            { title: 'Название', subtitle: src.name, action: 'name' },
            { title: 'Тип', subtitle: typeLabel(src.type), action: 'type' },
            { title: 'URL', subtitle: src.url || 'не задан', action: 'url' },
            { title: 'API-ключ', subtitle: src.key ? 'задан' : 'не требуется / не задан', action: 'key' },
            { title: 'Категории', subtitle: kindLabel(src.kind), action: 'kind' },
            { title: src.enabled ? 'Выключить источник' : 'Включить источник', action: 'toggle' },
            { title: 'Проверить источник', action: 'test' },
            { title: 'Удалить источник', action: 'delete' }
        ];
        if (src.type === 'archive') items.splice(5, 0, { title: 'Коллекции', subtitle: src.collections || 'все', action: 'collections' });
        choose(src.name, items, function (a, controller) {
            if (a.action === 'name') {
                ask('Название источника', src.name, function (v) {
                    if (v) src.name = v;
                    saveAndRefresh();
                    sourceMenu(index);
                });
            } else if (a.action === 'type') {
                choose('Тип источника', [
                    { title: 'Jackett / JacRed', value: 'jackett' },
                    { title: 'Prowlarr', value: 'prowlarr' },
                    { title: 'Torznab / Newznab', value: 'torznab' },
                    { title: 'Internet Archive', value: 'archive' }
                ], function (b) {
                    src.type = b.value;
                    if (src.type === 'archive' && !src.url) src.url = 'https://archive.org';
                    saveAndRefresh();
                    sourceMenu(index);
                }, function () { sourceMenu(index); });
            } else if (a.action === 'url') {
                ask('URL сервера или API endpoint', src.url, function (v) {
                    if (v && !validUrl(v)) notify('URL должен начинаться с http:// или https://');
                    else {
                        src.url = v.replace(/\/+$/, '');
                        saveAndRefresh();
                    }
                    sourceMenu(index);
                });
            } else if (a.action === 'key') {
                ask('API-ключ', src.key, function (v) {
                    src.key = v;
                    saveAndRefresh();
                    sourceMenu(index);
                }, true);
            } else if (a.action === 'kind') {
                choose('Категории источника', [
                    { title: 'Все', value: 'all' },
                    { title: 'Фильмы', value: 'movie' },
                    { title: 'Сериалы', value: 'tv' },
                    { title: 'Аниме', value: 'anime' }
                ], function (b) {
                    src.kind = b.value;
                    saveAndRefresh();
                    sourceMenu(index);
                }, function () { sourceMenu(index); });
            } else if (a.action === 'collections') {
                ask('Коллекции Internet Archive через запятую', src.collections, function (v) {
                    src.collections = v;
                    saveAndRefresh();
                    sourceMenu(index);
                });
            } else if (a.action === 'toggle') {
                src.enabled = !src.enabled;
                saveAndRefresh();
                sourceMenu(index);
            } else if (a.action === 'test') {
                testSource(index, controller);
            } else if (a.action === 'delete') {
                deleteSource(index, controller);
            }
        });
    }

    function addSource() {
        if (sources.length >= MAX_SOURCES) {
            notify('Максимум источников: ' + MAX_SOURCES);
            return;
        }
        choose('Тип нового источника', [
            { title: 'Jackett / JacRed', subtitle: 'Ваш сервер или разрешённый API', value: 'jackett' },
            { title: 'Prowlarr', subtitle: 'Ваш сервер индексаторов', value: 'prowlarr' },
            { title: 'Torznab / Newznab', subtitle: 'Совместимый RSS/API endpoint', value: 'torznab' },
            { title: 'Internet Archive', subtitle: 'Открытые коллекции', value: 'archive' }
        ], function (a) {
            var src = cleanSource({
                type: a.value,
                name: typeLabel(a.value),
                url: a.value === 'archive' ? 'https://archive.org' : '',
                enabled: true,
                kind: 'all',
                collections: a.value === 'archive' ? 'feature_films' : ''
            }, sources.length);
            sources.push(src);
            saveAndRefresh();
            sourceMenu(sources.length - 1);
        });
    }

    function modal(title, html) {
        try {
            if (!$ || !Lampa.Modal) { notify(title); return; }
            var box = $('<div class="en-sources-modal"></div>').html(html);
            var controller = 'settings_component';
            try { controller = Lampa.Controller.enabled().name || controller; } catch (e) {}
            Lampa.Modal.open({
                title: title,
                html: box,
                size: 'medium',
                onBack: function () {
                    try { Lampa.Modal.close(); } catch (e) {}
                    restoreController(controller);
                }
            });
        } catch (e) { warn('modal', e); }
    }

    function diagnosticsHtml(result) {
        var enabled = 0;
        for (var i = 0; i < sources.length; i++) if (sources[i].enabled) enabled++;
        var html = '<h3>Состояние</h3>' +
            '<p>Версия плагина: ' + esc(VERSION) + '<br>Версия веб-ядра Lampa: ' + esc(coreVersion()) + '<br>Переключатель: ' + (cfg.enabled ? 'включён' : 'выключен') + '<br>Перехват поиска: ' + (state.hooked ? 'активен' : 'не активен') + '<br>Источники: ' + enabled + ' из ' + sources.length + '</p>' +
            '<h3>Установка</h3><code>' + esc(PLUGIN_URL) + '</code>' +
            '<p>Если файл обновлён на GitHub, добавьте ?v=2 к ссылке или перезапустите Lampa.</p>';
        if (result) {
            html += '<h3>Проверка</h3><p>Запрос: ' + esc(result.query || '') + '<br>Найдено: ' + result.found + '<br>Источников опрошено: ' + result.sources + '</p>';
            if (result.errors && result.errors.length) {
                html += '<h3>Ошибки</h3>';
                for (var j = 0; j < result.errors.length; j++) html += '<p>' + esc(result.errors[j]) + '</p>';
            }
        } else if (state.last) {
            html += '<h3>Последний поиск</h3><p>' + esc(state.last.query) + ' · найдено ' + state.last.found + '</p>';
            if (state.last.errors.length) for (var k = 0; k < state.last.errors.length; k++) html += '<p>' + esc(state.last.errors[k]) + '</p>';
        }
        html += '<h3>Примечание</h3><p>Используйте только свои или разрешённые индексаторы и контент, на который у вас есть права. Строгий режим EN оставляет только раздачи с явно определённой английской дорожкой.</p>';
        return html;
    }

    function showDiagnostics(result) {
        modal('EN Sources · диагностика', diagnosticsHtml(result));
    }

    function testAll() {
        ask('Проверочный запрос', 'Plan 9 from Outer Space', function (q) {
            if (!q) return;
            notify('Проверяю источники...');
            var params = { search: q, from_search: true, movie: { title: q, original_title: q } };
            runExternal(params, function () {
                showDiagnostics(state.last);
            }, true);
        });
    }

    function exportConfig() {
        var data = { version: VERSION, sources: sources };
        var text = JSON.stringify(data, null, 2);
        try {
            if (Lampa.Utils && Lampa.Utils.copyTextToClipboard) {
                Lampa.Utils.copyTextToClipboard(text, function () { notify('Настройки скопированы'); }, function () { modal('Экспорт настроек', '<code>' + esc(text) + '</code>'); });
                return;
            }
        } catch (e) {}
        modal('Экспорт настроек', '<code>' + esc(text) + '</code>');
    }

    function importConfig() {
        ask('JSON настроек', '', function (text) {
            if (!text) return;
            try {
                var data = JSON.parse(text);
                var list = data.sources || data;
                if (Object.prototype.toString.call(list) !== '[object Array]') throw new Error('bad format');
                var out = [];
                for (var i = 0; i < list.length && out.length < MAX_SOURCES; i++) {
                    var src = cleanSource(list[i], i);
                    if (src) out.push(src);
                }
                sources = out;
                saveAndRefresh();
                notify('Настройки импортированы');
            } catch (e) {
                notify('Не удалось импортировать JSON');
            }
        });
    }

    function resetConfig() {
        choose('Сбросить настройки EN Sources?', [
            { title: 'Да, сбросить', yes: true },
            { title: 'Отмена', no: true }
        ], function (a, controller) {
            if (a.yes) {
                setBool(K.enabled, false);
                setBool(K.head, true);
                setBool(K.merge, true);
                setBool(K.fallback, true);
                setBool(K.movies, true);
                setBool(K.tv, true);
                setBool(K.anime, true);
                setBool(K.notify, false);
                try {
                    Lampa.Storage.set(K.audio, 'prefer');
                    Lampa.Storage.set(K.timeout, '20');
                    Lampa.Storage.set(K.proxy, '');
                } catch (e) {}
                sources = defaultSources();
                saveSources();
                readConfig();
                updateHead();
                refreshSettings();
                notify('EN Sources сброшены');
            }
            restoreController(controller);
        });
    }

    function registerSettings() {
        Lampa.Lang.add({
            en_sources_v2_title: L('EN Sources', 'EN Sources', 'EN Sources'),
            en_sources_v2_enabled: L('Зарубежные источники', 'Foreign sources', 'Зарубіжні джерела'),
            en_sources_v2_enabled_descr: L('ВКЛ — добавлять ваши зарубежные источники; ВЫКЛ — только стандартный поиск Lampa.', 'ON — add your foreign sources; OFF — standard Lampa search only.', 'УВІМК — додавати ваші зарубіжні джерела; ВИМК — лише стандартний пошук Lampa.'),
            en_sources_v2_head: L('Переключатель в шапке', 'Header toggle', 'Перемикач у шапці'),
            en_sources_v2_head_descr: L('Показывать кнопку EN в интерфейсе Lampa.', 'Show the EN button in the Lampa header.', 'Показувати кнопку EN в інтерфейсі Lampa.'),
            en_sources_v2_merge: L('Объединять со стандартными', 'Merge with standard results', 'Об’єднувати зі стандартними'),
            en_sources_v2_merge_descr: L('Добавлять результаты к стандартному парсеру Lampa.', 'Append results to the standard Lampa parser.', 'Додавати результати до стандартного парсера Lampa.'),
            en_sources_v2_fallback: L('Откат к стандартному поиску', 'Fallback to standard search', 'Відкат до стандартного пошуку'),
            en_sources_v2_fallback_descr: L('Если зарубежные источники ничего не нашли в режиме замены.', 'If foreign sources find nothing in replace mode.', 'Якщо зарубіжні джерела нічого не знайшли в режимі заміни.'),
            en_sources_v2_audio: L('Английская дорожка', 'English audio', 'Англійська доріжка'),
            en_sources_v2_audio_prefer: L('Предпочитать EN', 'Prefer EN', 'Надавати перевагу EN'),
            en_sources_v2_audio_strict: L('Только подтверждённый EN', 'Confirmed EN only', 'Лише підтверджений EN'),
            en_sources_v2_audio_all: L('Не фильтровать', 'Do not filter', 'Не фільтрувати'),
            en_sources_v2_audio_descr: L('Строгий режим требует метаданные языка; неизвестные раздачи скрываются.', 'Strict mode requires language metadata; unknown releases are hidden.', 'Суворий режим потребує метадані мови; невідомі роздачі приховуються.'),
            en_sources_v2_movies: L('Фильмы', 'Movies', 'Фільми'),
            en_sources_v2_tv: L('Сериалы', 'TV series', 'Серіали'),
            en_sources_v2_anime: L('Аниме', 'Anime', 'Аніме'),
            en_sources_v2_timeout: L('Таймаут источника', 'Source timeout', 'Таймаут джерела'),
            en_sources_v2_proxy: L('CORS-прокси', 'CORS proxy', 'CORS-проксі'),
            en_sources_v2_proxy_descr: L('Необязательно. Поддержка {url}. Не передавайте API-ключи через публичный прокси.', 'Optional. Supports {url}. Do not send API keys through a public proxy.', 'Необов’язково. Підтримка {url}. Не передавайте API-ключі через публічний проксі.'),
            en_sources_v2_notify: L('Уведомлять об ошибках', 'Notify about errors', 'Повідомляти про помилки'),
            en_sources_v2_sources: L('Источники', 'Sources', 'Джерела'),
            en_sources_v2_add: L('Добавить источник', 'Add source', 'Додати джерело'),
            en_sources_v2_test: L('Проверить источники', 'Test sources', 'Перевірити джерела'),
            en_sources_v2_diag: L('Диагностика', 'Diagnostics', 'Діагностика'),
            en_sources_v2_export: L('Экспорт настроек', 'Export settings', 'Експорт налаштувань'),
            en_sources_v2_import: L('Импорт настроек', 'Import settings', 'Імпорт налаштувань'),
            en_sources_v2_reset: L('Сбросить настройки', 'Reset settings', 'Скинути налаштування'),
            en_sources_v2_status: L('Состояние', 'Status', 'Стан')
        });

        var hasComponentApi = !!(Lampa.SettingsApi && Lampa.SettingsApi.addComponent);
        try {
            if (hasComponentApi) {
                Lampa.SettingsApi.addComponent({
                    component: COMPONENT,
                    name: T('en_sources_v2_title'),
                    icon: ICON
                });
            } else {
                Lampa.Template.add('settings_' + COMPONENT, '<div></div>');
            }
        } catch (e) { warn('addComponent', e); }

        if (!hasComponentApi && $) {
            follow(Lampa.Settings.listener, 'open', function (e) {
                if (!e || e.name !== 'main' || !e.body) return;
                var list = e.body.find('.scroll__body > div').first();
                if (!list.length) list = e.body;
                if (list.find('[data-component="' + COMPONENT + '"]').length) return;
                var folder = $('<div class="settings-folder selector" data-component="' + COMPONENT + '">' +
                    '<div class="settings-folder__icon">' + ICON + '</div>' +
                    '<div class="settings-folder__name">' + esc(T('en_sources_v2_title')) + '</div></div>');
                folder.on('hover:enter', function () {
                    try { Lampa.Settings.create(COMPONENT); } catch (err) { warn('Settings.create', err); }
                });
                list.append(folder);
            });
        }

        function param(name, type, def, title, descr, onChange, values) {
            var p = { name: PREFIX + name, type: type };
            if (typeof def !== 'undefined') p['default'] = def;
            if (values) p.values = values;
            var data = {
                component: COMPONENT,
                param: p,
                field: { name: title, description: descr || '' }
            };
            if (onChange) data.onChange = onChange;
            try { Lampa.SettingsApi.addParam(data); } catch (e) { warn('addParam ' + name, e); }
        }

        function trigger(name, def, title, descr, onChange) {
            param(name, 'trigger', def, title, descr, onChange);
        }

        function button(name, title, descr, onChange) {
            param(name, 'button', undefined, title, descr, onChange);
        }

        param('section_main', 'title', undefined, T('en_sources_v2_title'), '');
        trigger('enabled', false, T('en_sources_v2_enabled'), T('en_sources_v2_enabled_descr'), function () {
            readConfig();
            updateHead();
        });
        trigger('head', true, T('en_sources_v2_head'), T('en_sources_v2_head_descr'), function () {
            readConfig();
            if (cfg.head) addHead(); else removeHead();
        });
        trigger('merge', true, T('en_sources_v2_merge'), T('en_sources_v2_merge_descr'));
        trigger('fallback', true, T('en_sources_v2_fallback'), T('en_sources_v2_fallback_descr'));
        param('audio', 'select', 'prefer', T('en_sources_v2_audio'), T('en_sources_v2_audio_descr'), function () { readConfig(); }, {
            prefer: T('en_sources_v2_audio_prefer'),
            strict: T('en_sources_v2_audio_strict'),
            all: T('en_sources_v2_audio_all')
        });
        trigger('movies', true, T('en_sources_v2_movies'), '');
        trigger('tv', true, T('en_sources_v2_tv'), '');
        trigger('anime', true, T('en_sources_v2_anime'), '');
        param('timeout', 'select', '20', T('en_sources_v2_timeout'), '', function () { readConfig(); }, {
            '10': '10 сек', '15': '15 сек', '20': '20 сек', '30': '30 сек'
        });
        param('proxy', 'input', '', T('en_sources_v2_proxy'), T('en_sources_v2_proxy_descr'), function () { readConfig(); });
        trigger('notify', false, T('en_sources_v2_notify'), '');

        param('section_sources', 'title', undefined, T('en_sources_v2_sources'), '');
        button('add_source', T('en_sources_v2_add'), '', addSource);

        for (var i = 0; i < MAX_SOURCES; i++) {
            (function (index) {
                var data = {
                    component: COMPONENT,
                    param: { name: PREFIX + 'source_' + index, type: 'button' },
                    field: { name: 'Источник ' + (index + 1), description: ' ' },
                    onRender: function (item) {
                        var src = sources[index];
                        if (!src) {
                            item.addClass('hide');
                            return;
                        }
                        item.removeClass('hide');
                        item.find('.settings-param__name').text((src.enabled ? '● ' : '○ ') + src.name);
                        item.find('.settings-param__descr').text(sourceSubtitle(src));
                    },
                    onChange: function () { sourceMenu(index); }
                };
                try { Lampa.SettingsApi.addParam(data); } catch (e) { warn('source slot', e); }
            })(i);
        }

        button('test_all', T('en_sources_v2_test'), '', testAll);
        button('diagnostics', T('en_sources_v2_diag'), '', function () { showDiagnostics(null); });
        button('export', T('en_sources_v2_export'), '', exportConfig);
        button('import', T('en_sources_v2_import'), '', importConfig);
        button('reset', T('en_sources_v2_reset'), '', resetConfig);

        try {
            Lampa.SettingsApi.addParam({
                component: COMPONENT,
                param: { name: PREFIX + 'status', type: 'static' },
                field: { name: T('en_sources_v2_status'), description: ' ' },
                onRender: function (item) {
                    var enabled = 0;
                    for (var i = 0; i < sources.length; i++) if (sources[i].enabled) enabled++;
                    var text = 'v' + VERSION + ' · ядро ' + coreVersion() + ' · ' + (state.hooked ? 'поиск подключён' : 'ожидание парсера') + ' · источников ' + enabled + '/' + sources.length;
                    item.find('.settings-param__descr').text(text);
                }
            });
        } catch (e) {}

        follow(Lampa.Settings.listener, 'open', function (e) {
            state.settingsName = e.name || '';
            if (e.name === 'parser' && e.body && e.body.find) {
                e.body.find('[data-name^="en_sources_"],[data-name^="en_src_"]').not('[data-name^="en_sources_v2_"]').addClass('hide');
            }
        });
        follow(Lampa.Settings.listener, 'close', function () {
            state.settingsName = '';
        });
    }

    function onStorageChange(e) {
        if (!e || !e.name) return;
        if (e.name === K.enabled) {
            readConfig();
            updateHead();
            refreshSettings();
        } else if (e.name === K.head) {
            readConfig();
            if (cfg.head) addHead(); else removeHead();
        }
    }

    function destroy() {
        if (state.destroyed) return;
        state.destroyed = true;
        api.status = 'destroyed';
        cancelSearches();
        clearInterval(state.hookTimer);
        clearInterval(state.bootTimer);
        removeListeners();
        removeHead();
        try {
            if (state.hooked && Lampa.Parser) {
                Lampa.Parser.get = state.originalGet;
                Lampa.Parser.clear = state.originalClear;
                delete Lampa.Parser.__en_sources_v2;
            }
        } catch (e) {}
        try {
            if (state.originalTorrents && Lampa.Component && Lampa.Component.add) Lampa.Component.add('torrents', state.originalTorrents);
        } catch (e) {}
        try {
            var style = document.getElementById('en-sources-v2-style');
            if (style && style.parentNode) style.parentNode.removeChild(style);
        } catch (e) {}
        try {
            if (Lampa.SettingsApi && Lampa.SettingsApi.removeComponent) Lampa.SettingsApi.removeComponent(COMPONENT);
        } catch (e) {}
    }

    api.destroy = destroy;

    function init() {
        if (state.destroyed || api.status === 'ready') return;
        try {
            $ = window.jQuery || window.$;
            readConfig();
            loadSources();
            addStyle();
            registerSettings();
            addHead();
            follow(Lampa.Storage.listener, 'change', onStorageChange);
            follow(Lampa.Listener, 'torrent', onTorrentRender);
            wrapTorrentComponent();

            if (!wrapParser()) {
                var tries = 0;
                state.hookTimer = setInterval(function () {
                    tries++;
                    if (wrapParser() || tries >= 120 || state.destroyed) {
                        clearInterval(state.hookTimer);
                        state.hookTimer = null;
                        if (!state.hooked) {
                            api.status = 'parser-unavailable';
                            warn('Lampa.Parser.get не найден. Настройки доступны, поиск не перехвачен.');
                        }
                    }
                }, 500);
            }

            window.en_sources_plugin = true;
            api.status = state.hooked ? 'ready' : 'waiting-parser';
            log('Загружен. Раздел настроек: EN Sources. Кнопка в шапке:', cfg.head ? 'включена' : 'выключена');
        } catch (e) {
            api.status = 'error';
            warn('init', e);
        }
    }

    function boot() {
        if (state.destroyed) return;
        if (window.appready && window.Lampa) {
            init();
            return;
        }
        if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) {
            follow(Lampa.Listener, 'app', function (e) {
                if (e && e.type === 'ready') init();
            });
        }
        var waited = 0;
        state.bootTimer = setInterval(function () {
            waited++;
            if (state.destroyed) { clearInterval(state.bootTimer); return; }
            if (window.appready && window.Lampa) {
                clearInterval(state.bootTimer);
                state.bootTimer = null;
                init();
            } else if (waited >= 120) {
                clearInterval(state.bootTimer);
                state.bootTimer = null;
                warn('Lampa не инициализировалась за 60 секунд.');
            }
        }, 500);
    }

    boot();
})(window, document);
/*!
 * EN Sources 2.2.0 — модуль публичных трекеров (хвост единого файла)
 * ВСТАВКА: после строки })(window, document); первого модуля.
 * Все запросы идут через прокси (обход блокировок), зеркала YTS/EZTV.
 * Прокси берётся из поля "CORS-прокси" раздела EN Sources; по умолчанию allorigins.
 */
(function () {
    'use strict';
    if (window.en_public_plugin) return;
    window.en_public_plugin = true;

    var PREFIX = 'en_pub_';
    var DEFAULT_PROXY = 'https://api.allorigins.win/raw?url=';
    var SOURCES = [
        { id: 'torrentio', title: 'Torrentio',     def: true  },
        { id: 'nyaa',      title: 'Nyaa.si',       def: true  },
        { id: 'anidex',    title: 'AniDex',        def: false },
        { id: 'yts',       title: 'YTS',           def: true  },
        { id: 'eztv',      title: 'EZTV',          def: true  },
        { id: 'tg',        title: 'TorrentGalaxy', def: false }
    ];
    var YTS_HOSTS = ['yts.mx', 'yts.rs', 'yts.ag', 'yts.lt'];
    var EZTV_HOSTS = ['eztvx.to', 'eztv.re', 'eztv.ch'];
    var LAST = { counts: {}, errors: {}, time: 0 };
    window.__en_pub_last = LAST;

    function start() {
        var comp = 'en_sources';
        function addParam(component, param, field, onChange) {
            try {
                var d = { component: component, param: param, field: field };
                if (onChange) d.onChange = onChange;
                Lampa.SettingsApi.addParam(d);
                return true;
            } catch (e) { return false; }
        }
        try {
            Lampa.Lang.add({
                en_pub_title: { ru: 'Публичные трекеры (EN)', en: 'Public trackers (EN)', uk: 'Публічні трекери (EN)' },
                en_pub_test: { ru: 'Проверить публичные трекеры', en: 'Test public trackers', uk: 'Перевірити публічні трекери' }
            });
        } catch (e) {}
        var title = 'Публичные трекеры (EN)';
        try { title = Lampa.Lang.translate('en_pub_title'); } catch (e) {}
        if (!addParam(comp, { name: PREFIX + 'section', type: 'title' }, { name: title })) {
            comp = 'parser';
            addParam(comp, { name: PREFIX + 'section', type: 'title' }, { name: title });
        }
        addParam(comp, { name: PREFIX + 'enabled', type: 'trigger', default: true }, { name: title, description: 'Добавлять результаты публичных зарубежных трекеров к поиску' });
        SOURCES.forEach(function (s) {
            addParam(comp, { name: PREFIX + 'src_' + s.id, type: 'trigger', default: s.def }, { name: s.title });
        });
        addParam(comp, { name: PREFIX + 'test', type: 'button' }, { name: 'Проверить публичные трекеры', description: 'Покажет по каждому трекеру: найдено / ошибка' }, testPublic);
        try { window.__lampa_en_sources_v2__.public = '1.2.0'; } catch (e) {}

        function truthy(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
        function enabled() { return truthy(Lampa.Storage.get(PREFIX + 'enabled', true)); }
        function srcOn(id) {
            var def = true, i;
            for (i = 0; i < SOURCES.length; i++) if (SOURCES[i].id === id) def = SOURCES[i].def;
            var v = Lampa.Storage.get(PREFIX + 'src_' + id);
            return v === undefined || v === null ? def : truthy(v);
        }
        function proxyUrl(url) {
            var p = String(Lampa.Storage.get('en_sources_v2_proxy', '') || '');
            if (!p) p = DEFAULT_PROXY;
            if (p.indexOf('://') < 0) p = 'https://' + p;
            return p.indexOf('{url}') >= 0 ? p.replace('{url}', encodeURIComponent(url)) : p + encodeURIComponent(url);
        }
        function getText(url, cb) {
            var n = new Lampa.Reguest(); n.timeout(20000);
            n.native(proxyUrl(url), function (s) { cb(s); }, function () { cb(null); }, false, { dataType: 'text' });
        }
        function getJson(url, cb) {
            var n = new Lampa.Reguest(); n.timeout(20000);
            n.silent(proxyUrl(url), function (j) { cb(j); }, function () { cb(null); }, false, {});
        }
        function mirrorJson(hosts, path, cb) {
            var i = 0;
            function next() {
                if (i >= hosts.length) { cb(null); return; }
                var host = hosts[i++];
                getJson('https://' + host + path, function (j) {
                    if (j) cb(j); else next();
                });
            }
            next();
        }
        function parseSize(str) {
            if (str == null) return 0;
            if (typeof str === 'number') return str;
            var m = String(str).replace(',', '.').match(/([\d.]+)\s*([KMGT])?i?B/i);
            if (!m) return 0;
            var num = parseFloat(m[1]);
            if (isNaN(num)) return 0;
            var mult = { k: 1024, m: 1048576, g: 1073741824, t: 1099511627776 };
            return Math.round(num * (mult[(m[2] || '').toLowerCase()] || 1));
        }
        function audioState(t) {
            if (/\b(english|eng)\b/i.test(t)) return true;
            if (/\b(russian|rus|ukrainian|ukr|japanese|jpn|french|german|spanish)\b/i.test(t)) return false;
            return null;
        }
        function makeItem(o) {
            var hash = String(o.hash || '').toLowerCase();
            if (!hash) { var hm = String(o.magnet || '').match(/btih:([a-fA-F0-9]{40})/i); if (hm) hash = hm[1].toLowerCase(); }
            var size = typeof o.size === 'number' ? o.size : parseSize(o.size);
            var date = o.date ? new Date(o.date).getTime() : Date.now();
            if (isNaN(date)) date = Date.now();
            var human = '';
            try { if (Lampa.Utils && Lampa.Utils.bytesToSize) human = Lampa.Utils.bytesToSize(size); } catch (e) {}
            if (!human && size) human = (size / 1073741824).toFixed(2) + ' ГБ';
            var t = o.title || 'Unknown';
            return {
                Title: t, Tracker: o.tracker || 'EN',
                Seeders: parseInt(o.seeds, 10) || 0, Peers: parseInt(o.peers, 10) || 0,
                Size: size, size: human, MagnetUri: o.magnet || '', Link: o.magnet || o.link || '',
                PublishDate: date, PublisTime: date, hash: hash || o.magnet || t,
                en_public: true, en_sources_v2: true, en_source_name: o.tracker || 'EN', en_audio: audioState(t)
            };
        }
        function xmlText(node, name) {
            var all = node.getElementsByTagName('*'), i, ln;
            for (i = 0; i < all.length; i++) {
                ln = all[i].localName || String(all[i].nodeName || '').split(':').pop();
                if (ln === name) return String(all[i].textContent || all[i].text || '').replace(/^\s+|\s+$/g, '');
            }
            return '';
        }
        function parseNyaa(str) {
            var items = [];
            if (!str || typeof DOMParser === 'undefined') return items;
            try {
                var doc = new DOMParser().parseFromString(str, 'text/xml');
                var all = doc.getElementsByTagName('*'), i, ln, it, title, hash;
                for (i = 0; i < all.length; i++) {
                    ln = all[i].localName || String(all[i].nodeName || '').split(':').pop();
                    if (ln !== 'item') continue;
                    it = all[i]; title = xmlText(it, 'title'); hash = xmlText(it, 'infoHash').toLowerCase();
                    if (!hash) continue;
                    items.push(makeItem({
                        title: title, tracker: 'Nyaa', seeds: xmlText(it, 'seeders'), peers: xmlText(it, 'leechers'),
                        size: parseSize(xmlText(it, 'size')), date: xmlText(it, 'pubDate'), hash: hash,
                        magnet: 'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(title) + '&tr=' + encodeURIComponent('http://nyaa.tracker.wf:7777/announce')
                    }));
                }
            } catch (e) { console.log('[EN Public] nyaa', e); }
            return items;
        }
        function parseAnidex(json) {
            var items = [];
            var list = json && (json.length ? json : json.torrents);
            (list || []).forEach(function (t) {
                if (!t || !t.magnet) return;
                items.push(makeItem({
                    title: t.torrent_name, tracker: 'AniDex' + (t.lang_name ? ' (' + t.lang_name + ')' : ''),
                    seeds: t.seeded, peers: t.leechers, size: parseSize(t.size), date: t.date_uploaded || '', hash: t.hash, magnet: t.magnet
                }));
            });
            return items;
        }
        function parseYts(json) {
            var items = [];
            if (json && json.data && json.data.movies) json.data.movies.forEach(function (m) {
                (m.torrents || []).forEach(function (t) {
                    items.push(makeItem({
                        title: m.title + ' (' + m.year + ') [' + t.quality + '] [' + t.type + '] [YTS]', tracker: 'YTS',
                        seeds: t.seeds, peers: t.peers, size: t.size, date: t.date_uploaded || '', hash: t.hash,
                        magnet: t.url || ('magnet:?xt=urn:btih:' + t.hash)
                    }));
                });
            });
            return items;
        }
        function parseEztv(json, object) {
            var items = [], movie = object.movie || {};
            var season = parseInt(movie.season_number, 10) || 0;
            var episode = parseInt(movie.episode_number, 10) || 0;
            if (json && json.torrents) json.torrents.forEach(function (t) {
                if (season && parseInt(t.season, 10) !== season) return;
                if (episode && parseInt(t.episode, 10) !== episode) return;
                var magnet = t.torrent_url && t.torrent_url.indexOf('magnet:') === 0 ? t.torrent_url : 'magnet:?xt=urn:btih:' + t.hash;
                items.push(makeItem({
                    title: t.filename || t.title, tracker: 'EZTV', seeds: t.seeds, peers: t.peers,
                    size: parseInt(t.size_bytes, 10) || parseSize(t.small_size),
                    date: t.date_released_unix ? parseInt(t.date_released_unix, 10) * 1000 : '', hash: t.hash, magnet: magnet
                }));
            });
            return items;
        }
        function parseTorrentio(json) {
            var items = [];
            if (json && json.streams) json.streams.forEach(function (s) {
                if (!s.infoHash) return;
                var name = String(s.name || '').replace(/\n/g, ' ').replace(/^\s+|\s+$/g, '');
                var info = String(s.title || '').replace(/\n/g, ' ').replace(/^\s+|\s+$/g, '');
                var seeds = info.match(/👤\s*([\d\s.,]+)/) || info.match(/seeds?\s*:?\s*([\d\s.,]+)/i);
                var size = info.match(/💾\s*([\d.,]+\s*[KMGT]?B)/i) || info.match(/size\s*:?\s*([\d.,]+\s*[KMGT]?B)/i);
                var src = info.match(/⚙️\s*(.+)$/);
                var srcs = src ? src[1].replace(/^\s+|\s+$/g, '') : '';
                items.push(makeItem({
                    title: (name ? name + ' ' : '') + (srcs ? '— ' + srcs + ' ' : '') + '[EN]',
                    tracker: srcs ? srcs.split(':')[0].replace(/^\s+|\s+$/g, '') : 'Torrentio',
                    seeds: seeds ? parseInt(seeds[1].replace(/[^\d]/g, ''), 10) : 0,
                    size: parseSize(size ? size[1] : ''), hash: s.infoHash,
                    magnet: 'magnet:?xt=urn:btih:' + s.infoHash + (s.fileIdx !== undefined ? '&so=' + s.fileIdx : '') + '&dn=' + encodeURIComponent(name || 'EN')
                }));
            });
            return items;
        }
        function parseTG(str) {
            var items = [], $ = window.jQuery || window.$;
            if (!str || !$) return items;
            try {
                $(str).find('div.tgxtablerow, div.tgxtablelist').each(function () {
                    var row = $(this);
                    var magnet = row.find('a[href^="magnet:"]').attr('href');
                    var title = row.find('div#click a, a.txlight, div#click').first().text().replace(/^\s+|\s+$/g, '');
                    if (!magnet || !title) return;
                    items.push(makeItem({
                        title: title, tracker: 'TorrentGalaxy',
                        seeds: row.find('font[color="green"] b, span[title="Seeders"]').first().text(),
                        peers: row.find('font[color="#ff0000"] b, span[title="Leechers"]').first().text(),
                        size: parseSize(row.find('span.badge-secondary').first().text()), magnet: magnet
                    }));
                });
            } catch (e) { console.log('[EN Public] tg', e); }
            return items;
        }
        function search(object, cb) {
            var movie = object.movie || {};
            var isSeries = !!movie.number_of_seasons;
            var q = String(movie.original_title || movie.original_name || object.search || movie.title || '').replace(/^\s+|\s+$/g, '');
            var imdb = String(movie.imdb_id || '');
            if (/^\d+$/.test(imdb)) imdb = 'tt' + ('0000000' + imdb).slice(-7);
            if (!/^tt\d{7,10}$/.test(imdb)) imdb = '';
            LAST.counts = {}; LAST.errors = {}; LAST.time = Date.now();
            var tasks = [], items = [], done = 0, finished = false, safety;
            function fin() { if (finished) return; finished = true; clearTimeout(safety); cb(items); }
            function complete(res) { if (res && res.length) items = items.concat(res); done++; if (done >= tasks.length) fin(); }
            function track(id, fn) {
                return function (cb2) {
                    fn(function (res) {
                        LAST.counts[id] = (res || []).length;
                        if (!res) LAST.errors[id] = 'сеть/прокси/блокировка';
                        cb2(res);
                    });
                };
            }
            if (q) {
                if (srcOn('nyaa')) tasks.push(track('nyaa', function (c) { getText('https://nyaa.si/?page=rss&c=1_2&s=seeders&o=desc&q=' + encodeURIComponent(q), function (s) { c(parseNyaa(s)); }); }));
                if (srcOn('anidex')) tasks.push(track('anidex', function (c) { getJson('https://anidex.info/api/?q=' + encodeURIComponent(q) + '&s=seeders&o=desc', function (j) { c(parseAnidex(j)); }); }));
                if (!isSeries && srcOn('yts')) tasks.push(track('yts', function (c) { mirrorJson(YTS_HOSTS, '/api/v2/list_movies.json?query_term=' + encodeURIComponent(q) + '&limit=50', function (j) { c(parseYts(j)); }); }));
                if (srcOn('tg')) tasks.push(track('tg', function (c) { getText('https://torrentgalaxy.to/torrents.php?search=' + encodeURIComponent(q) + '&sort=seeders&order=desc', function (s) { c(parseTG(s)); }); }));
            }
            if (imdb) {
                if (srcOn('torrentio')) tasks.push(track('torrentio', function (c) {
                    var path = isSeries ? 'series/' + imdb + ':' + (parseInt(movie.season_number, 10) || 1) + ':' + (parseInt(movie.episode_number, 10) || 1) : 'movie/' + imdb;
                    getJson('https://torrentio.strem.fun/qualityfilter=480p,scr,cam,unknown/stream/' + path + '.json', function (j) { c(parseTorrentio(j)); });
                }));
                if (isSeries && srcOn('eztv')) tasks.push(track('eztv', function (c) { mirrorJson(EZTV_HOSTS, '/api/get-torrents?imdb_id=' + imdb + '&limit=100', function (j) { c(parseEztv(j, object)); }); }));
            }
            if (!tasks.length) { fin(); return; }
            safety = setTimeout(fin, 30000);
            tasks.forEach(function (t) { try { t(complete); } catch (e) { complete(null); } });
        }
        function summary() {
            var parts = [], i, s, id;
            for (i = 0; i < SOURCES.length; i++) {
                s = SOURCES[i]; id = s.id;
                if (!srcOn(id)) { parts.push(s.title + ': выкл'); continue; }
                if (LAST.errors[id]) parts.push(s.title + ': ' + LAST.errors[id]);
                else parts.push(s.title + ': ' + (LAST.counts[id] || 0));
            }
            return parts.join(' · ');
        }
        function testPublic() {
            try { Lampa.Noty.show('Проверяю публичные трекеры через прокси...'); } catch (e) {}
            search({ search: 'Plan 9 from Outer Space', movie: { title: 'Plan 9 from Outer Space', original_title: 'Plan 9 from Outer Space', imdb_id: 'tt0052077' } }, function () {
                var text = summary();
                console.log('[EN Public] test:', text);
                try { Lampa.Noty.show(text, { time: 9000 }); } catch (e) {}
                try {
                    var $ = window.jQuery || window.$;
                    if ($ && Lampa.Modal) Lampa.Modal.open({ title: 'Публичные трекеры', html: $('<div style="padding:1em;line-height:1.6">' + text.replace(/·/g, '<br>') + '</div>'), size: 'medium', onBack: function () { Lampa.Modal.close(); } });
                } catch (e) {}
            });
        }
        function hook() {
            if (!window.Lampa || !Lampa.Parser || typeof Lampa.Parser.get !== 'function') return false;
            if (Lampa.Parser._en_public_hooked) return true;
            var orig = Lampa.Parser.get;
            Lampa.Parser.get = function (object, oncomplite, onerror) {
                if (!enabled()) return orig.call(this, object, oncomplite, onerror);
                var self = this, called = false, pubDone = false, stdDone = false, pub = [], std = null;
                var guard = setTimeout(function () { finish(true); }, 35000);
                function deliver(data) { if (called) return; called = true; clearTimeout(guard); try { oncomplite(data); } catch (e) { console.log('[EN Public] oncomplite', e); } }
                function finish(force) {
                    if (called) return;
                    if (!force && (!pubDone || !stdDone)) return;
                    var res = ((std && std.Results) || []).concat(pub);
                    var seen = {}, out = [], i, k;
                    for (i = 0; i < res.length; i++) {
                        k = String(res[i].hash || res[i].MagnetUri || res[i].Title || i);
                        if (!seen[k]) { seen[k] = true; out.push(res[i]); }
                    }
                    console.log('[EN Public] results:', out.length, '(public:', pub.length + ')', summary());
                    deliver({ Results: out });
                }
                search(object, function (items) { pub = items || []; pubDone = true; finish(false); });
                try {
                    orig.call(self, object, function (data) { std = data; stdDone = true; finish(false); }, function () { stdDone = true; finish(false); });
                } catch (e) { stdDone = true; finish(false); }
            };
            Lampa.Parser._en_public_hooked = true;
            console.log('[EN Public] hooked v1.2.0 (merged into EN Sources 2.2.0)');
            return true;
        }
        var tries = 0, t = setInterval(function () { tries++; if (hook() || tries > 120) clearInterval(t); }, 500);
    }

    if (window.appready) { start(); return; }
    var booted = false;
    function go() { if (!booted) { booted = true; start(); } }
    if (window.Lampa && Lampa.Listener && Lampa.Listener.follow) Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') go(); });
    var w = 0, bt = setInterval(function () { w++; if (window.appready) { clearInterval(bt); go(); } else if (w > 120) clearInterval(bt); }, 500);
})();
