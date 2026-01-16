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
        this.canvasGraph = getElement('canvas-graph');
        this.canvasOverlay = getElement('canvas-overlay');
        this.traceList = getElement('canvas-trace-list');
        this.narratorOutput = getElement('narrator-output');
        this.modeButtons = document.querySelectorAll('.mode-btn');
        this.layoutButtons = document.querySelectorAll('.nav-btn[data-layout]');
        this.tocModeButtons = document.querySelectorAll('.nav-btn[data-toc-mode]');
        this.snippetModeButtons = document.querySelectorAll('[data-snippet-mode]');
        this.graphLayoutButtons = document.querySelectorAll('[data-layout-action]');
        this.edgeFilterButtons = document.querySelectorAll('[data-edge-filter]');
        this.nodeFilterButtons = document.querySelectorAll('[data-node-filter]');
        this.graphActionButtons = document.querySelectorAll('[data-graph-action]');
        this.narratorToggle = getElement('narrator-toggle');
        this.workspace = getElement('workspace');
        this.tocPill = getElement('toc-pill');
        this.tocSubtitle = getElement('toc-subtitle');
        this.currentMode = 'hook';
        this.tocMode = 'story';
        this.snippetMode = 'body';
        this.graphLayoutMode = 'cluster';
        this.chapters = [];
        this.graphNodes = [];
        this.graphEdges = [];
        this.nodeById = new Map();
        this.fileNodesByPath = new Map();
        this.snippetCache = new Map();
        this.graphCache = new Map();
        this.narratorCache = new Map();
        this.narratorRequestToken = 0;
        this.narratorVisible = true;
        this.graphInstance = null;
        this.graphEventsBound = false;
        this.edgeFilters = new Set(['calls', 'imports', 'inherits', 'contains', 'blueprint']);
        this.showExternalNodes = true;
        this.focusedNodeId = null;
        this.tracePaths = [];
        this.selectedTraceIds = new Set();
        this.currentSymbol = null;
        this.currentSnippetText = '';
        this.maxTraceDepth = 8;
        this.maxTracePaths = 10;
    }

    GitReaderApp.prototype.init = function () {
        var _this = this;
        this.renderLoadingState();
        this.loadGraphPreferences();
        this.bindEvents();
        this.updateNarratorToggle();
        this.updateSnippetModeUi();
        this.updateGraphControls();
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

    GitReaderApp.prototype.fetchJson = function (url, init) {
        var headers = new Headers((init && init.headers) || {});
        headers.set('Accept', 'application/json');
        var options = Object.assign({}, init, { headers: headers });
        return fetch(url, options).then(function (response) {
            if (!response.ok) {
                throw new Error('Request failed: ' + response.status);
            }
            return response.json();
        });
    };

    GitReaderApp.prototype.renderLoadingState = function () {
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Loading chapters</div><p class="toc-summary">Scanning repository...</p></li>';
        this.codeSurface.innerHTML = '<article class="code-card"><h3>Loading symbols...</h3><p>Fetching graph data.</p></article>';
        this.setCanvasOverlay('Preparing nodes and edges...', true);
        this.narratorOutput.innerHTML = '<p class="eyebrow">Narrator</p><h3>Loading</h3><p>Gathering the first clues.</p>';
    };

    GitReaderApp.prototype.renderErrorState = function (message) {
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Failed to load</div><p class="toc-summary">' + escapeHtml(message) + '</p></li>';
        this.codeSurface.innerHTML = '<article class="code-card"><h3>Unable to load</h3><p>' + escapeHtml(message) + '</p></article>';
        this.setCanvasOverlay(message, true);
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

        this.snippetModeButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var mode = button.dataset.snippetMode;
                if (mode) {
                    _this.setSnippetMode(mode);
                }
            });
        });

        this.graphLayoutButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var layout = button.dataset.layoutAction;
                if (layout) {
                    _this.setGraphLayoutMode(layout);
                }
            });
        });

        this.edgeFilterButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var filter = button.dataset.edgeFilter;
                if (filter) {
                    _this.toggleEdgeFilter(filter);
                }
            });
        });

        this.nodeFilterButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var filter = button.dataset.nodeFilter;
                if (filter === 'external') {
                    _this.showExternalNodes = !_this.showExternalNodes;
                    _this.updateGraphControls();
                    _this.applyGraphFilters();
                }
            });
        });

        this.graphActionButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var action = button.dataset.graphAction;
                if (action === 'focus') {
                    _this.focusOnSelected();
                } else if (action === 'reset') {
                    _this.resetGraphFocus();
                } else if (action === 'clear-traces') {
                    _this.clearTraceSelection();
                }
            });
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
            _this.refreshGraphViewport();
        });

        this.codeSurface.addEventListener('click', function (event) {
            var target = event.target.closest('[data-reader-action]');
            if (!target) {
                return;
            }
            var action = target.dataset.readerAction;
            if (action === 'copy') {
                _this.copySnippet();
            } else if (action === 'jump') {
                _this.jumpToInputLine();
            }
        });

        this.codeSurface.addEventListener('keydown', function (event) {
            var target = event.target;
            if (event.key === 'Enter' && target.matches('[data-line-input]')) {
                event.preventDefault();
                _this.jumpToInputLine();
            }
        });

        this.traceList.addEventListener('change', function (event) {
            var target = event.target;
            if (!target || target.type !== 'checkbox') {
                return;
            }
            var traceId = target.value;
            if (target.checked) {
                _this.selectedTraceIds.add(traceId);
            } else {
                _this.selectedTraceIds.delete(traceId);
            }
            _this.applyTraceHighlight();
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
        this.focusedNodeId = null;
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
        var _this = this;
        this.graphNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
        this.graphEdges = Array.isArray(graphData.edges) ? graphData.edges : [];
        this.nodeById = new Map(this.graphNodes.map(function (node) { return [node.id, node]; }));
        this.fileNodesByPath = new Map();
        this.graphNodes.forEach(function (node) {
            if (node.kind !== 'file' || !node.location || !node.location.path) {
                return;
            }
            _this.fileNodesByPath.set(_this.normalizePath(node.location.path), node);
        });
    };

    GitReaderApp.prototype.loadSymbolSnippet = function (symbol) {
        var _this = this;
        if (!this.canFetchSnippet(symbol)) {
            this.renderCode(symbol);
            this.updateNarrator(symbol);
            return Promise.resolve();
        }
        var section = this.getSnippetSection(symbol);
        var cacheKey = symbol.id + ':' + section;
        var cached = this.snippetCache.get(cacheKey);
        if (cached) {
            this.renderCode(symbol, cached);
            this.updateNarrator(symbol);
            return Promise.resolve();
        }
        return this.fetchJson('/gitreader/api/symbol?id=' + encodeURIComponent(symbol.id) + '&section=' + section)
            .then(function (response) {
                _this.snippetCache.set(cacheKey, response);
                _this.renderCode(symbol, response);
                _this.updateNarrator(symbol);
            });
    };

    GitReaderApp.prototype.getSnippetSection = function (symbol) {
        if (this.snippetMode === 'full') {
            return 'full';
        }
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

    GitReaderApp.prototype.normalizePath = function (path) {
        return path.replace(/\\/g, '/');
    };

    GitReaderApp.prototype.getFileNodeForSymbol = function (symbol) {
        var path = symbol.location && symbol.location.path ? symbol.location.path : null;
        if (!path) {
            return null;
        }
        return this.fileNodesByPath.get(this.normalizePath(path)) || null;
    };

    GitReaderApp.prototype.isModifierClick = function (event) {
        if (!event) {
            return false;
        }
        return Boolean(event.metaKey || event.ctrlKey);
    };

    GitReaderApp.prototype.isFileNodeActive = function (fileNode) {
        var _a, _b;
        if (this.currentSymbol && this.currentSymbol.kind === 'file') {
            if (this.currentSymbol.id === fileNode.id) {
                return true;
            }
            var currentPath = (_a = this.currentSymbol.location) && _a.path;
            var filePath = (_b = fileNode.location) && _b.path;
            if (currentPath && filePath && this.normalizePath(currentPath) === this.normalizePath(filePath)) {
                return true;
            }
        }
        if (!this.graphInstance) {
            return false;
        }
        var element = this.graphInstance.$id(fileNode.id);
        return Boolean(element && typeof element.selected === 'function' && element.selected());
    };

    GitReaderApp.prototype.highlightSymbolInFile = function (fileNode, symbol) {
        var _this = this;
        if (!this.currentSymbol || this.currentSymbol.id !== fileNode.id) {
            return this.loadSymbolSnippet(fileNode)
                .catch(function () {
                    _this.renderCode(fileNode);
                    _this.updateNarrator(fileNode);
                })
                .then(function () {
                    _this.applyFocusHighlight(symbol);
                });
        }
        this.applyFocusHighlight(symbol);
        return Promise.resolve();
    };

    GitReaderApp.prototype.handleFileFocusClick = function (symbol, event) {
        if (!this.isModifierClick(event)) {
            return false;
        }
        if (symbol.kind !== 'function' && symbol.kind !== 'method') {
            return false;
        }
        var fileNode = this.getFileNodeForSymbol(symbol);
        if (!fileNode || !this.isFileNodeActive(fileNode)) {
            return false;
        }
        if (this.graphInstance) {
            this.graphInstance.$id(fileNode.id).select();
            this.graphInstance.$id(symbol.id).select();
        }
        this.highlightSymbolInFile(fileNode, symbol);
        return true;
    };

    GitReaderApp.prototype.applyFocusHighlight = function (symbol) {
        var _a, _b;
        var start = ((_a = symbol.location) && _a.start_line) || 0;
        var end = ((_b = symbol.location) && _b.end_line) || start;
        if (!start) {
            this.setCodeStatus('Line range unavailable.');
            return;
        }
        this.clearFocusHighlights();
        var firstLine = null;
        var found = false;
        for (var line = start; line <= end; line += 1) {
            var lineEl = this.codeSurface.querySelector('[data-line="' + line + '"]');
            if (!lineEl) {
                continue;
            }
            lineEl.classList.add('is-focus');
            if (!firstLine) {
                firstLine = lineEl;
            }
            found = true;
        }
        if (!found) {
            this.setCodeStatus('Selection outside snippet.');
            return;
        }
        this.setCodeStatus('Highlighted ' + symbol.name + '.');
        if (firstLine) {
            firstLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    };

    GitReaderApp.prototype.clearFocusHighlights = function () {
        var lines = this.codeSurface.querySelectorAll('.code-line.is-focus');
        Array.prototype.forEach.call(lines, function (line) {
            line.classList.remove('is-focus');
        });
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
        var revealLabel = snippet && snippet.section === 'body' ? 'Show body' : 'Show code';
        var codeClass = this.hasHighlightSupport() ? 'hljs language-python' : '';
        this.currentSymbol = symbol;
        this.currentSnippetText = (snippet && snippet.snippet) || '';
        this.codeSurface.innerHTML =
            '<article class="code-card">' +
            '<div class="code-meta">' +
            '<span>' + escapeHtml(symbol.kind.toUpperCase()) + '</span>' +
            '<span>' + escapeHtml(locationLabel) + escapeHtml(truncationLabel) + '</span>' +
            '</div>' +
            '<div class="code-actions">' +
            '<button class="ghost-btn" data-reader-action="copy">Copy snippet</button>' +
            '<div class="jump-control">' +
            '<label for="line-jump">Line</label>' +
            '<input id="line-jump" type="number" min="1" placeholder="Line" data-line-input>' +
            '<button class="ghost-btn" data-reader-action="jump">Go</button>' +
            '</div>' +
            '<span class="code-status" data-code-status></span>' +
            '</div>' +
            '<div>' +
            '<h3>' + escapeHtml(symbol.name) + '</h3>' +
            '<p>' + escapeHtml(summary) + '</p>' +
            '</div>' +
            '<div class="code-signature">' + escapeHtml(signature) + '</div>' +
            '<details class="code-details" open>' +
            '<summary>' + revealLabel + '</summary>' +
            '<pre><code class="' + codeClass + '">' + snippetHtml + '</code></pre>' +
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
        var rawBody = (snippet && snippet.snippet) || '';
        var body = rawBody.trim().length > 0 ? rawBody : '# body not loaded yet';
        var startLine = (snippet && snippet.start_line) || 1;
        var highlightSet = this.buildHighlightSet((snippet && snippet.highlights) || []);
        var rendered = this.highlightSnippet(body);
        var lines = rendered.replace(/\n$/, '').split('\n');
        return lines.map(function (line, index) {
            var lineNumber = startLine + index;
            var isHighlighted = highlightSet.has(lineNumber);
            var classes = isHighlighted ? 'code-line is-highlight' : 'code-line';
            return '<span class="' + classes + '" data-line="' + lineNumber + '"><span class="line-no">' + lineNumber + '</span>' + line + '</span>';
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
        if (nodes.length === 0) {
            this.clearGraph();
            this.setCanvasOverlay('No nodes yet. Graph data has not loaded.', true);
            return;
        }
        if (!this.graphInstance && typeof cytoscape !== 'function') {
            this.setCanvasOverlay('Graph library not loaded.', true);
            return;
        }
        this.setCanvasOverlay('', false);
        this.ensureGraph();
        var elements = this.buildGraphElements(nodes, edges);
        this.graphInstance.elements().remove();
        this.graphInstance.add(elements);
        this.resetTracePanel();
        this.runGraphLayout();
        this.applyGraphFilters();
    };

    GitReaderApp.prototype.ensureGraph = function () {
        if (this.graphInstance) {
            return;
        }
        this.graphInstance = cytoscape({
            container: this.canvasGraph,
            elements: [],
            style: this.getGraphStyles(),
            layout: { name: 'cose', animate: false, fit: true, padding: 24 },
            minZoom: 0.2,
            maxZoom: 2.5,
            wheelSensitivity: 0.2
        });
        this.bindGraphEvents();
    };

    GitReaderApp.prototype.clearGraph = function () {
        if (this.graphInstance) {
            this.graphInstance.elements().remove();
        }
    };

    GitReaderApp.prototype.bindGraphEvents = function () {
        var _this = this;
        if (this.graphEventsBound || !this.graphInstance) {
            return;
        }
        this.graphInstance.on('tap', 'node', function (event) {
            var nodeId = event.target.id();
            var node = _this.nodeById.get(nodeId);
            if (!node) {
                return;
            }
            if (_this.handleFileFocusClick(node, event.originalEvent)) {
                _this.updateCallTraces(node);
                return;
            }
            event.target.select();
            _this.loadSymbolSnippet(node).catch(function () {
                _this.renderCode(node);
                _this.updateNarrator(node);
            });
            _this.updateCallTraces(node);
        });
        this.graphEventsBound = true;
    };

    GitReaderApp.prototype.buildGraphElements = function (nodes, edges) {
        var _this = this;
        var nodeElements = nodes.map(function (node) {
            return {
                data: {
                    id: node.id,
                    label: node.name,
                    kind: node.kind,
                    summary: node.summary || ''
                }
            };
        });
        var edgeElements = edges.map(function (edge, index) {
            return {
                data: {
                    id: _this.buildEdgeId(edge, index),
                    source: edge.source,
                    target: edge.target,
                    kind: edge.kind,
                    confidence: edge.confidence
                }
            };
        });
        return nodeElements.concat(edgeElements);
    };

    GitReaderApp.prototype.buildEdgeId = function (edge, index) {
        return 'edge:' + edge.source + ':' + edge.target + ':' + edge.kind + ':' + index;
    };

    GitReaderApp.prototype.getGraphStyles = function () {
        return [
            {
                selector: 'node',
                style: {
                    'background-color': '#e9dfcf',
                    'label': 'data(label)',
                    'font-size': '11px',
                    'font-family': 'Space Grotesk, sans-serif',
                    'text-wrap': 'wrap',
                    'text-max-width': '110px',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'color': '#1e1914',
                    'border-width': 1,
                    'border-color': '#d2c2ad',
                    'padding': '8px',
                    'shape': 'round-rectangle'
                }
            },
            {
                selector: 'node[kind = "file"]',
                style: { 'background-color': '#f0dcc1' }
            },
            {
                selector: 'node[kind = "class"]',
                style: { 'background-color': '#d9e8f0' }
            },
            {
                selector: 'node[kind = "function"]',
                style: { 'background-color': '#e3f0d9' }
            },
            {
                selector: 'node[kind = "method"]',
                style: { 'background-color': '#f0e3d9' }
            },
            {
                selector: 'node[kind = "blueprint"]',
                style: { 'background-color': '#d9efe7' }
            },
            {
                selector: 'node[kind = "external"]',
                style: { 'background-color': '#efe0f0', 'border-style': 'dashed' }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-width': 2,
                    'border-color': '#237a78',
                    'shadow-blur': 12,
                    'shadow-color': '#237a78',
                    'shadow-opacity': 0.35,
                    'shadow-offset-x': 0,
                    'shadow-offset-y': 0
                }
            },
            {
                selector: 'node[trace_dimmed = "true"]',
                style: {
                    'opacity': 0.15,
                    'text-opacity': 0.15
                }
            },
            {
                selector: 'edge',
                style: {
                    'line-color': '#bcae9c',
                    'width': 1,
                    'curve-style': 'bezier',
                    'target-arrow-shape': 'triangle',
                    'target-arrow-color': '#bcae9c',
                    'opacity': 0.7
                }
            },
            {
                selector: 'edge[trace_dimmed = "true"]',
                style: {
                    'opacity': 0.1
                }
            },
            {
                selector: 'edge[kind = "calls"]',
                style: { 'line-color': '#237a78', 'target-arrow-color': '#237a78' }
            },
            {
                selector: 'edge[kind = "imports"]',
                style: { 'line-color': '#d07838', 'target-arrow-color': '#d07838' }
            },
            {
                selector: 'edge[kind = "inherits"]',
                style: { 'line-color': '#7d6ba6', 'target-arrow-color': '#7d6ba6' }
            },
            {
                selector: 'edge[kind = "contains"]',
                style: { 'line-color': '#5c4d3c', 'target-arrow-color': '#5c4d3c' }
            },
            {
                selector: 'edge[kind = "blueprint"]',
                style: { 'line-color': '#2a9d8f', 'target-arrow-color': '#2a9d8f' }
            },
            {
                selector: 'edge[confidence = "low"]',
                style: { 'line-style': 'dashed', 'opacity': 0.45 }
            }
        ];
    };

    GitReaderApp.prototype.runGraphLayout = function () {
        if (!this.graphInstance) {
            return;
        }
        var layout = this.graphInstance.layout(this.getLayoutOptions());
        layout.run();
    };

    GitReaderApp.prototype.hasHighlightSupport = function () {
        return typeof hljs !== 'undefined' && typeof hljs.highlight === 'function';
    };

    GitReaderApp.prototype.highlightSnippet = function (body) {
        if (!this.hasHighlightSupport()) {
            return escapeHtml(body);
        }
        var language = hljs.getLanguage && hljs.getLanguage('python') ? 'python' : undefined;
        if (language) {
            return hljs.highlight(body, { language: language }).value;
        }
        return hljs.highlightAuto(body).value;
    };

    GitReaderApp.prototype.setSnippetMode = function (mode) {
        var _this = this;
        if (this.snippetMode === mode) {
            return Promise.resolve();
        }
        this.snippetMode = mode;
        this.snippetCache.clear();
        this.updateSnippetModeUi();
        if (this.currentSymbol) {
            return this.loadSymbolSnippet(this.currentSymbol);
        }
        return Promise.resolve();
    };

    GitReaderApp.prototype.updateSnippetModeUi = function () {
        var _this = this;
        this.snippetModeButtons.forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.snippetMode === _this.snippetMode);
        });
    };

    GitReaderApp.prototype.copySnippet = function () {
        var _this = this;
        var text = this.currentSnippetText;
        if (!text) {
            this.setCodeStatus('Nothing to copy.');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function () { return _this.setCodeStatus('Snippet copied.'); })
                .catch(function () { return _this.setCodeStatus('Copy failed.'); });
            return;
        }
        this.setCodeStatus('Copy not supported.');
    };

    GitReaderApp.prototype.jumpToInputLine = function () {
        var input = this.codeSurface.querySelector('[data-line-input]');
        if (!input) {
            return;
        }
        var value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) {
            this.setCodeStatus('Enter a valid line number.');
            return;
        }
        this.jumpToLine(value);
    };

    GitReaderApp.prototype.jumpToLine = function (line) {
        var lineEl = this.codeSurface.querySelector('[data-line="' + line + '"]');
        if (!lineEl) {
            this.setCodeStatus('Line not in snippet.');
            return;
        }
        this.setCodeStatus('');
        lineEl.classList.add('is-jump');
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(function () { return lineEl.classList.remove('is-jump'); }, 1200);
    };

    GitReaderApp.prototype.setCodeStatus = function (message) {
        var status = this.codeSurface.querySelector('[data-code-status]');
        if (status) {
            status.textContent = message;
        }
    };

    GitReaderApp.prototype.loadGraphPreferences = function () {
        var storedLayout = window.localStorage.getItem('gitreader.graphLayoutMode');
        if (storedLayout && ['cluster', 'layer', 'free'].includes(storedLayout)) {
            this.graphLayoutMode = storedLayout;
        }
    };

    GitReaderApp.prototype.setGraphLayoutMode = function (mode) {
        if (this.graphLayoutMode === mode) {
            return;
        }
        this.graphLayoutMode = mode;
        window.localStorage.setItem('gitreader.graphLayoutMode', mode);
        this.updateGraphControls();
        this.runGraphLayout();
    };

    GitReaderApp.prototype.toggleEdgeFilter = function (filter) {
        if (this.edgeFilters.has(filter)) {
            this.edgeFilters.delete(filter);
        } else {
            this.edgeFilters.add(filter);
        }
        this.updateGraphControls();
        this.applyGraphFilters();
    };

    GitReaderApp.prototype.applyGraphFilters = function () {
        var _this = this;
        if (!this.graphInstance) {
            return;
        }
        var cy = this.graphInstance;
        cy.elements().show();
        if (!this.showExternalNodes) {
            cy.nodes().filter('[kind = "external"]').hide();
        }
        cy.edges().forEach(function (edge) {
            if (!_this.edgeFilters.has(edge.data('kind'))) {
                edge.hide();
            }
        });
        cy.edges().forEach(function (edge) {
            if (edge.source().hidden() || edge.target().hidden()) {
                edge.hide();
            }
        });
        this.applyFocus();
        this.applyTraceHighlight();
    };

    GitReaderApp.prototype.updateCallTraces = function (symbol) {
        this.tracePaths = this.buildCallTracePaths(symbol.id);
        this.selectedTraceIds.clear();
        if (this.tracePaths.length > 0) {
            this.selectedTraceIds.add(this.tracePaths[0].id);
        }
        this.renderTracePanel(symbol);
        this.applyTraceHighlight();
    };

    GitReaderApp.prototype.resetTracePanel = function () {
        this.tracePaths = [];
        this.selectedTraceIds.clear();
        this.renderTracePanel();
        this.applyTraceHighlight();
    };

    GitReaderApp.prototype.clearTraceSelection = function () {
        this.selectedTraceIds.clear();
        this.traceList.querySelectorAll('input[type="checkbox"][data-trace-id]').forEach(function (input) {
            input.checked = false;
        });
        this.applyTraceHighlight();
    };

    GitReaderApp.prototype.renderTracePanel = function (symbol) {
        if (!symbol) {
            this.traceList.innerHTML = '<p class="canvas-traces__empty">Select a node to compute call traces.</p>';
            return;
        }
        if (this.tracePaths.length === 0) {
            this.traceList.innerHTML = '\n                <p class="canvas-traces__empty">\n                    No call traces found for ' + escapeHtml(symbol.name) + '.\n                </p>\n            ';
            return;
        }
        var info = this.tracePaths.length >= this.maxTracePaths
            ? '<div class="canvas-trace-meta">Showing first ' + this.maxTracePaths + ' paths.</div>'
            : '';
        var items = this.tracePaths
            .map(function (path, index) {
            var checked = this.selectedTraceIds.has(path.id) ? 'checked' : '';
            return '\n                    <label class="canvas-trace-item">\n                        <input type="checkbox" data-trace-id="' + path.id + '" value="' + path.id + '" ' + checked + '>\n                        <span>\n                            <div class="canvas-trace-label">Path ' + (index + 1) + '</div>\n                            <div class="canvas-trace-meta">' + escapeHtml(path.label) + '</div>\n                        </span>\n                    </label>\n                ';
        }.bind(this))
            .join('');
        this.traceList.innerHTML = '' + info + items;
    };

    GitReaderApp.prototype.buildCallTracePaths = function (targetId) {
        var _this = this;
        var incomingCalls = new Map();
        this.graphEdges.forEach(function (edge, index) {
            if (edge.kind !== 'calls') {
                return;
            }
            var edgeId = _this.buildEdgeId(edge, index);
            var list = incomingCalls.get(edge.target) || [];
            list.push({ from: edge.source, edgeId: edgeId });
            incomingCalls.set(edge.target, list);
        });
        var paths = [];
        var nodeStack = [targetId];
        var edgeStack = [];
        var visited = new Set([targetId]);
        var walk = function (nodeId, depth) {
            if (paths.length >= _this.maxTracePaths) {
                return;
            }
            var incoming = incomingCalls.get(nodeId) || [];
            if (incoming.length === 0 || depth >= _this.maxTraceDepth) {
                var nodes = new Set(nodeStack);
                var edges = new Set(edgeStack);
                var label = _this.formatTraceLabel(nodeStack.slice().reverse());
                paths.push({
                    id: 'trace-' + (paths.length + 1),
                    label: label,
                    nodes: nodes,
                    edges: edges
                });
                return;
            }
            incoming.forEach(function (link) {
                if (paths.length >= _this.maxTracePaths) {
                    return;
                }
                if (visited.has(link.from)) {
                    return;
                }
                visited.add(link.from);
                nodeStack.push(link.from);
                edgeStack.push(link.edgeId);
                walk(link.from, depth + 1);
                edgeStack.pop();
                nodeStack.pop();
                visited.delete(link.from);
            });
        };
        walk(targetId, 0);
        return paths;
    };

    GitReaderApp.prototype.formatTraceLabel = function (nodeIds) {
        var _this = this;
        var names = nodeIds.map(function (nodeId) {
            var _a;
            return ((_a = _this.nodeById.get(nodeId)) === null || _a === void 0 ? void 0 : _a.name) || nodeId;
        });
        return names.join(' → ');
    };

    GitReaderApp.prototype.applyTraceHighlight = function () {
        if (!this.graphInstance) {
            return;
        }
        var cy = this.graphInstance;
        if (this.selectedTraceIds.size === 0 || this.tracePaths.length === 0) {
            cy.nodes().forEach(function (node) { return node.data('trace_dimmed', 'false'); });
            cy.edges().forEach(function (edge) { return edge.data('trace_dimmed', 'false'); });
            return;
        }
        var highlightedNodes = new Set();
        var highlightedEdges = new Set();
        this.tracePaths.forEach(function (path) {
            if (!this.selectedTraceIds.has(path.id)) {
                return;
            }
            path.nodes.forEach(function (nodeId) { return highlightedNodes.add(nodeId); });
            path.edges.forEach(function (edgeId) { return highlightedEdges.add(edgeId); });
        }.bind(this));
        cy.nodes().forEach(function (node) {
            var dimmed = highlightedNodes.has(node.id()) ? 'false' : 'true';
            node.data('trace_dimmed', dimmed);
        });
        cy.edges().forEach(function (edge) {
            var edgeId = edge.data('id');
            var dimmed = highlightedEdges.has(edgeId) ? 'false' : 'true';
            edge.data('trace_dimmed', dimmed);
        });
    };

    GitReaderApp.prototype.focusOnSelected = function () {
        if (!this.graphInstance) {
            return;
        }
        var selected = this.graphInstance.$('node:selected');
        if (!selected || selected.length === 0) {
            this.setCanvasOverlay('Select a node to focus.', true);
            window.setTimeout(function () { return this.setCanvasOverlay('', false); }.bind(this), 1200);
            return;
        }
        this.focusedNodeId = selected[0].id();
        this.applyGraphFilters();
    };

    GitReaderApp.prototype.resetGraphFocus = function () {
        this.focusedNodeId = null;
        this.applyGraphFilters();
        this.refreshGraphViewport();
    };

    GitReaderApp.prototype.applyFocus = function () {
        if (!this.graphInstance || !this.focusedNodeId) {
            return;
        }
        var cy = this.graphInstance;
        var node = cy.getElementById(this.focusedNodeId);
        if (!node || node.empty() || node.hidden()) {
            this.focusedNodeId = null;
            return;
        }
        var visible = cy.elements(':visible');
        var focusElements = node.closedNeighborhood().intersection(visible);
        visible.not(focusElements).hide();
        cy.fit(focusElements, 40);
    };

    GitReaderApp.prototype.updateGraphControls = function () {
        var _this = this;
        this.graphLayoutButtons.forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.layoutAction === _this.graphLayoutMode);
        });
        this.edgeFilterButtons.forEach(function (button) {
            var filter = button.dataset.edgeFilter;
            if (!filter) {
                return;
            }
            button.classList.toggle('is-active', _this.edgeFilters.has(filter));
        });
        this.nodeFilterButtons.forEach(function (button) {
            if (button.dataset.nodeFilter === 'external') {
                button.classList.toggle('is-active', _this.showExternalNodes);
            }
        });
    };

    GitReaderApp.prototype.getLayoutOptions = function () {
        if (this.graphLayoutMode === 'layer') {
            return {
                name: 'breadthfirst',
                animate: false,
                fit: true,
                padding: 24,
                directed: true
            };
        }
        if (this.graphLayoutMode === 'free') {
            return {
                name: 'preset',
                animate: false,
                fit: true,
                padding: 24
            };
        }
        return {
            name: 'cose',
            animate: false,
            fit: true,
            padding: 24
        };
    };

    GitReaderApp.prototype.updateNarrator = function (symbol) {
        var _this = this;
        var mode = this.currentMode;
        var section = this.getSnippetSection(symbol);
        var cacheKey = symbol.id + ':' + mode + ':' + section;
        var cached = this.narratorCache.get(cacheKey);
        if (cached) {
            this.renderNarration(symbol, cached);
            return Promise.resolve();
        }
        var requestToken = ++this.narratorRequestToken;
        this.renderNarratorLoading(symbol);
        return this.fetchJson('/gitreader/api/narrate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: symbol.id,
                mode: mode,
                section: section
            })
        }).then(function (response) {
            if (requestToken !== _this.narratorRequestToken) {
                return;
            }
            if (!response || response.error) {
                throw new Error('Narrator unavailable.');
            }
            _this.narratorCache.set(cacheKey, response);
            _this.renderNarration(symbol, response);
        }).catch(function (error) {
            if (requestToken !== _this.narratorRequestToken) {
                return;
            }
            var message = error instanceof Error ? error.message : 'Narrator unavailable.';
            _this.renderNarratorError(symbol, message);
        });
    };

    GitReaderApp.prototype.renderNarratorLoading = function (symbol) {
        this.narratorOutput.innerHTML =
            '<p class="eyebrow">Narrator</p>' +
            '<h3>Listening to ' + escapeHtml(symbol.name) + '</h3>' +
            '<p>Drafting the next beat in the story.</p>';
    };

    GitReaderApp.prototype.renderNarratorError = function (symbol, message) {
        this.narratorOutput.innerHTML =
            '<p class="eyebrow">Narrator</p>' +
            '<h3>Unable to narrate ' + escapeHtml(symbol.name) + '</h3>' +
            '<p>' + escapeHtml(message) + '</p>';
    };

    GitReaderApp.prototype.renderNarration = function (symbol, narration) {
        var formatted = this.formatNarration(symbol, narration, this.currentMode);
        this.narratorOutput.innerHTML =
            '<p class="eyebrow">' + formatted.eyebrow + '</p>' +
            '<h3>' + formatted.title + '</h3>' +
            formatted.body;
    };

    GitReaderApp.prototype.formatNarration = function (symbol, narration, mode) {
        var name = escapeHtml(symbol.name);
        if (mode === 'summary') {
            var items = (narration.summary || []).map(function (item) { return escapeHtml(item); });
            var body = items.length > 0
                ? '<ul>' + items.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>'
                : '<p>No summary yet for ' + name + '.</p>';
            return {
                eyebrow: 'What it does',
                title: 'A clear role for ' + name,
                body: body
            };
        }
        if (mode === 'key_lines') {
            var lines = narration.key_lines || [];
            var body = lines.length > 0
                ? '<ul>' + lines.map(function (line) {
                    var label = 'Line ' + line.line + ': ' + line.text;
                    return '<li>' + escapeHtml(label) + '</li>';
                }).join('') + '</ul>'
                : '<p>No key lines captured yet.</p>';
            return {
                eyebrow: 'Key lines',
                title: 'Lines to watch in ' + name,
                body: body
            };
        }
        if (mode === 'connections') {
            var items = (narration.connections || []).map(function (item) { return escapeHtml(item); });
            var body = items.length > 0
                ? '<ul>' + items.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>'
                : '<p>Connections are still being mapped.</p>';
            return {
                eyebrow: 'Connections',
                title: 'How ' + name + ' links',
                body: body
            };
        }
        if (mode === 'next') {
            var thread = narration.next_thread ? escapeHtml(narration.next_thread) : 'No next thread yet.';
            return {
                eyebrow: 'Next thread',
                title: 'Where to go next',
                body: '<p>' + thread + '</p>'
            };
        }
        var hook = narration.hook ? escapeHtml(narration.hook) : 'A quiet setup around ' + name + '.';
        return {
            eyebrow: 'Hook',
            title: 'The quiet setup behind ' + name,
            body: '<p>' + hook + '</p>'
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
        this.refreshGraphViewport();
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

    GitReaderApp.prototype.setCanvasOverlay = function (message, visible) {
        this.canvasOverlay.textContent = message;
        this.canvasOverlay.classList.toggle('is-visible', visible);
    };

    GitReaderApp.prototype.refreshGraphViewport = function () {
        if (!this.graphInstance) {
            return;
        }
        this.graphInstance.resize();
        this.graphInstance.fit();
    };

    document.addEventListener('DOMContentLoaded', function () {
        var app = new GitReaderApp();
        app.init();
    });
}());
