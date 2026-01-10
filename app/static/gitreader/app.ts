type NarrationMode = 'hook' | 'summary' | 'key_lines' | 'connections' | 'next';

type SymbolKind = 'file' | 'class' | 'function' | 'method';

type EdgeKind = 'imports' | 'calls' | 'inherits' | 'contains' | 'blueprint';

type EdgeConfidence = 'high' | 'medium' | 'low';

interface SymbolNode {
    id: string;
    name: string;
    kind: SymbolKind;
    summary: string;
    signature?: string;
    body?: string;
    location?: string;
}

interface GraphEdge {
    source: string;
    target: string;
    kind: EdgeKind;
    confidence: EdgeConfidence;
}

interface Chapter {
    id: string;
    title: string;
    summary: string;
    focus: SymbolNode;
    nodes: SymbolNode[];
    edges: GraphEdge[];
}

class GitReaderApp {
    private tocList: HTMLElement;
    private codeSurface: HTMLElement;
    private canvasGrid: HTMLElement;
    private narratorOutput: HTMLElement;
    private modeButtons: NodeListOf<HTMLButtonElement>;
    private layoutButtons: NodeListOf<HTMLButtonElement>;
    private workspace: HTMLElement;
    private currentMode: NarrationMode = 'hook';
    private chapters: Chapter[] = [
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
                location: 'flasky.py:1',
            },
            nodes: [
                {
                    id: 'flasky.py',
                    name: 'flasky.py',
                    kind: 'file',
                    summary: 'Single-file application entry point.',
                },
                {
                    id: 'index',
                    name: 'index',
                    kind: 'function',
                    summary: 'Root route returning a greeting.',
                },
            ],
            edges: [
                {
                    source: 'flasky.py',
                    target: 'index',
                    kind: 'contains',
                    confidence: 'high',
                },
            ],
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
                location: 'app/__init__.py:17',
            },
            nodes: [
                {
                    id: 'app.__init__',
                    name: 'app/__init__.py',
                    kind: 'file',
                    summary: 'Application factory and extension setup.',
                },
                {
                    id: 'main.blueprint',
                    name: 'main',
                    kind: 'class',
                    summary: 'Blueprint for main routes.',
                },
                {
                    id: 'config.Config',
                    name: 'Config',
                    kind: 'class',
                    summary: 'Base configuration values.',
                },
            ],
            edges: [
                {
                    source: 'app.__init__',
                    target: 'main.blueprint',
                    kind: 'imports',
                    confidence: 'high',
                },
                {
                    source: 'app.__init__',
                    target: 'config.Config',
                    kind: 'imports',
                    confidence: 'medium',
                },
            ],
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
                location: 'app/main/views.py:9',
            },
            nodes: [
                {
                    id: 'main.views',
                    name: 'main/views.py',
                    kind: 'file',
                    summary: 'Routes for the main blueprint.',
                },
                {
                    id: 'main.user',
                    name: 'user',
                    kind: 'function',
                    summary: 'Dynamic route with a name parameter.',
                },
                {
                    id: 'template.user',
                    name: 'user.html',
                    kind: 'file',
                    summary: 'Template that renders a greeting.',
                },
            ],
            edges: [
                {
                    source: 'main.user',
                    target: 'template.user',
                    kind: 'calls',
                    confidence: 'medium',
                },
            ],
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
                location: 'app/main/views.py:3',
            },
            nodes: [
                {
                    id: 'template.base',
                    name: 'base.html',
                    kind: 'file',
                    summary: 'Defines the base layout and blocks.',
                },
                {
                    id: 'template.index',
                    name: 'index.html',
                    kind: 'file',
                    summary: 'Extends the base template.',
                },
            ],
            edges: [
                {
                    source: 'template.index',
                    target: 'template.base',
                    kind: 'inherits',
                    confidence: 'high',
                },
            ],
        },
    ];

    constructor() {
        this.tocList = this.getElement('toc-list');
        this.codeSurface = this.getElement('code-surface');
        this.canvasGrid = this.getElement('canvas-grid');
        this.narratorOutput = this.getElement('narrator-output');
        this.modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
        this.layoutButtons = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
        this.workspace = this.getElement('workspace');
    }

    init(): void {
        this.renderToc();
        this.bindEvents();
        if (this.chapters.length > 0) {
            this.loadChapter(this.chapters[0].id);
        }
    }

    private getElement(id: string): HTMLElement {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Missing element: ${id}`);
        }
        return element;
    }

    private bindEvents(): void {
        this.tocList.addEventListener('click', (event) => {
            const target = (event.target as HTMLElement).closest<HTMLLIElement>('.toc-item');
            if (!target) {
                return;
            }
            const chapterId = target.dataset.chapterId;
            if (chapterId) {
                this.loadChapter(chapterId);
            }
        });

        this.modeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.mode as NarrationMode | undefined;
                if (mode) {
                    this.setMode(mode);
                }
            });
        });

        this.layoutButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const layout = button.dataset.layout;
                if (layout) {
                    this.setLayout(layout);
                }
            });
        });
    }

    private renderToc(): void {
        this.tocList.innerHTML = '';
        this.chapters.forEach((chapter) => {
            const item = document.createElement('li');
            item.className = 'toc-item';
            item.dataset.chapterId = chapter.id;
            item.innerHTML = `
                <div class="toc-title">${chapter.title}</div>
                <p class="toc-summary">${chapter.summary}</p>
            `;
            this.tocList.appendChild(item);
        });
    }

    private loadChapter(chapterId: string): void {
        const chapter = this.chapters.find((item) => item.id === chapterId);
        if (!chapter) {
            return;
        }
        this.setActiveToc(chapterId);
        this.renderCode(chapter.focus);
        this.renderGraph(chapter.nodes, chapter.edges);
        this.updateNarrator(chapter.focus);
    }

    private setActiveToc(chapterId: string): void {
        Array.from(this.tocList.children).forEach((child) => {
            const element = child as HTMLElement;
            const isActive = element.dataset.chapterId === chapterId;
            element.classList.toggle('is-active', isActive);
        });
    }

    private renderCode(symbol: SymbolNode): void {
        this.codeSurface.innerHTML = `
            <article class="code-card">
                <div class="code-meta">
                    <span>${symbol.kind.toUpperCase()}</span>
                    <span>${symbol.location ?? 'location unknown'}</span>
                </div>
                <div>
                    <h3>${symbol.name}</h3>
                    <p>${symbol.summary}</p>
                </div>
                <div class="code-signature">${symbol.signature ?? 'signature pending'}</div>
                <details class="code-details">
                    <summary>Reveal body</summary>
                    <pre>${symbol.body ?? '# body not loaded yet'}</pre>
                </details>
            </article>
        `;
    }

    private renderGraph(nodes: SymbolNode[], edges: GraphEdge[]): void {
        this.canvasGrid.innerHTML = '';
        nodes.forEach((node) => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'canvas-node';
            nodeEl.innerHTML = `
                <h4>${node.name}</h4>
                <p>${node.kind} - ${node.summary}</p>
            `;
            this.canvasGrid.appendChild(nodeEl);
        });

        if (edges.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'canvas-node';
            empty.innerHTML = '<h4>No edges yet</h4><p>Add relationships to reveal the map.</p>';
            this.canvasGrid.appendChild(empty);
        }
    }

    private updateNarrator(symbol: SymbolNode): void {
        const narration = this.getNarration(symbol, this.currentMode);
        this.narratorOutput.innerHTML = `
            <p class="eyebrow">${narration.eyebrow}</p>
            <h3>${narration.title}</h3>
            ${narration.body}
        `;
    }

    private getNarration(symbol: SymbolNode, mode: NarrationMode): { eyebrow: string; title: string; body: string } {
        const name = symbol.name;
        switch (mode) {
            case 'summary':
                return {
                    eyebrow: 'What it does',
                    title: `A clear role for ${name}`,
                    body: `
                        <p>${name} brings structure to this chapter and passes context forward.</p>
                        <ul>
                            <li>Focuses attention on the next layer of the app.</li>
                            <li>Turns configuration into action.</li>
                            <li>Hints at the next extension to unlock.</li>
                        </ul>
                    `,
                };
            case 'key_lines':
                return {
                    eyebrow: 'Key lines',
                    title: 'Lines to watch',
                    body: `
                        <ul>
                            <li>Line 1: the signature promises intent.</li>
                            <li>Line 3: a framework call shapes control flow.</li>
                            <li>Line 7: handoff to the next chapter.</li>
                        </ul>
                    `,
                };
            case 'connections':
                return {
                    eyebrow: 'Connections',
                    title: 'How it links',
                    body: `
                        <ul>
                            <li>Bridges configuration into the main blueprint.</li>
                            <li>Feeds data toward templates and views.</li>
                            <li>Creates the seam for extensions to attach.</li>
                        </ul>
                    `,
                };
            case 'next':
                return {
                    eyebrow: 'Next thread',
                    title: 'Where to go next',
                    body: `
                        <p>Follow the blueprint registration to see the story branch into routes.</p>
                    `,
                };
            case 'hook':
            default:
                return {
                    eyebrow: 'Hook',
                    title: `The quiet setup behind ${name}`,
                    body: `
                        <p>At first glance this looks simple, but every line hints at the next reveal.</p>
                        <p>What happens once the request arrives?</p>
                    `,
                };
        }
    }

    private setMode(mode: NarrationMode): void {
        this.currentMode = mode;
        this.modeButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.mode === mode);
        });
        const activeChapter = this.getActiveChapter();
        if (activeChapter) {
            this.updateNarrator(activeChapter.focus);
        }
    }

    private setLayout(layout: string): void {
        this.workspace.dataset.layout = layout;
        this.layoutButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.layout === layout);
        });
    }

    private getActiveChapter(): Chapter | undefined {
        const active = this.tocList.querySelector('.toc-item.is-active') as HTMLElement | null;
        if (!active) {
            return undefined;
        }
        const chapterId = active.dataset.chapterId;
        return this.chapters.find((item) => item.id === chapterId);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new GitReaderApp();
    app.init();
});
