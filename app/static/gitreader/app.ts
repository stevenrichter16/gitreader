type NarrationMode = 'hook' | 'summary' | 'key_lines' | 'connections' | 'next';

type TocMode = 'story' | 'tree';

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

interface TracePath {
    id: string;
    label: string;
    nodes: Set<string>;
    edges: Set<string>;
}

interface ChapterSummary {
    id: string;
    title: string;
    summary: string;
    scope?: string;
}

interface ApiWarning {
    code: string;
    message: string;
    path: string;
    line?: number;
}

interface ApiTocResponse {
    chapters: ChapterSummary[];
    mode?: TocMode;
    stats?: Record<string, number>;
    warnings?: ApiWarning[];
}

interface ApiGraphResponse {
    nodes: SymbolNode[];
    edges: GraphEdge[];
    scope?: string;
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
    warnings?: ApiWarning[];
    stats?: Record<string, number>;
}

interface HighlightRange {
    label: string;
    start_line: number;
    end_line: number;
}

interface NarrationKeyLine {
    line: number;
    text: string;
}

interface NarrationResponse {
    mode: NarrationMode;
    symbol_id: string;
    symbol_name: string;
    hook?: string;
    summary?: string[];
    key_lines?: NarrationKeyLine[];
    connections?: string[];
    next_thread?: string;
    cached?: boolean;
    source?: string;
    model?: string;
    prompt_version?: string;
}

type SnippetMode = 'body' | 'full';

type GraphLayoutMode = 'cluster' | 'layer' | 'free';

declare const cytoscape: any;
declare const hljs: any;

class GitReaderApp {
    private tocList: HTMLElement;
    private codeSurface: HTMLElement;
    private canvasGraph: HTMLElement;
    private canvasOverlay: HTMLElement;
    private traceList: HTMLElement;
    private narratorOutput: HTMLElement;
    private modeButtons: NodeListOf<HTMLButtonElement>;
    private layoutButtons: NodeListOf<HTMLButtonElement>;
    private tocModeButtons: NodeListOf<HTMLButtonElement>;
    private snippetModeButtons: NodeListOf<HTMLButtonElement>;
    private graphLayoutButtons: NodeListOf<HTMLButtonElement>;
    private edgeFilterButtons: NodeListOf<HTMLButtonElement>;
    private nodeFilterButtons: NodeListOf<HTMLButtonElement>;
    private graphActionButtons: NodeListOf<HTMLButtonElement>;
    private narratorToggle: HTMLButtonElement;
    private workspace: HTMLElement;
    private tocPill: HTMLElement;
    private tocSubtitle: HTMLElement;
    private currentMode: NarrationMode = 'hook';
    private tocMode: TocMode = 'story';
    private snippetMode: SnippetMode = 'body';
    private graphLayoutMode: GraphLayoutMode = 'cluster';
    private chapters: ChapterSummary[] = [];
    private graphNodes: SymbolNode[] = [];
    private graphEdges: GraphEdge[] = [];
    private nodeById: Map<string, SymbolNode> = new Map();
    private fileNodesByPath: Map<string, SymbolNode> = new Map();
    private snippetCache: Map<string, SymbolSnippetResponse> = new Map();
    private graphCache: Map<string, ApiGraphResponse> = new Map();
    private narratorCache: Map<string, NarrationResponse> = new Map();
    private narratorRequestToken = 0;
    private narratorVisible = true;
    private graphInstance: any | null = null;
    private graphEventsBound = false;
    private edgeFilters: Set<EdgeKind> = new Set(['calls', 'imports', 'inherits', 'contains', 'blueprint']);
    private showExternalNodes = true;
    private focusedNodeId: string | null = null;
    private tracePaths: TracePath[] = [];
    private selectedTraceIds: Set<string> = new Set();
    private currentSymbol: SymbolNode | null = null;
    private currentSnippetText = '';
    private readonly maxTraceDepth = 8;
    private readonly maxTracePaths = 10;

    constructor() {
        this.tocList = this.getElement('toc-list');
        this.codeSurface = this.getElement('code-surface');
        this.canvasGraph = this.getElement('canvas-graph');
        this.canvasOverlay = this.getElement('canvas-overlay');
        this.traceList = this.getElement('canvas-trace-list');
        this.narratorOutput = this.getElement('narrator-output');
        this.modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-btn');
        this.layoutButtons = document.querySelectorAll<HTMLButtonElement>('.nav-btn[data-layout]');
        this.tocModeButtons = document.querySelectorAll<HTMLButtonElement>('.nav-btn[data-toc-mode]');
        this.snippetModeButtons = document.querySelectorAll<HTMLButtonElement>('[data-snippet-mode]');
        this.graphLayoutButtons = document.querySelectorAll<HTMLButtonElement>('[data-layout-action]');
        this.edgeFilterButtons = document.querySelectorAll<HTMLButtonElement>('[data-edge-filter]');
        this.nodeFilterButtons = document.querySelectorAll<HTMLButtonElement>('[data-node-filter]');
        this.graphActionButtons = document.querySelectorAll<HTMLButtonElement>('[data-graph-action]');
        this.narratorToggle = this.getElement('narrator-toggle') as HTMLButtonElement;
        this.workspace = this.getElement('workspace');
        this.tocPill = this.getElement('toc-pill');
        this.tocSubtitle = this.getElement('toc-subtitle');
    }

    init(): void {
        this.renderLoadingState();
        this.loadGraphPreferences();
        this.bindEvents();
        this.updateNarratorToggle();
        this.updateSnippetModeUi();
        this.updateGraphControls();
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
        await this.loadToc(this.tocMode);
        const defaultChapterId = this.chapters.length > 0 ? this.chapters[0].id : '';
        await this.loadChapter(defaultChapterId);
    }

    private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
        const headers = new Headers(init?.headers);
        headers.set('Accept', 'application/json');
        const response = await fetch(url, {
            ...init,
            headers,
        });
        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }
        return response.json() as Promise<T>;
    }

    private renderLoadingState(): void {
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Loading chapters</div><p class="toc-summary">Scanning repository...</p></li>';
        this.codeSurface.innerHTML = '<article class="code-card"><h3>Loading symbols...</h3><p>Fetching graph data.</p></article>';
        this.setCanvasOverlay('Preparing nodes and edges...', true);
        this.narratorOutput.innerHTML = '<p class="eyebrow">Narrator</p><h3>Loading</h3><p>Gathering the first clues.</p>';
    }

    private renderErrorState(message: string): void {
        this.tocList.innerHTML = `<li class="toc-item"><div class="toc-title">Failed to load</div><p class="toc-summary">${this.escapeHtml(message)}</p></li>`;
        this.codeSurface.innerHTML = `<article class="code-card"><h3>Unable to load</h3><p>${this.escapeHtml(message)}</p></article>`;
        this.setCanvasOverlay(message, true);
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

        this.tocModeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.tocMode as TocMode | undefined;
                if (mode) {
                    void this.setTocMode(mode);
                }
            });
        });

        this.snippetModeButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const mode = button.dataset.snippetMode as SnippetMode | undefined;
                if (mode) {
                    void this.setSnippetMode(mode);
                }
            });
        });

        this.graphLayoutButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const layout = button.dataset.layoutAction as GraphLayoutMode | undefined;
                if (layout) {
                    this.setGraphLayoutMode(layout);
                }
            });
        });

        this.edgeFilterButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const filter = button.dataset.edgeFilter as EdgeKind | undefined;
                if (filter) {
                    this.toggleEdgeFilter(filter);
                }
            });
        });

        this.nodeFilterButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const filter = button.dataset.nodeFilter;
                if (filter === 'external') {
                    this.showExternalNodes = !this.showExternalNodes;
                    this.updateGraphControls();
                    this.applyGraphFilters();
                }
            });
        });

        this.graphActionButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.graphAction;
                if (action === 'focus') {
                    this.focusOnSelected();
                } else if (action === 'reset') {
                    this.resetGraphFocus();
                } else if (action === 'clear-traces') {
                    this.clearTraceSelection();
                }
            });
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
            this.refreshGraphViewport();
        });

        this.codeSurface.addEventListener('click', (event) => {
            const target = (event.target as HTMLElement).closest<HTMLElement>('[data-reader-action]');
            if (!target) {
                return;
            }
            const action = target.dataset.readerAction;
            if (action === 'copy') {
                void this.copySnippet();
            } else if (action === 'jump') {
                this.jumpToInputLine();
            }
        });

        this.codeSurface.addEventListener('keydown', (event) => {
            const target = event.target as HTMLElement;
            if (event.key === 'Enter' && target.matches('[data-line-input]')) {
                event.preventDefault();
                this.jumpToInputLine();
            }
        });

        this.traceList.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement;
            if (!target || target.type !== 'checkbox') {
                return;
            }
            const traceId = target.value;
            if (target.checked) {
                this.selectedTraceIds.add(traceId);
            } else {
                this.selectedTraceIds.delete(traceId);
            }
            this.applyTraceHighlight();
        });
    }

    private async setTocMode(mode: TocMode): Promise<void> {
        if (this.tocMode === mode) {
            return;
        }
        this.tocList.innerHTML = '<li class="toc-item"><div class="toc-title">Loading chapters</div><p class="toc-summary">Switching TOC view...</p></li>';
        await this.loadToc(mode);
        const defaultChapterId = this.chapters.length > 0 ? this.chapters[0].id : '';
        await this.loadChapter(defaultChapterId);
    }

    private async loadToc(mode: TocMode): Promise<void> {
        const suffix = mode ? `?mode=${encodeURIComponent(mode)}` : '';
        const tocData = await this.fetchJson<ApiTocResponse>(`/gitreader/api/toc${suffix}`);
        this.chapters = Array.isArray(tocData.chapters) ? tocData.chapters : [];
        this.tocMode = tocData.mode ?? mode;
        this.updateTocModeUi();
        this.renderToc();
    }

    private updateTocModeUi(): void {
        this.tocModeButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.tocMode === this.tocMode);
        });
        const isStory = this.tocMode === 'story';
        this.tocPill.textContent = isStory ? 'story' : 'file tree';
        this.tocSubtitle.textContent = isStory
            ? 'Follow the story arc of the repository.'
            : 'Browse the repository by folder.';
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
            if (chapter.scope) {
                item.dataset.scope = chapter.scope;
            }
            item.innerHTML = `
                <div class="toc-title">${this.escapeHtml(chapter.title)}</div>
                <p class="toc-summary">${this.escapeHtml(chapter.summary)}</p>
            `;
            this.tocList.appendChild(item);
        });
    }

    private async loadChapter(chapterId: string): Promise<void> {
        this.setActiveToc(chapterId);
        const chapter = this.chapters.find((entry) => entry.id === chapterId);
        const scope = chapter?.scope ?? this.getScopeForChapter(chapterId);
        this.focusedNodeId = null;
        await this.loadGraphForScope(scope);
        const nodes = this.filterNodesForChapter(chapterId);
        const edges = this.filterEdgesForNodes(nodes);
        const focus = this.pickFocusNode(nodes);
        this.renderGraph(nodes, edges);
        this.loadSymbolSnippet(focus).catch(() => {
            this.renderCode(focus);
            void this.updateNarrator(focus);
        });
    }

    private getScopeForChapter(chapterId: string): string {
        if (chapterId && (chapterId.startsWith('group:') || chapterId.startsWith('story:'))) {
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
        this.fileNodesByPath = new Map();
        this.graphNodes.forEach((node) => {
            if (node.kind !== 'file' || !node.location?.path) {
                return;
            }
            this.fileNodesByPath.set(this.normalizePath(node.location.path), node);
        });
    }

    private async loadSymbolSnippet(symbol: SymbolNode): Promise<void> {
        if (!this.canFetchSnippet(symbol)) {
            this.renderCode(symbol);
            void this.updateNarrator(symbol);
            return;
        }
        const section = this.getSnippetSection(symbol);
        const cacheKey = `${symbol.id}:${section}`;
        const cached = this.snippetCache.get(cacheKey);
        if (cached) {
            this.renderCode(symbol, cached);
            void this.updateNarrator(symbol);
            return;
        }
        const response = await this.fetchJson<SymbolSnippetResponse>(
            `/gitreader/api/symbol?id=${encodeURIComponent(symbol.id)}&section=${section}`,
        );
        this.snippetCache.set(cacheKey, response);
        this.renderCode(symbol, response);
        void this.updateNarrator(symbol);
    }

    private getSnippetSection(symbol: SymbolNode): string {
        if (this.snippetMode === 'full') {
            return 'full';
        }
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

    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/');
    }

    private getFileNodeForSymbol(symbol: SymbolNode): SymbolNode | null {
        const path = symbol.location?.path;
        if (!path) {
            return null;
        }
        return this.fileNodesByPath.get(this.normalizePath(path)) ?? null;
    }

    private isModifierClick(event?: MouseEvent): boolean {
        if (!event) {
            return false;
        }
        return Boolean(event.metaKey || event.ctrlKey);
    }

    private isFileNodeActive(fileNode: SymbolNode): boolean {
        if (this.currentSymbol && this.currentSymbol.kind === 'file') {
            if (this.currentSymbol.id === fileNode.id) {
                return true;
            }
            const currentPath = this.currentSymbol.location?.path;
            const filePath = fileNode.location?.path;
            if (currentPath && filePath && this.normalizePath(currentPath) === this.normalizePath(filePath)) {
                return true;
            }
        }
        if (!this.graphInstance) {
            return false;
        }
        const element = this.graphInstance.$id(fileNode.id);
        return Boolean(element && typeof element.selected === 'function' && element.selected());
    }

    private async highlightSymbolInFile(fileNode: SymbolNode, symbol: SymbolNode): Promise<void> {
        if (!this.currentSymbol || this.currentSymbol.id !== fileNode.id) {
            try {
                await this.loadSymbolSnippet(fileNode);
            } catch {
                this.renderCode(fileNode);
                void this.updateNarrator(fileNode);
            }
        }
        this.applyFocusHighlight(symbol);
    }

    private handleFileFocusClick(symbol: SymbolNode, event?: MouseEvent): boolean {
        if (!this.isModifierClick(event)) {
            return false;
        }
        if (symbol.kind !== 'function' && symbol.kind !== 'method') {
            return false;
        }
        const fileNode = this.getFileNodeForSymbol(symbol);
        if (!fileNode || !this.isFileNodeActive(fileNode)) {
            return false;
        }
        if (this.graphInstance) {
            this.graphInstance.$id(fileNode.id).select();
            this.graphInstance.$id(symbol.id).select();
        }
        void this.highlightSymbolInFile(fileNode, symbol);
        return true;
    }

    private applyFocusHighlight(symbol: SymbolNode): void {
        const start = symbol.location?.start_line ?? 0;
        const end = symbol.location?.end_line ?? start;
        if (!start) {
            this.setCodeStatus('Line range unavailable.');
            return;
        }
        this.clearFocusHighlights();
        let firstLine: HTMLElement | null = null;
        let found = false;
        for (let line = start; line <= end; line += 1) {
            const lineEl = this.codeSurface.querySelector<HTMLElement>(`[data-line="${line}"]`);
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
        this.setCodeStatus(`Highlighted ${symbol.name}.`);
        if (firstLine) {
            firstLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    private clearFocusHighlights(): void {
        this.codeSurface.querySelectorAll<HTMLElement>('.code-line.is-focus')
            .forEach((line) => line.classList.remove('is-focus'));
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
        const revealLabel = snippet?.section === 'body' ? 'Show body' : 'Show code';
        const codeClass = this.hasHighlightSupport() ? 'hljs language-python' : '';
        this.currentSymbol = symbol;
        this.currentSnippetText = snippet?.snippet ?? '';
        this.codeSurface.innerHTML = `
            <article class="code-card">
                <div class="code-meta">
                    <span>${this.escapeHtml(symbol.kind.toUpperCase())}</span>
                    <span>${this.escapeHtml(locationLabel)}${this.escapeHtml(truncationLabel)}</span>
                </div>
                <div class="code-actions">
                    <button class="ghost-btn" data-reader-action="copy">Copy snippet</button>
                    <div class="jump-control">
                        <label for="line-jump">Line</label>
                        <input id="line-jump" type="number" min="1" placeholder="Line" data-line-input>
                        <button class="ghost-btn" data-reader-action="jump">Go</button>
                    </div>
                    <span class="code-status" data-code-status></span>
                </div>
                <div>
                    <h3>${this.escapeHtml(symbol.name)}</h3>
                    <p>${this.escapeHtml(summary)}</p>
                </div>
                <div class="code-signature">${this.escapeHtml(signature)}</div>
                <details class="code-details" open>
                    <summary>${revealLabel}</summary>
                    <pre><code class="${codeClass}">${snippetHtml}</code></pre>
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
        const rawBody = snippet?.snippet ?? '';
        const body = rawBody.trim().length > 0 ? rawBody : '# body not loaded yet';
        const startLine = snippet?.start_line ?? 1;
        const highlightSet = this.buildHighlightSet(snippet?.highlights ?? []);
        const rendered = this.highlightSnippet(body);
        const lines = rendered.replace(/\n$/, '').split('\n');
        return lines
            .map((line, index) => {
                const lineNumber = startLine + index;
                const isHighlighted = highlightSet.has(lineNumber);
                const classes = isHighlighted ? 'code-line is-highlight' : 'code-line';
                return `<span class="${classes}" data-line="${lineNumber}"><span class="line-no">${lineNumber}</span>${line}</span>`;
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
        const elements = this.buildGraphElements(nodes, edges);
        this.graphInstance.elements().remove();
        this.graphInstance.add(elements);
        this.resetTracePanel();
        this.runGraphLayout();
        this.applyGraphFilters();
    }

    private ensureGraph(): void {
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
            wheelSensitivity: 0.2,
        });
        this.bindGraphEvents();
    }

    private clearGraph(): void {
        if (this.graphInstance) {
            this.graphInstance.elements().remove();
        }
    }

    private bindGraphEvents(): void {
        if (this.graphEventsBound || !this.graphInstance) {
            return;
        }
        this.graphInstance.on('tap', 'node', (event: { target: { id: () => string }; originalEvent?: MouseEvent }) => {
            const nodeId = event.target.id();
            const node = this.nodeById.get(nodeId);
            if (!node) {
                return;
            }
            if (this.handleFileFocusClick(node, event.originalEvent)) {
                this.updateCallTraces(node);
                return;
            }
            event.target.select();
            this.loadSymbolSnippet(node).catch(() => {
                this.renderCode(node);
                void this.updateNarrator(node);
            });
            this.updateCallTraces(node);
        });
        this.graphEventsBound = true;
    }

    private buildGraphElements(nodes: SymbolNode[], edges: GraphEdge[]): Array<{ data: Record<string, unknown> }> {
        const nodeElements = nodes.map((node) => ({
            data: {
                id: node.id,
                label: node.name,
                kind: node.kind,
                summary: node.summary || '',
            },
        }));
        const edgeElements = edges.map((edge, index) => ({
            data: {
                id: this.buildEdgeId(edge, index),
                source: edge.source,
                target: edge.target,
                kind: edge.kind,
                confidence: edge.confidence,
            },
        }));
        return [...nodeElements, ...edgeElements];
    }

    private buildEdgeId(edge: GraphEdge, index: number): string {
        return `edge:${edge.source}:${edge.target}:${edge.kind}:${index}`;
    }

    private getGraphStyles(): Array<Record<string, object>> {
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
                    'shape': 'round-rectangle',
                },
            },
            {
                selector: 'node[kind = "file"]',
                style: { 'background-color': '#f0dcc1' },
            },
            {
                selector: 'node[kind = "class"]',
                style: { 'background-color': '#d9e8f0' },
            },
            {
                selector: 'node[kind = "function"]',
                style: { 'background-color': '#e3f0d9' },
            },
            {
                selector: 'node[kind = "method"]',
                style: { 'background-color': '#f0e3d9' },
            },
            {
                selector: 'node[kind = "blueprint"]',
                style: { 'background-color': '#d9efe7' },
            },
            {
                selector: 'node[kind = "external"]',
                style: { 'background-color': '#efe0f0', 'border-style': 'dashed' },
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
                    'shadow-offset-y': 0,
                },
            },
            {
                selector: 'node[trace_dimmed = "true"]',
                style: {
                    'opacity': 0.15,
                    'text-opacity': 0.15,
                },
            },
            {
                selector: 'edge',
                style: {
                    'line-color': '#bcae9c',
                    'width': 1,
                    'curve-style': 'bezier',
                    'target-arrow-shape': 'triangle',
                    'target-arrow-color': '#bcae9c',
                    'opacity': 0.7,
                },
            },
            {
                selector: 'edge[trace_dimmed = "true"]',
                style: {
                    'opacity': 0.1,
                },
            },
            {
                selector: 'edge[kind = "calls"]',
                style: { 'line-color': '#237a78', 'target-arrow-color': '#237a78' },
            },
            {
                selector: 'edge[kind = "imports"]',
                style: { 'line-color': '#d07838', 'target-arrow-color': '#d07838' },
            },
            {
                selector: 'edge[kind = "inherits"]',
                style: { 'line-color': '#7d6ba6', 'target-arrow-color': '#7d6ba6' },
            },
            {
                selector: 'edge[kind = "contains"]',
                style: { 'line-color': '#5c4d3c', 'target-arrow-color': '#5c4d3c' },
            },
            {
                selector: 'edge[kind = "blueprint"]',
                style: { 'line-color': '#2a9d8f', 'target-arrow-color': '#2a9d8f' },
            },
            {
                selector: 'edge[confidence = "low"]',
                style: { 'line-style': 'dashed', 'opacity': 0.45 },
            },
        ];
    }

    private runGraphLayout(): void {
        if (!this.graphInstance) {
            return;
        }
        const layout = this.graphInstance.layout(this.getLayoutOptions());
        layout.run();
    }

    private async updateNarrator(symbol: SymbolNode): Promise<void> {
        const mode = this.currentMode;
        const section = this.getSnippetSection(symbol);
        const cacheKey = `${symbol.id}:${mode}:${section}`;
        const cached = this.narratorCache.get(cacheKey);
        if (cached) {
            this.renderNarration(symbol, cached);
            return;
        }
        const requestToken = ++this.narratorRequestToken;
        this.renderNarratorLoading(symbol);
        try {
            const response = await this.fetchJson<NarrationResponse>('/gitreader/api/narrate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: symbol.id,
                    mode,
                    section,
                }),
            });
            if (requestToken !== this.narratorRequestToken) {
                return;
            }
            if (!response || (response as unknown as { error?: object }).error) {
                throw new Error('Narrator unavailable.');
            }
            this.narratorCache.set(cacheKey, response);
            this.renderNarration(symbol, response);
        } catch (error) {
            if (requestToken !== this.narratorRequestToken) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Narrator unavailable.';
            this.renderNarratorError(symbol, message);
        }
    }

    private renderNarratorLoading(symbol: SymbolNode): void {
        this.narratorOutput.innerHTML = `
            <p class="eyebrow">Narrator</p>
            <h3>Listening to ${this.escapeHtml(symbol.name)}</h3>
            <p>Drafting the next beat in the story.</p>
        `;
    }

    private renderNarratorError(symbol: SymbolNode, message: string): void {
        this.narratorOutput.innerHTML = `
            <p class="eyebrow">Narrator</p>
            <h3>Unable to narrate ${this.escapeHtml(symbol.name)}</h3>
            <p>${this.escapeHtml(message)}</p>
        `;
    }

    private renderNarration(symbol: SymbolNode, narration: NarrationResponse): void {
        const formatted = this.formatNarration(symbol, narration, this.currentMode);
        this.narratorOutput.innerHTML = `
            <p class="eyebrow">${formatted.eyebrow}</p>
            <h3>${formatted.title}</h3>
            ${formatted.body}
        `;
    }

    private formatNarration(
        symbol: SymbolNode,
        narration: NarrationResponse,
        mode: NarrationMode,
    ): { eyebrow: string; title: string; body: string } {
        const name = this.escapeHtml(symbol.name);
        if (mode === 'summary') {
            const items = (narration.summary ?? []).map((item) => this.escapeHtml(item));
            const body = items.length > 0
                ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`
                : `<p>No summary yet for ${name}.</p>`;
            return {
                eyebrow: 'What it does',
                title: `A clear role for ${name}`,
                body,
            };
        }
        if (mode === 'key_lines') {
            const lines = narration.key_lines ?? [];
            const body = lines.length > 0
                ? `<ul>${lines.map((line) => {
                    const label = `Line ${line.line}: ${line.text}`;
                    return `<li>${this.escapeHtml(label)}</li>`;
                }).join('')}</ul>`
                : `<p>No key lines captured yet.</p>`;
            return {
                eyebrow: 'Key lines',
                title: `Lines to watch in ${name}`,
                body,
            };
        }
        if (mode === 'connections') {
            const items = (narration.connections ?? []).map((item) => this.escapeHtml(item));
            const body = items.length > 0
                ? `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`
                : `<p>Connections are still being mapped.</p>`;
            return {
                eyebrow: 'Connections',
                title: `How ${name} links`,
                body,
            };
        }
        if (mode === 'next') {
            const thread = narration.next_thread ? this.escapeHtml(narration.next_thread) : 'No next thread yet.';
            return {
                eyebrow: 'Next thread',
                title: 'Where to go next',
                body: `<p>${thread}</p>`,
            };
        }
        const hook = narration.hook ? this.escapeHtml(narration.hook) : `A quiet setup around ${name}.`;
        return {
            eyebrow: 'Hook',
            title: `The quiet setup behind ${name}`,
            body: `<p>${hook}</p>`,
        };
    }

    private setMode(mode: NarrationMode): void {
        this.currentMode = mode;
        this.modeButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.mode === mode);
        });
        const chapterId = this.getActiveChapterId();
        const nodes = this.filterNodesForChapter(chapterId ?? '');
        const focus = this.pickFocusNode(nodes);
        void this.updateNarrator(focus);
    }

    private setLayout(layout: string): void {
        this.workspace.dataset.layout = layout;
        this.layoutButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.layout === layout);
        });
        this.refreshGraphViewport();
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

    private setCanvasOverlay(message: string, visible: boolean): void {
        this.canvasOverlay.textContent = message;
        this.canvasOverlay.classList.toggle('is-visible', visible);
    }

    private refreshGraphViewport(): void {
        if (!this.graphInstance) {
            return;
        }
        this.graphInstance.resize();
        this.graphInstance.fit();
    }

    private hasHighlightSupport(): boolean {
        return typeof hljs !== 'undefined' && typeof hljs.highlight === 'function';
    }

    private highlightSnippet(body: string): string {
        if (!this.hasHighlightSupport()) {
            return this.escapeHtml(body);
        }
        const language = hljs.getLanguage && hljs.getLanguage('python') ? 'python' : undefined;
        if (language) {
            return hljs.highlight(body, { language }).value;
        }
        return hljs.highlightAuto(body).value;
    }

    private async setSnippetMode(mode: SnippetMode): Promise<void> {
        if (this.snippetMode === mode) {
            return;
        }
        this.snippetMode = mode;
        this.snippetCache.clear();
        this.updateSnippetModeUi();
        if (this.currentSymbol) {
            await this.loadSymbolSnippet(this.currentSymbol);
        }
    }

    private updateSnippetModeUi(): void {
        this.snippetModeButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.snippetMode === this.snippetMode);
        });
    }

    private copySnippet(): void {
        const text = this.currentSnippetText;
        if (!text) {
            this.setCodeStatus('Nothing to copy.');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => this.setCodeStatus('Snippet copied.'))
                .catch(() => this.setCodeStatus('Copy failed.'));
            return;
        }
        this.setCodeStatus('Copy not supported.');
    }

    private jumpToInputLine(): void {
        const input = this.codeSurface.querySelector<HTMLInputElement>('[data-line-input]');
        if (!input) {
            return;
        }
        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) {
            this.setCodeStatus('Enter a valid line number.');
            return;
        }
        this.jumpToLine(value);
    }

    private jumpToLine(line: number): void {
        const lineEl = this.codeSurface.querySelector<HTMLElement>(`[data-line="${line}"]`);
        if (!lineEl) {
            this.setCodeStatus('Line not in snippet.');
            return;
        }
        this.setCodeStatus('');
        lineEl.classList.add('is-jump');
        lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => lineEl.classList.remove('is-jump'), 1200);
    }

    private setCodeStatus(message: string): void {
        const status = this.codeSurface.querySelector<HTMLElement>('[data-code-status]');
        if (status) {
            status.textContent = message;
        }
    }

    private loadGraphPreferences(): void {
        const storedLayout = window.localStorage.getItem('gitreader.graphLayoutMode') as GraphLayoutMode | null;
        if (storedLayout && ['cluster', 'layer', 'free'].includes(storedLayout)) {
            this.graphLayoutMode = storedLayout;
        }
    }

    private setGraphLayoutMode(mode: GraphLayoutMode): void {
        if (this.graphLayoutMode === mode) {
            return;
        }
        this.graphLayoutMode = mode;
        window.localStorage.setItem('gitreader.graphLayoutMode', mode);
        this.updateGraphControls();
        this.runGraphLayout();
    }

    private toggleEdgeFilter(filter: EdgeKind): void {
        if (this.edgeFilters.has(filter)) {
            this.edgeFilters.delete(filter);
        } else {
            this.edgeFilters.add(filter);
        }
        this.updateGraphControls();
        this.applyGraphFilters();
    }

    private applyGraphFilters(): void {
        if (!this.graphInstance) {
            return;
        }
        const cy = this.graphInstance;
        cy.elements().show();
        if (!this.showExternalNodes) {
            cy.nodes().filter('[kind = "external"]').hide();
        }
        cy.edges().forEach((edge: { data: (key: string) => EdgeKind; hide: () => void }) => {
            if (!this.edgeFilters.has(edge.data('kind'))) {
                edge.hide();
            }
        });
        cy.edges().forEach((edge: any) => {
            if (edge.source().hidden() || edge.target().hidden()) {
                edge.hide();
            }
        });
        this.applyFocus();
        this.applyTraceHighlight();
    }

    private updateCallTraces(symbol: SymbolNode): void {
        this.tracePaths = this.buildCallTracePaths(symbol.id);
        this.selectedTraceIds.clear();
        if (this.tracePaths.length > 0) {
            this.selectedTraceIds.add(this.tracePaths[0].id);
        }
        this.renderTracePanel(symbol);
        this.applyTraceHighlight();
    }

    private resetTracePanel(): void {
        this.tracePaths = [];
        this.selectedTraceIds.clear();
        this.renderTracePanel();
        this.applyTraceHighlight();
    }

    private clearTraceSelection(): void {
        this.selectedTraceIds.clear();
        this.traceList.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-trace-id]')
            .forEach((input) => {
                input.checked = false;
            });
        this.applyTraceHighlight();
    }

    private renderTracePanel(symbol?: SymbolNode): void {
        if (!symbol) {
            this.traceList.innerHTML = '<p class="canvas-traces__empty">Select a node to compute call traces.</p>';
            return;
        }
        if (this.tracePaths.length === 0) {
            this.traceList.innerHTML = `
                <p class="canvas-traces__empty">
                    No call traces found for ${this.escapeHtml(symbol.name)}.
                </p>
            `;
            return;
        }
        const info = this.tracePaths.length >= this.maxTracePaths
            ? `<div class="canvas-trace-meta">Showing first ${this.maxTracePaths} paths.</div>`
            : '';
        const items = this.tracePaths
            .map((path, index) => {
                const checked = this.selectedTraceIds.has(path.id) ? 'checked' : '';
                return `
                    <label class="canvas-trace-item">
                        <input type="checkbox" data-trace-id="${path.id}" value="${path.id}" ${checked}>
                        <span>
                            <div class="canvas-trace-label">Path ${index + 1}</div>
                            <div class="canvas-trace-meta">${this.escapeHtml(path.label)}</div>
                        </span>
                    </label>
                `;
            })
            .join('');
        this.traceList.innerHTML = `${info}${items}`;
    }

    private buildCallTracePaths(targetId: string): TracePath[] {
        const incomingCalls = new Map<string, Array<{ from: string; edgeId: string }>>();
        this.graphEdges.forEach((edge, index) => {
            if (edge.kind !== 'calls') {
                return;
            }
            const edgeId = this.buildEdgeId(edge, index);
            const list = incomingCalls.get(edge.target) ?? [];
            list.push({ from: edge.source, edgeId });
            incomingCalls.set(edge.target, list);
        });
        const paths: TracePath[] = [];
        const nodeStack: string[] = [targetId];
        const edgeStack: string[] = [];
        const visited = new Set<string>([targetId]);

        const walk = (nodeId: string, depth: number): void => {
            if (paths.length >= this.maxTracePaths) {
                return;
            }
            const incoming = incomingCalls.get(nodeId) ?? [];
            if (incoming.length === 0 || depth >= this.maxTraceDepth) {
                const nodes = new Set(nodeStack);
                const edges = new Set(edgeStack);
                const label = this.formatTraceLabel([...nodeStack].reverse());
                paths.push({
                    id: `trace-${paths.length + 1}`,
                    label,
                    nodes,
                    edges,
                });
                return;
            }
            incoming.forEach((link) => {
                if (paths.length >= this.maxTracePaths) {
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
    }

    private formatTraceLabel(nodeIds: string[]): string {
        const names = nodeIds.map((nodeId) => this.nodeById.get(nodeId)?.name ?? nodeId);
        return names.join(' → ');
    }

    private applyTraceHighlight(): void {
        if (!this.graphInstance) {
            return;
        }
        const cy = this.graphInstance;
        if (this.selectedTraceIds.size === 0 || this.tracePaths.length === 0) {
            cy.nodes().forEach((node: any) => node.data('trace_dimmed', 'false'));
            cy.edges().forEach((edge: any) => edge.data('trace_dimmed', 'false'));
            return;
        }
        const highlightedNodes = new Set<string>();
        const highlightedEdges = new Set<string>();
        this.tracePaths.forEach((path) => {
            if (!this.selectedTraceIds.has(path.id)) {
                return;
            }
            path.nodes.forEach((nodeId) => highlightedNodes.add(nodeId));
            path.edges.forEach((edgeId) => highlightedEdges.add(edgeId));
        });
        cy.nodes().forEach((node: any) => {
            const dimmed = highlightedNodes.has(node.id()) ? 'false' : 'true';
            node.data('trace_dimmed', dimmed);
        });
        cy.edges().forEach((edge: any) => {
            const edgeId = edge.data('id') as string;
            const dimmed = highlightedEdges.has(edgeId) ? 'false' : 'true';
            edge.data('trace_dimmed', dimmed);
        });
    }

    private focusOnSelected(): void {
        if (!this.graphInstance) {
            return;
        }
        const selected = this.graphInstance.$('node:selected');
        if (!selected || selected.length === 0) {
            this.setCanvasOverlay('Select a node to focus.', true);
            window.setTimeout(() => this.setCanvasOverlay('', false), 1200);
            return;
        }
        this.focusedNodeId = selected[0].id();
        this.applyGraphFilters();
    }

    private resetGraphFocus(): void {
        this.focusedNodeId = null;
        this.applyGraphFilters();
        this.refreshGraphViewport();
    }

    private applyFocus(): void {
        if (!this.graphInstance || !this.focusedNodeId) {
            return;
        }
        const cy = this.graphInstance;
        const node = cy.getElementById(this.focusedNodeId);
        if (!node || node.empty() || node.hidden()) {
            this.focusedNodeId = null;
            return;
        }
        const visible = cy.elements(':visible');
        const focusElements = node.closedNeighborhood().intersection(visible);
        visible.not(focusElements).hide();
        cy.fit(focusElements, 40);
    }

    private updateGraphControls(): void {
        this.graphLayoutButtons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.layoutAction === this.graphLayoutMode);
        });
        this.edgeFilterButtons.forEach((button) => {
            const filter = button.dataset.edgeFilter as EdgeKind | undefined;
            if (!filter) {
                return;
            }
            button.classList.toggle('is-active', this.edgeFilters.has(filter));
        });
        this.nodeFilterButtons.forEach((button) => {
            if (button.dataset.nodeFilter === 'external') {
                button.classList.toggle('is-active', this.showExternalNodes);
            }
        });
    }

    private getLayoutOptions(): { name: string; animate: boolean; fit: boolean; padding: number; directed?: boolean } {
        if (this.graphLayoutMode === 'layer') {
            return {
                name: 'breadthfirst',
                animate: false,
                fit: true,
                padding: 24,
                directed: true,
            };
        }
        if (this.graphLayoutMode === 'free') {
            return {
                name: 'preset',
                animate: false,
                fit: true,
                padding: 24,
            };
        }
        return {
            name: 'cose',
            animate: false,
            fit: true,
            padding: 24,
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new GitReaderApp();
    app.init();
});
