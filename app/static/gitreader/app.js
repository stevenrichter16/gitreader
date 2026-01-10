(function () {
    'use strict';

    var chapters = [
        {
            id: '1a',
            title: 'Hello, world',
            summary: 'A minimal Flask app opens the story.',
            focus: {
                id: 'flasky.app',
                name: 'app',
                kind: 'file',
                summary: 'Entry point that spins up the server.',
                signature: 'app = Flask(__name__)',
                body: "@app.route('/')\ndef index():\n    return 'Hello, world'\n\nif __name__ == '__main__':\n    app.run()",
                location: 'flasky.py:1'
            },
            nodes: [
                {
                    id: 'flasky.py',
                    name: 'flasky.py',
                    kind: 'file',
                    summary: 'Single-file application entry point.'
                },
                {
                    id: 'index',
                    name: 'index',
                    kind: 'function',
                    summary: 'Root route returning a greeting.'
                }
            ],
            edges: [
                {
                    source: 'flasky.py',
                    target: 'index',
                    kind: 'contains',
                    confidence: 'high'
                }
            ]
        },
        {
            id: '2a',
            title: 'A complete application',
            summary: 'Factory patterns and blueprints step in.',
            focus: {
                id: 'app.create_app',
                name: 'create_app',
                kind: 'function',
                summary: 'Builds the Flask app and wires extensions.',
                signature: 'def create_app(config_name):',
                body: 'app = Flask(__name__)\napp.config.from_object(config[config_name])\napp.register_blueprint(main_blueprint)',
                location: 'app/__init__.py:17'
            },
            nodes: [
                {
                    id: 'app.__init__',
                    name: 'app/__init__.py',
                    kind: 'file',
                    summary: 'Application factory and extension setup.'
                },
                {
                    id: 'main.blueprint',
                    name: 'main',
                    kind: 'class',
                    summary: 'Blueprint for main routes.'
                },
                {
                    id: 'config.Config',
                    name: 'Config',
                    kind: 'class',
                    summary: 'Base configuration values.'
                }
            ],
            edges: [
                {
                    source: 'app.__init__',
                    target: 'main.blueprint',
                    kind: 'imports',
                    confidence: 'high'
                },
                {
                    source: 'app.__init__',
                    target: 'config.Config',
                    kind: 'imports',
                    confidence: 'medium'
                }
            ]
        },
        {
            id: '2b',
            title: 'Dynamic routes',
            summary: 'Parameters flow through the URL.',
            focus: {
                id: 'main.user',
                name: 'user',
                kind: 'function',
                summary: 'Reads a name parameter and renders a greeting.',
                signature: "@main.route('/user/<name>')",
                body: "def user(name):\n    return render_template('user.html', name=name)",
                location: 'app/main/views.py:9'
            },
            nodes: [
                {
                    id: 'main.views',
                    name: 'main/views.py',
                    kind: 'file',
                    summary: 'Routes for the main blueprint.'
                },
                {
                    id: 'main.user',
                    name: 'user',
                    kind: 'function',
                    summary: 'Dynamic route with a name parameter.'
                },
                {
                    id: 'template.user',
                    name: 'user.html',
                    kind: 'file',
                    summary: 'Template that renders a greeting.'
                }
            ],
            edges: [
                {
                    source: 'main.user',
                    target: 'template.user',
                    kind: 'calls',
                    confidence: 'medium'
                }
            ]
        },
        {
            id: '3a',
            title: 'Templates',
            summary: 'Views hand data to Jinja templates.',
            focus: {
                id: 'main.index',
                name: 'index',
                kind: 'function',
                summary: 'Renders the index template with data.',
                signature: 'def index():',
                body: "return render_template('index.html', name='Stranger')",
                location: 'app/main/views.py:3'
            },
            nodes: [
                {
                    id: 'template.base',
                    name: 'base.html',
                    kind: 'file',
                    summary: 'Defines the base layout and blocks.'
                },
                {
                    id: 'template.index',
                    name: 'index.html',
                    kind: 'file',
                    summary: 'Extends the base template.'
                }
            ],
            edges: [
                {
                    source: 'template.index',
                    target: 'template.base',
                    kind: 'inherits',
                    confidence: 'high'
                }
            ]
        }
    ];

    function getElement(id) {
        var element = document.getElementById(id);
        if (!element) {
            throw new Error('Missing element: ' + id);
        }
        return element;
    }

    function GitReaderApp() {
        this.tocList = getElement('toc-list');
        this.codeSurface = getElement('code-surface');
        this.canvasGrid = getElement('canvas-grid');
        this.narratorOutput = getElement('narrator-output');
        this.modeButtons = document.querySelectorAll('.mode-btn');
        this.layoutButtons = document.querySelectorAll('.nav-btn');
        this.workspace = getElement('workspace');
        this.currentMode = 'hook';
    }

    GitReaderApp.prototype.init = function () {
        this.renderToc();
        this.bindEvents();
        if (chapters.length > 0) {
            this.loadChapter(chapters[0].id);
        }
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
    };

    GitReaderApp.prototype.renderToc = function () {
        var _this = this;
        this.tocList.innerHTML = '';
        chapters.forEach(function (chapter) {
            var item = document.createElement('li');
            item.className = 'toc-item';
            item.dataset.chapterId = chapter.id;
            item.innerHTML =
                '<div class="toc-title">' + chapter.title + '</div>' +
                '<p class="toc-summary">' + chapter.summary + '</p>';
            _this.tocList.appendChild(item);
        });
    };

    GitReaderApp.prototype.loadChapter = function (chapterId) {
        var chapter = chapters.find(function (item) { return item.id === chapterId; });
        if (!chapter) {
            return;
        }
        this.setActiveToc(chapterId);
        this.renderCode(chapter.focus);
        this.renderGraph(chapter.nodes, chapter.edges);
        this.updateNarrator(chapter.focus);
    };

    GitReaderApp.prototype.setActiveToc = function (chapterId) {
        Array.prototype.forEach.call(this.tocList.children, function (child) {
            var element = child;
            var isActive = element.dataset.chapterId === chapterId;
            element.classList.toggle('is-active', isActive);
        });
    };

    GitReaderApp.prototype.renderCode = function (symbol) {
        this.codeSurface.innerHTML =
            '<article class="code-card">' +
            '<div class="code-meta">' +
            '<span>' + symbol.kind.toUpperCase() + '</span>' +
            '<span>' + (symbol.location || 'location unknown') + '</span>' +
            '</div>' +
            '<div>' +
            '<h3>' + symbol.name + '</h3>' +
            '<p>' + symbol.summary + '</p>' +
            '</div>' +
            '<div class="code-signature">' + (symbol.signature || 'signature pending') + '</div>' +
            '<details class="code-details">' +
            '<summary>Reveal body</summary>' +
            '<pre>' + (symbol.body || '# body not loaded yet') + '</pre>' +
            '</details>' +
            '</article>';
    };

    GitReaderApp.prototype.renderGraph = function (nodes, edges) {
        var _this = this;
        this.canvasGrid.innerHTML = '';
        nodes.forEach(function (node) {
            var nodeEl = document.createElement('div');
            nodeEl.className = 'canvas-node';
            nodeEl.innerHTML =
                '<h4>' + node.name + '</h4>' +
                '<p>' + node.kind + ' - ' + node.summary + '</p>';
            _this.canvasGrid.appendChild(nodeEl);
        });

        if (edges.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'canvas-node';
            empty.innerHTML = '<h4>No edges yet</h4><p>Add relationships to reveal the map.</p>';
            this.canvasGrid.appendChild(empty);
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
        var activeChapter = this.getActiveChapter();
        if (activeChapter) {
            this.updateNarrator(activeChapter.focus);
        }
    };

    GitReaderApp.prototype.setLayout = function (layout) {
        this.workspace.dataset.layout = layout;
        this.layoutButtons.forEach(function (button) {
            button.classList.toggle('is-active', button.dataset.layout === layout);
        });
    };

    GitReaderApp.prototype.getActiveChapter = function () {
        var active = this.tocList.querySelector('.toc-item.is-active');
        if (!active) {
            return undefined;
        }
        var chapterId = active.dataset.chapterId;
        return chapters.find(function (item) { return item.id === chapterId; });
    };

    document.addEventListener('DOMContentLoaded', function () {
        var app = new GitReaderApp();
        app.init();
    });
}());
