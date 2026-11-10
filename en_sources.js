/*!
 * Lampa English Torrent Sources v1.0.1
 * ------------------------------------------------------------------
 * Плагин добавляет зарубежные торрент-источники с контентом
 * на английском языке: Nyaa.si, AniDex, YTS, EZTV, Torrentio,
 * TorrentGalaxy.
 *
 * Переключатель "Зарубежные источники (EN)" в Настройки -> Парсер:
 *   ВЫКЛ — поиск в стандартных источниках Lampa
 *   ВКЛ  — поиск на зарубежных трекерах (можно объединять со
 *          стандартными результатами отдельным переключателем)
 *
 * Установка: Настройки -> Расширения -> Добавить плагин -> вставить
 * ссылку на этот файл (https://USERNAME.github.io/REPO/en_sources.js)
 *
 * Changelog 1.0.1:
 *   - parseTG/parseNyaa без jQuery (DOMParser + fallback)
 *   - проверка поддержки DOMParser
 *   - надёжная инициализация хука (до 60 попыток, 1 раз в секунду)
 *   - fallback-паттерны парсинга Torrentio (без эмодзи)
 *   - валидация IMDb ID
 *   - очистка страховочного таймера
 *   - весь код в try/catch, ES5-совместимость для старых Smart TV
 */

(function () {
    'use strict';

    function safeLog() {
        try {
            if (window.console && console.log) console.log.apply(console, arguments);
        } catch (e) {}
    }

    function startPlugin() {
        try {
            window.en_sources_plugin = true;

            if (window.appready) addPlugin();
            else if (window.Lampa && Lampa.Listener) {
                Lampa.Listener.follow('app', function (e) {
                    if (e.type == 'ready') addPlugin();
                });
            }
        } catch (e) {
            safeLog('[EN Sources] init error', e);
        }
    }

    function addPlugin() {
        try {
            initPlugin();
        } catch (e) {
            safeLog('[EN Sources] addPlugin error', e);
        }
    }

    function initPlugin() {

        var VERSION = '1.0.1';
        var DEFAULT_PROXY = 'https://corsproxy.io/?url=';

        // ==================== ИСТОЧНИКИ ====================

        var SOURCES = [
            { id: 'torrentio', title: 'Torrentio',     def: true,  proxy: false, descr_key: 'en_src_torrentio_descr' },
            { id: 'nyaa',      title: 'Nyaa.si',       def: true,  proxy: true,  descr_key: 'en_src_nyaa_descr' },
            { id: 'anidex',    title: 'AniDex',        def: true,  proxy: false, descr_key: 'en_src_anidex_descr' },
            { id: 'yts',       title: 'YTS',           def: true,  proxy: false, descr_key: 'en_src_yts_descr' },
            { id: 'eztv',      title: 'EZTV',          def: true,  proxy: false, descr_key: 'en_src_eztv_descr' },
            { id: 'tg',        title: 'TorrentGalaxy', def: false, proxy: true,  descr_key: 'en_src_tg_descr' }
        ];

        // ==================== ПЕРЕВОДЫ ====================

        Lampa.Lang.add({
            en_sources_section: {
                ru: 'Зарубежные источники (EN)',
                uk: 'Зарубіжні джерела (EN)',
                en: 'Foreign sources (EN)'
            },
            en_sources_enabled: {
                ru: 'Зарубежные источники',
                uk: 'Зарубіжні джерела',
                en: 'Foreign sources'
            },
            en_sources_enabled_descr: {
                ru: 'ВКЛ — искать на зарубежных трекерах с английским контентом, ВЫКЛ — стандартные источники Lampa',
                uk: 'УВІМК — шукати на зарубіжних трекерах з англійським контентом, ВИМК — стандартні джерела Lampa',
                en: 'ON — search foreign trackers with English content, OFF — standard Lampa sources'
            },
            en_sources_merge: {
                ru: 'Объединять со стандартными',
                uk: "Об'єднувати зі стандартними",
                en: 'Merge with standard results'
            },
            en_sources_merge_descr: {
                ru: 'Добавлять зарубежные торренты к результатам стандартного парсера',
                uk: 'Додавати зарубіжні торенти до результатів стандартного парсера',
                en: 'Append foreign torrents to the standard parser results'
            },
            en_sources_proxy: {
                ru: 'CORS-прокси',
                uk: 'CORS-проксі',
                en: 'CORS proxy'
            },
            en_sources_proxy_descr: {
                ru: 'Нужен для Nyaa и TorrentGalaxy в браузере/WebOS/Tizen. {url} — подстановка адреса',
                uk: 'Потрібен для Nyaa та TorrentGalaxy у браузері/WebOS/Tizen. {url} — підстановка адреси',
                en: 'Required for Nyaa and TorrentGalaxy in browser/WebOS/Tizen. {url} — address placeholder'
            },
            en_src_torrentio_descr: {
                ru: 'Кино и сериалы (агрегатор, нужен IMDb ID)',
                uk: 'Кіно та серіали (агрегатор, потрібен IMDb ID)',
                en: 'Movies and series (aggregator, IMDb ID required)'
            },
            en_src_nyaa_descr: {
                ru: 'Аниме с английским переводом (RSS)',
                uk: 'Аніме з англійським перекладом (RSS)',
                en: 'English-translated anime (RSS)'
            },
            en_src_anidex_descr: {
                ru: 'Аниме (API, английские субтитры/озвучка)',
                uk: 'Аніме (API, англійські субтитри/озвучка)',
                en: 'Anime (API, English subs/dubs)'
            },
            en_src_yts_descr: {
                ru: 'Фильмы в оригинальной английской озвучке',
                uk: 'Фільми оригінальною англійською',
                en: 'Movies in original English audio'
            },
            en_src_eztv_descr: {
                ru: 'Сериалы (нужен IMDb ID)',
                uk: 'Серіали (потрібен IMDb ID)',
                en: 'TV series (IMDb ID required)'
            },
            en_src_tg_descr: {
                ru: 'Универсальный трекер (часто блокируется, по умолчанию выключен)',
                uk: 'Універсальний трекер (часто блокується, типово вимкнено)',
                en: 'General tracker (often blocked, disabled by default)'
            }
        });

        // ==================== НАСТРОЙКИ ====================

        function T(key) { return Lampa.Lang.translate(key); }

        try {
            if (Lampa.SettingsApi && Lampa.SettingsApi.addParam) {
                Lampa.SettingsApi.addParam({
                    component: 'parser',
                    param: { name: 'en_sources_section', type: 'title' },
                    field: { name: T('en_sources_section') }
                });

                Lampa.SettingsApi.addParam({
                    component: 'parser',
                    param: { name: 'en_sources_enabled', type: 'trigger', default: false },
                    field: { name: T('en_sources_enabled'), descr: T('en_sources_enabled_descr') },
                    onChange: function () {
                        var enabled = Lampa.Storage.field('en_sources_enabled') === true;
                        if (Lampa.Noty) Lampa.Noty.show('EN Sources: ' + (enabled ? 'ON' : 'OFF'));
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'parser',
                    param: { name: 'en_sources_merge', type: 'trigger', default: true },
                    field: { name: T('en_sources_merge'), descr: T('en_sources_merge_descr') }
                });

                SOURCES.forEach(function (s) {
                    Lampa.SettingsApi.addParam({
                        component: 'parser',
                        param: { name: 'en_src_' + s.id, type: 'trigger', default: s.def },
                        field: { name: s.title, descr: T(s.descr_key) }
                    });
                });

                Lampa.SettingsApi.addParam({
                    component: 'parser',
                    param: { name: 'en_sources_proxy', type: 'input', default: DEFAULT_PROXY },
                    field: { name: T('en_sources_proxy'), descr: T('en_sources_proxy_descr') }
                });
            }
        } catch (e) {
            safeLog('[EN Sources] settings error', e);
        }

        function isEnabled() { return Lampa.Storage.field('en_sources_enabled') === true; }
        function isMerge()   { return Lampa.Storage.field('en_sources_merge') !== false; }

        function srcOn(id) {
            var def = true;
            for (var i = 0; i < SOURCES.length; i++) if (SOURCES[i].id == id) def = SOURCES[i].def;
            var v = Lampa.Storage.field('en_src_' + id);
            return v === undefined ? def : v === true;
        }

        // ==================== УТИЛИТЫ ====================

        function hasDOMParser() {
            return typeof window.DOMParser !== 'undefined';
        }

        function parseXMLDoc(str) {
            if (hasDOMParser()) {
                try { return new DOMParser().parseFromString(str, 'text/xml'); } catch (e) {}
            }
            if (window.$ && $.parseXML) {
                try { return $.parseXML(str); } catch (e) {}
            }
            safeLog('[EN Sources] XML parser not supported');
            return null;
        }

        function parseHTMLDoc(str) {
            if (hasDOMParser()) {
                try { return new DOMParser().parseFromString(str, 'text/html'); } catch (e) {}
            }
            if (window.$) {
                try { return $('<div>').html(str)[0]; } catch (e) {}
            }
            safeLog('[EN Sources] HTML parser not supported');
            return null;
        }

        function proxyUrl(url, need) {
            if (!need) return url;
            try { if (Lampa.Platform && Lampa.Platform.is('android')) return url; } catch (e) {}
            var proxy = (Lampa.Storage.field('en_sources_proxy') || DEFAULT_PROXY) + '';
            if (!proxy) return url;
            if (proxy.indexOf('://') == -1) proxy = 'https://' + proxy;
            if (proxy.indexOf('{url}') >= 0) return proxy.replace('{url}', encodeURIComponent(url));
            return proxy + encodeURIComponent(url);
        }

        function getText(url, need_proxy, cb) {
            try {
                var net = new Lampa.Reguest();
                net.timeout(15000);
                net.native(proxyUrl(url, need_proxy), function (str) { cb(str); },
                    function () { cb(null); }, false, { dataType: 'text' });
            } catch (e) { safeLog('[EN Sources] getText error', e); cb(null); }
        }

        function getJson(url, need_proxy, cb) {
            try {
                var net = new Lampa.Reguest();
                net.timeout(15000);
                net.silent(proxyUrl(url, need_proxy), function (json) { cb(json); },
                    function () { cb(null); }, false, {});
            } catch (e) { safeLog('[EN Sources] getJson error', e); cb(null); }
        }

        function parseSize(str) {
            if (str == null) return 0;
            if (typeof str === 'number') return str;
            var m = (str + '').replace(',', '.').match(/([\d.]+)\s*([KMGT])?i?B/i);
            if (!m) return 0;
            var num = parseFloat(m[1]);
            if (isNaN(num)) return 0;
            var mult = { k: 1024, m: 1048576, g: 1073741824, t: 1099511627776 };
            var u = (m[2] || '').toLowerCase();
            return Math.round(num * (mult[u] || 1));
        }

        function fmtDate(d) {
            if (!d) return '';
            var date = typeof d == 'number' ? new Date(d * (d < 1e12 ? 1000 : 1)) : new Date(d);
            if (isNaN(date.getTime())) return '';
            function p(n) { return (n < 10 ? '0' : '') + n; }
            return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate()) +
                   ' ' + p(date.getHours()) + ':' + p(date.getMinutes()) + ':' + p(date.getSeconds());
        }

        function makeItem(o) {
            var hash = (o.hash || '').toLowerCase();
            if (!hash) {
                var hm = (o.magnet || '').match(/btih:([a-fA-F0-9]{40})/i);
                if (hm) hash = hm[1].toLowerCase();
            }
            return {
                Title:       o.title || 'Unknown',
                Tracker:     o.tracker || 'EN',
                Seeders:     parseInt(o.seeds, 10) || 0,
                Peers:       parseInt(o.peers, 10) || 0,
                Size:        parseInt(o.size, 10) || 0,
                MagnetUri:   o.magnet || '',
                Link:        o.magnet || '',
                PublishDate: o.date || fmtDate(Date.now() / 1000),
                hash:        hash || o.magnet || o.title,
                en_source:   true
            };
        }

        // ==================== ПАРСЕРЫ ИСТОЧНИКОВ ====================

        function xmlText(node, name) {
            var all = node.getElementsByTagName('*');
            for (var i = 0; i < all.length; i++) {
                var ln = all[i].localName || (all[i].nodeName || '').split(':').pop();
                if (ln === name) return (all[i].textContent || all[i].text || '').replace(/^\s+|\s+$/g, '');
            }
            return '';
        }

        function parseNyaa(str) {
            var items = [];
            if (!str) return items;
            try {
                var doc = parseXMLDoc(str);
                if (!doc || !doc.getElementsByTagName) return items;
                var all = doc.getElementsByTagName('*');
                for (var i = 0; i < all.length; i++) {
                    var ln = all[i].localName || (all[i].nodeName || '').split(':').pop();
                    if (ln !== 'item') continue;
                    var it    = all[i];
                    var title = xmlText(it, 'title');
                    var hash  = xmlText(it, 'infoHash').toLowerCase();
                    if (!hash) continue;
                    items.push(makeItem({
                        title:   title,
                        tracker: 'Nyaa',
                        seeds:   xmlText(it, 'seeders'),
                        peers:   xmlText(it, 'leechers'),
                        size:    parseSize(xmlText(it, 'size')),
                        date:    fmtDate(xmlText(it, 'pubDate')),
                        hash:    hash,
                        magnet:  'magnet:?xt=urn:btih:' + hash + '&dn=' + encodeURIComponent(title) +
                                 '&tr=' + encodeURIComponent('http://nyaa.tracker.wf:7777/announce')
                    }));
                }
            } catch (e) { safeLog('[EN Sources] nyaa parse', e); }
            return items;
        }

        function parseAnidex(json) {
            var items = [];
            try {
                (json || []).forEach(function (t) {
                    if (!t || !t.magnet) return;
                    var tracker = 'AniDex';
                    if (t.lang_name) tracker += ' (' + t.lang_name + ')';
                    items.push(makeItem({
                        title:   t.torrent_name,
                        tracker: tracker,
                        seeds:   t.seeded,
                        peers:   t.leechers,
                        size:    parseSize(t.size),
                        date:    t.date_uploaded || '',
                        hash:    t.hash,
                        magnet:  t.magnet
                    }));
                });
            } catch (e) { safeLog('[EN Sources] anidex parse', e); }
            return items;
        }

        function parseYts(json) {
            var items = [];
            try {
                if (json && json.data && json.data.movies) {
                    json.data.movies.forEach(function (m) {
                        (m.torrents || []).forEach(function (t) {
                            items.push(makeItem({
                                title:   m.title + ' (' + m.year + ') [' + t.quality + '] [' + t.type + '] [YTS]',
                                tracker: 'YTS',
                                seeds:   t.seeds,
                                peers:   t.peers,
                                size:    t.size,
                                date:    t.date_uploaded || '',
                                hash:    t.hash,
                                magnet:  t.url || ('magnet:?xt=urn:btih:' + t.hash)
                            }));
                        });
                    });
                }
            } catch (e) { safeLog('[EN Sources] yts parse', e); }
            return items;
        }

        function parseEztv(json, object) {
            var items = [];
            try {
                var movie   = object.movie || {};
                var season  = movie.season_number  ? parseInt(movie.season_number, 10)  : 0;
                var episode = movie.episode_number ? parseInt(movie.episode_number, 10) : 0;
                if (json && json.torrents) {
                    json.torrents.forEach(function (t) {
                        if (season  && parseInt(t.season, 10)  != season)  return;
                        if (episode && parseInt(t.episode, 10) != episode) return;
                        var magnet = t.torrent_url && t.torrent_url.indexOf('magnet:') == 0
                            ? t.torrent_url : 'magnet:?xt=urn:btih:' + t.hash;
                        items.push(makeItem({
                            title:   t.filename || t.title,
                            tracker: 'EZTV',
                            seeds:   t.seeds,
                            peers:   t.peers,
                            size:    parseInt(t.size_bytes, 10) || parseSize(t.small_size),
                            date:    t.date_released_unix ? fmtDate(parseInt(t.date_released_unix, 10)) : '',
                            hash:    t.hash || t.torrent_info_hash,
                            magnet:  magnet
                        }));
                    });
                }
            } catch (e) { safeLog('[EN Sources] eztv parse', e); }
            return items;
        }

        function parseTorrentio(json) {
            var items = [];
            try {
                if (json && json.streams) {
                    json.streams.forEach(function (s) {
                        if (!s || !s.infoHash) return;
                        var name = (s.name || '').replace(/\n/g, ' ').replace(/^\s+|\s+$/g, '');
                        var info = (s.title || '').replace(/\n/g, ' ').replace(/^\s+|\s+$/g, '');

                        // эмодзи-паттерны + текстовые fallback'и
                        var m_seeds = info.match(/👤\s*([\d][\d\s.,]*)/) || info.match(/seeds?\s*[:=]?\s*(\d[\d\s.,]*)/i);
                        var m_size  = info.match(/💾\s*([\d.,]+\s*[KMGT]?i?B)/i) || info.match(/size\s*[:=]?\s*([\d.,]+\s*[KMGT]?i?B)/i);
                        var m_src   = info.match(/⚙️?\s*([A-Za-z0-9._ -]+:.+)$/) || info.match(/source\s*[:=]?\s*(.+)$/i);

                        var src_s   = m_src ? m_src[1].replace(/^\s+|\s+$/g, '') : '';
                        var tracker = src_s ? src_s.split(':')[0].replace(/^\s+|\s+$/g, '') : 'Torrentio';

                        items.push(makeItem({
                            title:   (name ? name + ' ' : '') + (src_s ? '- ' + src_s + ' ' : '') + '[EN]',
                            tracker: tracker,
                            seeds:   m_seeds ? parseInt((m_seeds[1] + '').replace(/[^\d]/g, ''), 10) : 0,
                            size:    parseSize(m_size ? m_size[1] : ''),
                            hash:    s.infoHash,
                            magnet:  'magnet:?xt=urn:btih:' + s.infoHash +
                                     (s.fileIdx !== undefined && s.fileIdx !== null ? '&so=' + s.fileIdx : '') +
                                     '&dn=' + encodeURIComponent(name || tracker)
                        }));
                    });
                }
            } catch (e) { safeLog('[EN Sources] torrentio parse', e); }
            return items;
        }

        function parseTG(str) {
            var items = [];
            if (!str) return items;
            try {
                var doc = parseHTMLDoc(str);
                if (!doc || !doc.querySelectorAll) return items;

                var rows = doc.querySelectorAll('.tgxtablerow, .tgxtablelist');
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];

                    var magnetEl = row.querySelector('a[href^="magnet:"]');
                    if (!magnetEl) continue;
                    var magnet = magnetEl.getAttribute('href');

                    var titleEl = row.querySelector('#click a') || row.querySelector('a.txlight') || row.querySelector('#click');
                    var title   = titleEl ? (titleEl.textContent || '').replace(/^\s+|\s+$/g, '') : '';
                    if (!title) continue;

                    var sizeEl = row.querySelector('span.badge-secondary');
                    var seedEl = row.querySelector('font[color="green"] b') || row.querySelector('span[title="Seeders"]');
                    var peerEl = row.querySelector('font[color="#ff0000"] b') || row.querySelector('span[title="Leechers"]');

                    items.push(makeItem({
                        title:   title,
                        tracker: 'TorrentGalaxy',
                        seeds:   seedEl ? (seedEl.textContent || '') : 0,
                        peers:   peerEl ? (peerEl.textContent || '') : 0,
                        size:    sizeEl ? parseSize(sizeEl.textContent) : 0,
                        magnet:  magnet
                    }));
                }
            } catch (e) { safeLog('[EN Sources] tg parse', e); }
            return items;
        }

        // ==================== ПОИСК ====================

        function validImdb(raw) {
            var imdb = (raw || '').replace(/^tt/, '').replace(/^0+/, '');
            return /^\d+$/.test(imdb) ? imdb : '';
        }

        function searchForeign(object, callback) {
            var movie     = object.movie || {};
            var is_series = !!movie.number_of_seasons;
            var query     = (movie.original_title || movie.original_name || object.search || movie.title || '').replace(/^\s+|\s+$/g, '');
            var imdb      = validImdb(movie.imdb_id);
            var tasks     = [];
            var items     = [];
            var done      = 0;
            var finished  = false;

            var safety = setTimeout(fin, 25000);

            function fin() {
                clearTimeout(safety);
                if (finished) return;
                finished = true;
                callback(items);
            }

            function addTask(fn) { tasks.push(fn); }

            function complete(res) {
                if (res && res.length) items = items.concat(res);
                done++;
                if (done >= tasks.length) fin();
            }

            if (query) {
                if (srcOn('nyaa')) addTask(function (cb) {
                    var url = 'https://nyaa.si/?page=rss&c=1_2&s=seeders&o=desc&q=' + encodeURIComponent(query);
                    getText(url, true, function (str) { cb(parseNyaa(str)); });
                });

                if (srcOn('anidex')) addTask(function (cb) {
                    var url = 'https://anidex.info/api/?q=' + encodeURIComponent(query) + '&s=seeders&o=desc';
                    getJson(url, false, function (json) { cb(parseAnidex(json)); });
                });

                if (!is_series && srcOn('yts')) addTask(function (cb) {
                    var url = 'https://yts.mx/api/v2/list_movies.json?query_term=' + encodeURIComponent(query) + '&limit=50';
                    getJson(url, false, function (json) { cb(parseYts(json)); });
                });

                if (srcOn('tg')) addTask(function (cb) {
                    var url = 'https://torrentgalaxy.to/torrents.php?search=' + encodeURIComponent(query) + '&sort=seeders&order=desc';
                    getText(url, true, function (str) { cb(parseTG(str)); });
                });
            }

            if (imdb) {
                if (srcOn('torrentio')) addTask(function (cb) {
                    var path;
                    if (is_series) {
                        var s = parseInt(movie.season_number, 10) || 1;
                        var e = parseInt(movie.episode_number, 10) || 1;
                        path = 'series/' + imdb + ':' + s + ':' + e;
                    } else {
                        path = 'movie/' + imdb;
                    }
                    var url = 'https://torrentio.strem.fun/qualityfilter=480p,scr,cam,unknown/stream/' + path + '.json';
                    getJson(url, false, function (json) { cb(parseTorrentio(json)); });
                });

                if (is_series && srcOn('eztv')) addTask(function (cb) {
                    var url = 'https://eztvx.to/api/get-torrents?imdb_id=' + imdb + '&limit=100';
                    getJson(url, false, function (json) { cb(parseEztv(json, object)); });
                });
            }

            if (!tasks.length) { fin(); return; }

            tasks.forEach(function (t) {
                try { t(complete); } catch (e) { safeLog('[EN Sources] task error', e); complete(null); }
            });
        }

        // ==================== ХУК ПАРСЕРА ====================

        function hookParser() {
            try {
                if (!window.Lampa || !Lampa.Parser || typeof Lampa.Parser.get !== 'function') return false;
                if (Lampa.Parser._en_sources_hooked) return true;

                var orig_get = Lampa.Parser.get;

                Lampa.Parser.get = function (object, oncomplite, onerror) {
                    if (!isEnabled()) return orig_get.call(Lampa.Parser, object, oncomplite, onerror);

                    try {
                        var merge = isMerge();
                        var foreign_done = false, foreign_items = [];
                        var standard_done = !merge, standard_data = null;

                        function finish() {
                            if (!foreign_done || !standard_done) return;

                            var Results = [];
                            if (merge && standard_data && standard_data.Results) Results = Results.concat(standard_data.Results);

                            if (!foreign_items.length && !Results.length && !merge) {
                                return orig_get.call(Lampa.Parser, object, oncomplite, onerror);
                            }

                            var seen = {};
                            Results = Results.concat(foreign_items).filter(function (r) {
                                var h = (r.hash || r.MagnetUri || r.Title || '') + '';
                                if (seen[h]) return false;
                                seen[h] = true;
                                return true;
                            });

                            safeLog('[EN Sources] results:', Results.length, '(foreign:', foreign_items.length + ')');
                            oncomplite({ Results: Results });
                        }

                        searchForeign(object, function (found) {
                            foreign_items = found || [];
                            foreign_done = true;
                            finish();
                        });

                        if (merge) {
                            try {
                                orig_get.call(Lampa.Parser, object, function (data) {
                                    standard_data = data;
                                    standard_done = true;
                                    finish();
                                }, function () {
                                    standard_done = true;
                                    finish();
                                });
                            } catch (e) {
                                safeLog('[EN Sources] orig parser error', e);
                                standard_done = true;
                            }
                        }
                    } catch (e) {
                        safeLog('[EN Sources] hook error', e);
                        return orig_get.call(Lampa.Parser, object, oncomplite, onerror);
                    }
                };

                Lampa.Parser._en_sources_hooked = true;
                safeLog('[EN Sources] plugin hooked, v' + VERSION);
                return true;
            } catch (e) {
                safeLog('[EN Sources] hookParser error', e);
                return false;
            }
        }

        // надёжная инициализация: до 60 попыток по 1 секунде (для медленных Smart TV)
        hookParser();
        var tries = 0;
        var try_hook = setInterval(function () {
            tries++;
            if (hookParser() || tries >= 60) clearInterval(try_hook);
        }, 1000);

        // доп. попытка после полной загрузки интерфейса
        try {
            Lampa.Listener.follow('app', function (e) {
                if (e.type == 'ready') setTimeout(hookParser, 2000);
            });
        } catch (e) {}
    }

    if (!window.en_sources_plugin) startPlugin();
})();
