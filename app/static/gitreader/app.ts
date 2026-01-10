type NarrationMode = 'hook' | 'summary' | 'key_lines' | 'connections' | 'next';

type SymbolKind = 'file' | 'class' | 'function' | 'method' | 'external' | 'blueprint';

type EdgeKind = 'imports' | 'calls' | 'inherits' | 'contains' | 'blueprint';

type EdgeConfidence = 'high' | 'medium' | 'low';

interface SourceLocation {
    path: string;
    start_line: number;
    end_line: number;
    start_col: number;
    end_col: number;
}

interface SymbolNode {
    id: string;
    name: string;
    kind: SymbolKind;
    summary: string;
    signature?: string;
    docstring?: string;
    location?: SourceLocation;
    module?: string;
}

interface GraphEdge {
    source: string;
    target: string;
    kind: EdgeKind;
    confidence: EdgeConfidence;
}

interface ChapterSummary {
    id: string;
    title: string;
    summary: string;
}

interface ApiWarning {
    code: string;
    message: string;
    path: string;
    line?: number;
}

interface ApiTocResponse {
    chapters: ChapterSummary[];
    stats?: Record<string, number>;
    warnings?: ApiWarning[];
}

interface ApiGraphResponse {
    nodes: SymbolNode[];
    edges: GraphEdge[];
    stats?: Record<string, number>;
    warnings?: ApiWarning[];
}

interface SymbolSnippetResponse {
    id: string;
    name: string;
    kind: SymbolKind;
    summary?: string;
    signature?: string;
    docstring?: string;
    location: SourceLocation;
    start_line: number;
    end_line: number;
    total_lines: number;
    truncated: boolean;
    section: string;
    highlights: HighlightRange[];
    snippet: string;
}

interface HighlightRange {
    label: string;
    start_line: number;
    end_line: number;
}

class GitReaderApp {
    private tocList: HTMLElement;
    private codeSurface: HTMLElement;
    private canvasGrid: HTMLElement;
    private narratorOutput: HTMLElement;
    private modeButtons: NodeListOf<HTMLButtonElement>;
    private layoutButtons: NodeListOf<HTMLButtonElement>;
    private narratorToggle: HTMLButtonElement;
    private workspace: HTMLElement;
    private currentMode: NarrationMode = 'hook';
    private chapters: ChapterSummary[] = [];
    private graphNodes: SymbolNode[] = [];
    private graphEdges: GraphEdge[] = [];
    private nodeById: Map<string, SymbolNode> = new Map();
    private snippetCache: Map<string, SymbolSnippetResponse> = new Map();
    private graphCache: Map<string, ApiGraphResponse> = new Map();
    private narratorVisible = true;

    constructor() {
        this.tocList = this.getElement('toc-list');
        this.codeSurface = this.getElement('code-surface');
        this.canvasGrid = this.getElement('canvas-grid');
        this.narratorOutput = this.getElement('narrator-output');
        this.modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
        this.layoutButtons = document.querySelectorAll<HTMLButtonElement>('.nav-btn[data-layout]');
        this.narratorToggle = this.getElement('narrator-toggle') as HTMLButtonElement;
        this.workspace = this.getElement('workspace');
    }

    init(): void {
        this.renderLoadingState();
        this.bindEvents();
        this.updateNarratorToggle();
        this.loadData().catch((error) => {
            const message = error instanceof Error ? error.message : 'Failed to load data.';
            this.renderErrorState(message);
        });
    }

    private getElement(id: string): HTMLElement {
        const element = document.getElementById(id);
        if (!element) {
            throw new Error(`Missing element: ${id}`);
        }
        return element;
    }

    private async loadData(): Promise<void> {
        const tocData = await this.fetchJson<ApiTocResponse>('/gitreader/api/toc');
        this.chapters = Array.isArray(tocData.chapters) ? tocData.chapters : [];
        this.renderToc();
        const defaultChapterId = this.chapters.length > 0 ? this.chapters[0].id : '';
        await this.loadChapter(defaultChapterId);
    }

    private async fetchJson<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }
        return response.json() as Promise<T>;
    }

    private renderLoadingState(): void {
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Loading chapters</div><p class="toc-summary">Scanning repository...</p></li>';
        this.codeSurface.innerHTML = '<article class="code-card"><h3>Loading symbols...</h3><p>Fetching graph data.</p></article>';
        this.canvasGrid.innerHTML = '<div class="canvas-node"><h4>Loading graph</h4><p>Preparing nodes and edges.</p></div>';
        this.narratorOutput.innerHTML = '<p class="eyebrow">Narrator</p><h3>Loading</h3><p>Gathering the first clues.</p>';
    }

    private renderErrorState(message: string): void {
        this.tocList.innerHTML = `<li class="toc-item"><div class="toc-title">Failed to load</div><p class="toc-summary">${this.escapeHtml(message)}</p></li>`;
        this.codeSurface.innerHTML = `<article class="code-card"><h3>Unable to load</h3><p>${this.escapeHtml(message)}</p></article>`;
        this.canvasGrid.innerHTML = `<div class="canvas-node"><h4>No graph</h4><p>${this.escapeHtml(message)}</p></div>`;
        this.narratorOutput.innerHTML = `<p class="eyebrow">Narrator</p><h3>Paused</h3><p>${this.escapeHtml(message)}</p>`;
    }

    private bindEvents(): void {
        this.tocList.addEventListener('click', (event) => {
            const target = (event.target as HTMLElement).closest<HTMLLIElement>('.toc-item');
            if (!target) {
                return;
            }
            const chapterId = target.dataset.chapterId;
            if (chapterId) {
                void this.loadChapter(chapterId);
            }
        });

        this.canvasGrid.addEventListener('click', (event) => {
            const target = (event.target as HTMLElement).closest<HTMLDivElement>('.canvas-node');
            if (!target) {
                return;
            }
            const nodeId = target.dataset.nodeId;
            if (!nodeId) {
                return;
            }
            const node = this.nodeById.get(nodeId);
            if (node) {
                this.loadSymbolSnippet(node).catch(() => {
                    this.renderCode(node);
                    this.updateNarrator(node);
                });
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

        this.narratorToggle.addEventListener('click', () => {
            this.narratorVisible = !this.narratorVisible;
            this.workspace.classList.toggle('is-narrator-hidden', !this.narratorVisible);
            this.updateNarratorToggle();
        });
    }

    private renderToc(): void {
        this.tocList.innerHTML = '';
        if (this.chapters.length === 0) {
            this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">No chapters yet</div><p class="toc-summary">Scan another repository.</p></li>';
            return;
        }
        this.chapters.forEach((chapter) => {
            const item = document.createElement('li');
            item.className = 'toc-item';
            item.dataset.chapterId = chapter.id;
            item.innerHTML = `
                <div class="toc-title">${this.escapeHtml(chapter.title)}</div>
                <p class="toc-summary">${this.escapeHtml(chapter.summary)}</p>
            `;
            this.tocList.appendChild(item);
        });
    }

    private async loadChapter(chapterId: string): Promise<void> {
        this.setActiveToc(chapterId);
        const scope = this.getScopeForChapter(chapterId);
        await this.loadGraphForScope(scope);
        const nodes = this.filterNodesForChapter(chapterId);
        const edges = this.filterEdgesForNodes(nodes);
        const focus = this.pickFocusNode(nodes);
        this.renderGraph(nodes, edges);
        this.loadSymbolSnippet(focus).catch(() => {
            this.renderCode(focus);
            this.updateNarrator(focus);
        });
    }

    private getScopeForChapter(chapterId: string): string {
        if (chapterId && chapterId.startsWith('group:')) {
            return chapterId;
        }
        return 'full';
    }

    private async loadGraphForScope(scope: string): Promise<void> {
        const cached = this.graphCache.get(scope);
        if (cached) {
            this.setGraphData(cached);
            return;
        }
        const suffix = scope && scope !== 'full' ? `?scope=${encodeURIComponent(scope)}` : '';
        const graphData = await this.fetchJson<ApiGraphResponse>(`/gitreader/api/graph${suffix}`);
        this.graphCache.set(scope, graphData);
        this.setGraphData(graphData);
    }

    private setGraphData(graphData: ApiGraphResponse): void {
        this.graphNodes = Array.isArray(graphData.nodes) ? graphData.nodes : [];
        this.graphEdges = Array.isArray(graphData.edges) ? graphData.edges : [];
        this.nodeById = new Map(this.graphNodes.map((node) => [node.id, node]));
    }

    private async loadSymbolSnippet(symbol: SymbolNode): Promise<void> {
        if (!this.canFetchSnippet(symbol)) {
            this.renderCode(symbol);
            this.updateNarrator(symbol);
            return;
        }
        const cached = this.snippetCache.get(symbol.id);
        if (cached) {
            this.renderCode(symbol, cached);
            this.updateNarrator(symbol);
            return;
        }
        const section = this.getSnippetSection(symbol);
        const response = await this.fetchJson<SymbolSnippetResponse>(
            `/gitreader/api/symbol?id=${encodeURIComponent(symbol.id)}&section=${section}`,
        );
        this.snippetCache.set(symbol.id, response);
        this.renderCode(symbol, response);
        this.updateNarrator(symbol);
    }

    private getSnippetSection(symbol: SymbolNode): string {
        if (symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class') {
            return 'body';
        }
        return 'full';
    }

    private canFetchSnippet(symbol: SymbolNode): boolean {
        if (!symbol.id) {
            return false;
        }
        if (symbol.kind === 'external') {
            return false;
        }
        return Boolean(symbol.location && symbol.location.path);
    }

    private filterNodesForChapter(chapterId: string): SymbolNode[] {
        if (!chapterId || !chapterId.startsWith('group:')) {
            return this.graphNodes;
        }
        const group = chapterId.slice('group:'.length);
        const filtered = this.graphNodes.filter((node) => {
            const path = this.getNodePath(node);
            if (!path) {
                return false;
            }
            const normalized = path.replace(/\\/g, '/');
            if (group === 'root') {
                return normalized.indexOf('/') === -1;
            }
            return normalized.startsWith(`${group}/`);
        });
        return filtered.length > 0 ? filtered : this.graphNodes;
    }

    private filterEdgesForNodes(nodes: SymbolNode[]): GraphEdge[] {
        const allowed = new Set(nodes.map((node) => node.id));
        return this.graphEdges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
    }

    private pickFocusNode(nodes: SymbolNode[]): SymbolNode {
        if (nodes.length === 0) {
            return this.fallbackSymbol();
        }
        const priority: SymbolKind[] = ['function', 'method', 'class', 'file', 'blueprint', 'external'];
        for (const kind of priority) {
            const match = nodes.find((node) => node.kind === kind);
            if (match) {
                return match;
            }
        }
        return nodes[0];
    }

    private fallbackSymbol(): SymbolNode {
        return {
            id: 'fallback',
            name: 'Repository',
            kind: 'file',
            summary: 'Select a chapter to explore symbols.',
        };
    }

    private getNodePath(node: SymbolNode): string | null {
        if (node.location && node.location.path) {
            return node.location.path;
        }
        return null;
    }

    private setActiveToc(chapterId: string): void {
        Array.from(this.tocList.children).forEach((child) => {
            const element = child as HTMLElement;
            const isActive = element.dataset.chapterId === chapterId;
            element.classList.toggle('is-active', isActive);
        });
    }

    private formatLocation(location?: SourceLocation, startLine?: number, endLine?: number): string {
        if (!location || !location.path) {
            return 'location unknown';
        }
        if (startLine && startLine > 0) {
            const endLabel = endLine && endLine !== startLine ? `-${endLine}` : '';
            return `${location.path}:${startLine}${endLabel}`;
        }
        if (location.start_line) {
            const endLabel = location.end_line && location.end_line !== location.start_line
                ? `-${location.end_line}`
                : '';
            return `${location.path}:${location.start_line}${endLabel}`;
        }
        return location.path;
    }

    private renderCode(symbol: SymbolNode, snippet?: SymbolSnippetResponse): void {
        const summary = snippet?.summary ?? symbol.summary ?? 'No summary yet.';
        const signature = snippet?.signature ?? symbol.signature ?? 'signature pending';
        const displayRange = this.getDisplayRange(symbol, snippet);
        const locationLabel = this.formatLocation(symbol.location, displayRange.startLine, displayRange.endLine);
        const truncationLabel = snippet?.truncated ? ' (truncated)' : '';
        const snippetHtml = this.renderSnippetLines(snippet);
        this.codeSurface.innerHTML = `
            <article class="code-card">
                <div class="code-meta">
                    <span>${this.escapeHtml(symbol.kind.toUpperCase())}</span>
                    <span>${this.escapeHtml(locationLabel)}${this.escapeHtml(truncationLabel)}</span>
                </div>
                <div>
                    <h3>${this.escapeHtml(symbol.name)}</h3>
                    <p>${this.escapeHtml(summary)}</p>
                </div>
                <div class="code-signature">${this.escapeHtml(signature)}</div>
                <details class="code-details" open>
                    <summary>Reveal body</summary>
                    <pre><code>${snippetHtml}</code></pre>
                </details>
            </article>
        `;
    }

    private getDisplayRange(
        symbol: SymbolNode,
        snippet?: SymbolSnippetResponse,
    ): { startLine?: number; endLine?: number } {
        if (snippet?.section === 'body' && snippet.start_line) {
            return { startLine: snippet.start_line, endLine: snippet.end_line };
        }
        if ((symbol.kind === 'function' || symbol.kind === 'method' || symbol.kind === 'class') && symbol.location?.start_line) {
            return {
                startLine: symbol.location.start_line,
                endLine: symbol.location.end_line || snippet?.end_line || symbol.location.start_line,
            };
        }
        if (snippet?.start_line) {
            return { startLine: snippet.start_line, endLine: snippet.end_line };
        }
        if (symbol.location?.start_line) {
            return { startLine: symbol.location.start_line, endLine: symbol.location.end_line };
        }
        return {};
    }

    private renderSnippetLines(snippet?: SymbolSnippetResponse): string {
        const body = snippet?.snippet ?? '# body not loaded yet';
        const startLine = snippet?.start_line ?? 1;
        const highlightSet = this.buildHighlightSet(snippet?.highlights ?? []);
        const lines = body.replace(/\n$/, '').split('\n');
        return lines
            .map((line, index) => {
                const lineNumber = startLine + index;
                const isHighlighted = highlightSet.has(lineNumber);
                const classes = isHighlighted ? 'code-line is-highlight' : 'code-line';
                return `<span class="${classes}"><span class="line-no">${lineNumber}</span>${this.escapeHtml(line)}</span>`;
            })
            .join('\n');
    }

    private buildHighlightSet(highlights: HighlightRange[]): Set<number> {
        const highlightSet = new Set<number>();
        highlights.forEach((range) => {
            const start = Math.min(range.start_line, range.end_line);
            const end = Math.max(range.start_line, range.end_line);
            for (let line = start; line <= end; line += 1) {
                highlightSet.add(line);
            }
        });
        return highlightSet;
    }

    private renderGraph(nodes: SymbolNode[], edges: GraphEdge[]): void {
        this.canvasGrid.innerHTML = '';
        if (nodes.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'canvas-node';
            empty.innerHTML = '<h4>No nodes yet</h4><p>Graph data has not loaded.</p>';
            this.canvasGrid.appendChild(empty);
            return;
        }
        nodes.forEach((node) => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'canvas-node';
            nodeEl.dataset.nodeId = node.id;
            nodeEl.innerHTML = `
                <h4>${this.escapeHtml(node.name)}</h4>
                <p>${this.escapeHtml(node.kind)} - ${this.escapeHtml(node.summary || 'No summary')}</p>
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
        const chapterId = this.getActiveChapterId();
        const nodes = this.filterNodesForChapter(chapterId ?? '');
        const focus = this.pickFocusNode(nodes);
        this.updateNarrator(focus);
    }

    private setLayout(layout: string): void {
        this.workspace.dataset.layout = layout;
        this.layoutButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.layout === layout);
        });
    }

    private getActiveChapterId(): string | null {
        const active = this.tocList.querySelector('.toc-item.is-active') as HTMLElement | null;
        if (!active) {
            return null;
        }
        return active.dataset.chapterId ?? null;
    }

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private updateNarratorToggle(): void {
        this.narratorToggle.classList.toggle('is-active', this.narratorVisible);
        this.narratorToggle.setAttribute('aria-pressed', String(this.narratorVisible));
        this.narratorToggle.textContent = this.narratorVisible ? 'Narrator' : 'Narrator Off';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new GitReaderApp();
    app.init();
});
