(function () {
    'use strict';

    function getElement(id) {
        var element = document.getElementById(id);
        if (!element) {
            throw new Error('Missing element: ' + id);
        }
        return element;
    }

    function escapeHtml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function GitReaderApp() {
        this.tocList = getElement('toc-list');
        this.codeSurface = getElement('code-surface');
        this.canvasGrid = getElement('canvas-grid');
        this.narratorOutput = getElement('narrator-output');
        this.modeButtons = document.querySelectorAll('.mode-btn');
        this.layoutButtons = document.querySelectorAll('.nav-btn[data-layout]');
        this.tocModeButtons = document.querySelectorAll('.nav-btn[data-toc-mode]');
        this.narratorToggle = getElement('narrator-toggle');
        this.workspace = getElement('workspace');
        this.tocPill = getElement('toc-pill');
        this.tocSubtitle = getElement('toc-subtitle');
        this.currentMode = 'hook';
        this.tocMode = 'story';
        this.chapters = [];
        this.graphNodes = [];
        this.graphEdges = [];
        this.nodeById = new Map();
        this.snippetCache = new Map();
        this.graphCache = new Map();
        this.narratorVisible = true;
    }

    GitReaderApp.prototype.init = function () {
        var _this = this;
        this.renderLoadingState();
        this.bindEvents();
        this.updateNarratorToggle();
        this.loadData().catch(function (error) {
            var message = error instanceof Error ? error.message : 'Failed to load data.';
            _this.renderErrorState(message);
        });
    };

    GitReaderApp.prototype.loadData = function () {
        var _this = this;
        return this.loadToc(this.tocMode).then(function () {
            var defaultChapterId = _this.chapters.length > 0 ? _this.chapters[0].id : '';
            return _this.loadChapter(defaultChapterId);
        });
    };

    GitReaderApp.prototype.fetchJson = function (url) {
        return fetch(url, {
            headers: {
                Accept: 'application/json'
            }
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('Request failed: ' + response.status);
            }
            return response.json();
        });
    };

    GitReaderApp.prototype.renderLoadingState = function () {
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Loading chapters</div><p class="toc-summary">Scanning repository...</p></li>';
        this.codeSurface.innerHTML = '<article class="code-card"><h3>Loading symbols...</h3><p>Fetching graph data.</p></article>';
        this.canvasGrid.innerHTML = '<div class="canvas-node"><h4>Loading graph</h4><p>Preparing nodes and edges.</p></div>';
        this.narratorOutput.innerHTML = '<p class="eyebrow">Narrator</p><h3>Loading</h3><p>Gathering the first clues.</p>';
    };

    GitReaderApp.prototype.renderErrorState = function (message) {
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Failed to load</div><p class="toc-summary">' + escapeHtml(message) + '</p></li>';
        this.codeSurface.innerHTML = '<article class="code-card"><h3>Unable to load</h3><p>' + escapeHtml(message) + '</p></article>';
        this.canvasGrid.innerHTML = '<div class="canvas-node"><h4>No graph</h4><p>' + escapeHtml(message) + '</p></div>';
        this.narratorOutput.innerHTML = '<p class="eyebrow">Narrator</p><h3>Paused</h3><p>' + escapeHtml(message) + '</p>';
    };

    GitReaderApp.prototype.bindEvents = function () {
        var _this = this;
        this.tocList.addEventListener('click', function (event) {
            var target = event.target.closest('.toc-item');
            if (!target) {
                return;
            }
            var chapterId = target.dataset.chapterId;
            if (chapterId) {
                _this.loadChapter(chapterId);
            }
        });

        this.tocModeButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var mode = button.dataset.tocMode;
                if (mode) {
                    _this.setTocMode(mode);
                }
            });
        });

        this.canvasGrid.addEventListener('click', function (event) {
            var target = event.target.closest('.canvas-node');
            if (!target) {
                return;
            }
            var nodeId = target.dataset.nodeId;
            if (!nodeId) {
                return;
            }
            var node = _this.nodeById.get(nodeId);
            if (node) {
                _this.loadSymbolSnippet(node).catch(function () {
                    _this.renderCode(node);
                    _this.updateNarrator(node);
                });
            }
        });

        this.modeButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var mode = button.dataset.mode;
                if (mode) {
                    _this.setMode(mode);
                }
            });
        });

        this.layoutButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var layout = button.dataset.layout;
                if (layout) {
                    _this.setLayout(layout);
                }
            });
        });

        this.narratorToggle.addEventListener('click', function () {
            _this.narratorVisible = !_this.narratorVisible;
            _this.workspace.classList.toggle('is-narrator-hidden', !_this.narratorVisible);
            _this.updateNarratorToggle();
        });
    };

    GitReaderApp.prototype.setTocMode = function (mode) {
        var _this = this;
        if (this.tocMode === mode) {
            return Promise.resolve();
        }
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Loading chapters</div><p class="toc-summary">Switching TOC view...</p></li>';
        return this.loadToc(mode).then(function () {
            var defaultChapterId = _this.chapters.length > 0 ? _this.chapters[0].id : '';
            return _this.loadChapter(defaultChapterId);
        });
    };

    GitReaderApp.prototype.loadToc = function (mode) {
        var _this = this;
        var suffix = mode ? '?mode=' + encodeURIComponent(mode) : '';
        return this.fetchJson('/gitreader/api/toc' + suffix).then(function (tocData) {
            _this.chapters = Array.isArray(tocData.chapters) ? tocData.chapters : [];
            _this.tocMode = tocData.mode || mode;
            _this.updateTocModeUi();
            _this.renderToc();
        });
    };

    GitReaderApp.prototype.updateTocModeUi = function () {
        var _this = this;
        this.tocModeButtons.forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.tocMode === _this.tocMode);
        });
        var isStory = this.tocMode === 'story';
        this.tocPill.textContent = isStory ? 'story' : 'file tree';
        this.tocSubtitle.textContent = isStory
            ? 'Follow the story arc of the repository.'
            : 'Browse the repository by folder.';
    };

    GitReaderApp.prototype.renderToc = function () {
        var _this = this;
        this.tocList.innerHTML = '';
        if (this.chapters.length === 0) {
            this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">No chapters yet</div><p class="toc-summary">Scan another repository.</p></li>';
            return;
        }
        this.chapters.forEach(function (chapter) {
            var item = document.createElement('li');
            item.className = 'toc-item';
            item.dataset.chapterId = chapter.id;
            if (chapter.scope) {
                item.dataset.scope = chapter.scope;
            }
            item.innerHTML =
                '<div class="toc-title">' + escapeHtml(chapter.title) + '</div>' +
                '<p class="toc-summary">' + escapeHtml(chapter.summary) + '</p>';
            _this.tocList.appendChild(item);
        });
    };

    GitReaderApp.prototype.loadChapter = function (chapterId) {
        var _this = this;
        this.setActiveToc(chapterId);
        var chapter = this.chapters.find(function (entry) { return entry.id === chapterId; });
        var scope = (chapter && chapter.scope) || this.getScopeForChapter(chapterId);
        return this.loadGraphForScope(scope).then(function () {
            var nodes = _this.filterNodesForChapter(chapterId);
            var edges = _this.filterEdgesForNodes(nodes);
            var focus = _this.pickFocusNode(nodes);
            _this.renderGraph(nodes, edges);
            _this.loadSymbolSnippet(focus).catch(function () {
                _this.renderCode(focus);
                _this.updateNarrator(focus);
            });
        });
    };

    GitReaderApp.prototype.getScopeForChapter = function (chapterId) {
        if (chapterId && (chapterId.indexOf('group:') === 0 || chapterId.indexOf('story:') === 0)) {
            return chapterId;
        }
        return 'full';
    };

    GitReaderApp.prototype.loadGraphForScope = function (scope) {
        var _this = this;
        var cached = this.graphCache.get(scope);
        if (cached) {
            this.setGraphData(cached);
            return Promise.resolve();
        }
        var suffix = scope && scope !== 'full' ? '?scope=' + encodeURIComponent(scope) : '';
        return this.fetchJson('/gitreader/api/graph' + suffix).then(function (graphData) {
            _this.graphCache.set(scope, graphData);
            _this.setGraphData(graphData);
        });
    };

    GitReaderApp.prototype.setGraphData = function (graphData) {
        this.graphNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
        this.graphEdges = Array.isArray(graphData.edges) ? graphData.edges : [];
        this.nodeById = new Map(this.graphNodes.map(function (node) { return [node.id, node]; }));
    };

    GitReaderApp.prototype.loadSymbolSnippet = function (symbol) {
        var _this = this;
        if (!this.canFetchSnippet(symbol)) {
            this.renderCode(symbol);
            this.updateNarrator(symbol);
            return Promise.resolve();
        }
        var cached = this.snippetCache.get(symbol.id);
        if (cached) {
            this.renderCode(symbol, cached);
            this.updateNarrator(symbol);
            return Promise.resolve();
        }
        var section = this.getSnippetSection(symbol);
        return this.fetchJson('/gitreader/api/symbol?id=' + encodeURIComponent(symbol.id) + '&section=' + section)
            .then(function (response) {
                _this.snippetCache.set(symbol.id, response);
                _this.renderCode(symbol, response);
                _this.updateNarrator(symbol);
            });
    };

    GitReaderApp.prototype.getSnippetSection = function (symbol) {
        if (symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class') {
            return 'body';
        }
        return 'full';
    };

    GitReaderApp.prototype.canFetchSnippet = function (symbol) {
        if (!symbol.id) {
            return false;
        }
        if (symbol.kind === 'external') {
            return false;
        }
        return Boolean(symbol.location && symbol.location.path);
    };

    GitReaderApp.prototype.filterNodesForChapter = function (chapterId) {
        if (!chapterId || chapterId.indexOf('group:') !== 0) {
            return this.graphNodes;
        }
        var group = chapterId.slice('group:'.length);
        var filtered = this.graphNodes.filter(function (node) {
            var path = node.location && node.location.path ? node.location.path : null;
            if (!path) {
                return false;
            }
            var normalized = path.replace(/\\/g, '/');
            if (group === 'root') {
                return normalized.indexOf('/') === -1;
            }
            return normalized.indexOf(group + '/') === 0;
        });
        return filtered.length > 0 ? filtered : this.graphNodes;
    };

    GitReaderApp.prototype.filterEdgesForNodes = function (nodes) {
        var allowed = new Set(nodes.map(function (node) { return node.id; }));
        return this.graphEdges.filter(function (edge) {
            return allowed.has(edge.source) && allowed.has(edge.target);
        });
    };

    GitReaderApp.prototype.pickFocusNode = function (nodes) {
        if (nodes.length === 0) {
            return this.fallbackSymbol();
        }
        var priority = ['function', 'method', 'class', 'file', 'blueprint', 'external'];
        for (var i = 0; i < priority.length; i++) {
            var kind = priority[i];
            var match = nodes.find(function (node) { return node.kind === kind; });
            if (match) {
                return match;
            }
        }
        return nodes[0];
    };

    GitReaderApp.prototype.fallbackSymbol = function () {
        return {
            id: 'fallback',
            name: 'Repository',
            kind: 'file',
            summary: 'Select a chapter to explore symbols.'
        };
    };

    GitReaderApp.prototype.setActiveToc = function (chapterId) {
        Array.prototype.forEach.call(this.tocList.children, function (child) {
            var element = child;
            var isActive = element.dataset.chapterId === chapterId;
            element.classList.toggle('is-active', isActive);
        });
    };

    GitReaderApp.prototype.formatLocation = function (location, startLine, endLine) {
        if (!location || !location.path) {
            return 'location unknown';
        }
        if (startLine && startLine > 0) {
            var endLabel = endLine && endLine !== startLine ? '-' + endLine : '';
            return '' + location.path + ':' + startLine + endLabel;
        }
        if (location.start_line) {
            var fallbackEnd = location.end_line && location.end_line !== location.start_line
                ? '-' + location.end_line
                : '';
            return '' + location.path + ':' + location.start_line + fallbackEnd;
        }
        return location.path;
    };

    GitReaderApp.prototype.renderCode = function (symbol, snippet) {
        var summary = (snippet && snippet.summary) || symbol.summary || 'No summary yet.';
        var signature = (snippet && snippet.signature) || symbol.signature || 'signature pending';
        var displayRange = this.getDisplayRange(symbol, snippet);
        var locationLabel = this.formatLocation(symbol.location, displayRange.startLine, displayRange.endLine);
        var truncationLabel = snippet && snippet.truncated ? ' (truncated)' : '';
        var snippetHtml = this.renderSnippetLines(snippet);
        this.codeSurface.innerHTML =
            '<article class="code-card">' +
            '<div class="code-meta">' +
            '<span>' + escapeHtml(symbol.kind.toUpperCase()) + '</span>' +
            '<span>' + escapeHtml(locationLabel) + escapeHtml(truncationLabel) + '</span>' +
            '</div>' +
            '<div>' +
            '<h3>' + escapeHtml(symbol.name) + '</h3>' +
            '<p>' + escapeHtml(summary) + '</p>' +
            '</div>' +
            '<div class="code-signature">' + escapeHtml(signature) + '</div>' +
            '<details class="code-details" open>' +
            '<summary>Reveal body</summary>' +
            '<pre><code>' + snippetHtml + '</code></pre>' +
            '</details>' +
            '</article>';
    };

    GitReaderApp.prototype.getDisplayRange = function (symbol, snippet) {
        if (snippet && snippet.section === 'body' && snippet.start_line) {
            return { startLine: snippet.start_line, endLine: snippet.end_line };
        }
        if ((symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class') &&
            symbol.location && symbol.location.start_line) {
            return {
                startLine: symbol.location.start_line,
                endLine: symbol.location.end_line || (snippet && snippet.end_line) || symbol.location.start_line
            };
        }
        if (snippet && snippet.start_line) {
            return { startLine: snippet.start_line, endLine: snippet.end_line };
        }
        if (symbol.location && symbol.location.start_line) {
            return { startLine: symbol.location.start_line, endLine: symbol.location.end_line };
        }
        return {};
    };

    GitReaderApp.prototype.renderSnippetLines = function (snippet) {
        var body = (snippet && snippet.snippet) || '# body not loaded yet';
        var startLine = (snippet && snippet.start_line) || 1;
        var highlightSet = this.buildHighlightSet((snippet && snippet.highlights) || []);
        var lines = body.replace(/\n$/, '').split('\n');
        return lines.map(function (line, index) {
            var lineNumber = startLine + index;
            var isHighlighted = highlightSet.has(lineNumber);
            var classes = isHighlighted ? 'code-line is-highlight' : 'code-line';
            return '<span class="' + classes + '"><span class="line-no">' + lineNumber + '</span>' + escapeHtml(line) + '</span>';
        }).join('\n');
    };

    GitReaderApp.prototype.buildHighlightSet = function (highlights) {
        var highlightSet = new Set();
        highlights.forEach(function (range) {
            var start = Math.min(range.start_line, range.end_line);
            var end = Math.max(range.start_line, range.end_line);
            for (var line = start; line <= end; line += 1) {
                highlightSet.add(line);
            }
        });
        return highlightSet;
    };

    GitReaderApp.prototype.renderGraph = function (nodes, edges) {
        var _this = this;
        this.canvasGrid.innerHTML = '';
        if (nodes.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'canvas-node';
            empty.innerHTML = '<h4>No nodes yet</h4><p>Graph data has not loaded.</p>';
            this.canvasGrid.appendChild(empty);
            return;
        }
        nodes.forEach(function (node) {
            var nodeEl = document.createElement('div');
            nodeEl.className = 'canvas-node';
            nodeEl.dataset.nodeId = node.id;
            nodeEl.innerHTML =
                '<h4>' + escapeHtml(node.name) + '</h4>' +
                '<p>' + escapeHtml(node.kind) + ' - ' + escapeHtml(node.summary || 'No summary') + '</p>';
            _this.canvasGrid.appendChild(nodeEl);
        });

        if (edges.length === 0) {
            var emptyEdge = document.createElement('div');
            emptyEdge.className = 'canvas-node';
            emptyEdge.innerHTML = '<h4>No edges yet</h4><p>Add relationships to reveal the map.</p>';
            this.canvasGrid.appendChild(emptyEdge);
        }
    };

    GitReaderApp.prototype.updateNarrator = function (symbol) {
        var narration = this.getNarration(symbol, this.currentMode);
        this.narratorOutput.innerHTML =
            '<p class="eyebrow">' + narration.eyebrow + '</p>' +
            '<h3>' + narration.title + '</h3>' +
            narration.body;
    };

    GitReaderApp.prototype.getNarration = function (symbol, mode) {
        var name = symbol.name;
        if (mode === 'summary') {
            return {
                eyebrow: 'What it does',
                title: 'A clear role for ' + name,
                body:
                    '<p>' + name + ' brings structure to this chapter and passes context forward.</p>' +
                    '<ul>' +
                    '<li>Focuses attention on the next layer of the app.</li>' +
                    '<li>Turns configuration into action.</li>' +
                    '<li>Hints at the next extension to unlock.</li>' +
                    '</ul>'
            };
        }
        if (mode === 'key_lines') {
            return {
                eyebrow: 'Key lines',
                title: 'Lines to watch',
                body:
                    '<ul>' +
                    '<li>Line 1: the signature promises intent.</li>' +
                    '<li>Line 3: a framework call shapes control flow.</li>' +
                    '<li>Line 7: handoff to the next chapter.</li>' +
                    '</ul>'
            };
        }
        if (mode === 'connections') {
            return {
                eyebrow: 'Connections',
                title: 'How it links',
                body:
                    '<ul>' +
                    '<li>Bridges configuration into the main blueprint.</li>' +
                    '<li>Feeds data toward templates and views.</li>' +
                    '<li>Creates the seam for extensions to attach.</li>' +
                    '</ul>'
            };
        }
        if (mode === 'next') {
            return {
                eyebrow: 'Next thread',
                title: 'Where to go next',
                body: '<p>Follow the blueprint registration to see the story branch into routes.</p>'
            };
        }
        return {
            eyebrow: 'Hook',
            title: 'The quiet setup behind ' + name,
            body:
                '<p>At first glance this looks simple, but every line hints at the next reveal.</p>' +
                '<p>What happens once the request arrives?</p>'
        };
    };

    GitReaderApp.prototype.setMode = function (mode) {
        this.currentMode = mode;
        this.modeButtons.forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.mode === mode);
        });
        var chapterId = this.getActiveChapterId();
        var nodes = this.filterNodesForChapter(chapterId || '');
        var focus = this.pickFocusNode(nodes);
        this.updateNarrator(focus);
    };

    GitReaderApp.prototype.setLayout = function (layout) {
        this.workspace.dataset.layout = layout;
        this.layoutButtons.forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.layout === layout);
        });
    };

    GitReaderApp.prototype.getActiveChapterId = function () {
        var active = this.tocList.querySelector('.toc-item.is-active');
        if (!active) {
            return null;
        }
        return active.dataset.chapterId || null;
    };

    GitReaderApp.prototype.updateNarratorToggle = function () {
        this.narratorToggle.classList.toggle('is-active', this.narratorVisible);
        this.narratorToggle.setAttribute('aria-pressed', String(this.narratorVisible));
        this.narratorToggle.textContent = this.narratorVisible ? 'Narrator' : 'Narrator Off';
    };

    document.addEventListener('DOMContentLoaded', function () {
        var app = new GitReaderApp();
        app.init();
    });
}());
