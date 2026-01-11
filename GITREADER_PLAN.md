# GitReader Application Plan

GitReader is envisioned as an e-reader for codebases with a living architecture canvas. The goal is to make exploring any GitHub repository feel like reading a novel: the user progresses through a curated sequence of "chapters" where each file, class, or function is revealed at the right moment, and the relationships between them are visualized on a canvas. It should be entertaining as well as informative, with suspense, hooks, cliffhangers, and payoffs just like a story. While the initial prototype targets a Python project (Miguel Grinberg's Flasky tutorial app), the architecture is intentionally language-agnostic so that other repositories and languages can be supported later.

## Inspiration from the Flasky example

In the Flasky project the git tags map to the chapters of the book: the first tag (1a) contains a minimal hello app; later tags introduce routing, dynamic URLs, templates, Bootstrap integration, and custom error pages. These tags align with Chapter 2 and Chapter 3 of the Flask Web Development book, which cover topics like initialization, routes, dynamic routes, Jinja2 templates, Bootstrap integration, and custom error pages. This progression shows how a repo can be structured as a narrative and provides a template for the GitReader "chapters" view. GitReader adapts this idea for any repository: instead of relying on book tags, it will build a table of contents from the file structure and symbol graph so the reader can follow a meaningful path through the code.

## User experience overview

GitReader offers two complementary modes.

### Reader Mode (Kindle-style)

- Navigation / Table of Contents - On the left, a sidebar lists the high-level "chapters" of the repository. For Flasky these would correspond to tags like 1a, 2a, 2b, etc., but for arbitrary repos the entries will be key directories, modules, or curated sequences defined by heuristics or human authors.
- Code view - The central pane displays the current file, class, or function. Progressive disclosure is used: first show only the signature and a short summary; the user clicks to reveal the body. This creates suspense ("What does this function do?") and allows the reader to focus on important parts.
- Narrator / LLM panel - A right-hand panel hosts an LLM-generated commentary. When the reader selects a symbol, GitReader sends the code snippet, docstring, and graph context to a language model and receives a structured response with a hook, bullet-point summary of what the symbol does, key line highlights with line numbers, connections to other symbols, and a cliffhanger directing them to the next item.

### Canvas Mode (Miro-style)

- Graph canvas - A zoomable/scrollable canvas shows nodes representing files, classes, functions, and edges representing relationships such as imports, calls, or inheritance. The user can drag nodes from the table of contents onto the canvas to explore how pieces fit together. Nodes can expand to reveal nested symbols (for example methods in a class), and edges can be solid (high-confidence dependency) or dotted (inferred).
- Board layouts - The user may choose auto-layout options (for example group by package or by layer) to organize the graph. They can save boards, annotate them, and share them.
- Narrator integration - Selecting one or more nodes on the canvas invokes the LLM to describe interactions between them, producing an "explain this diagram" narrative.

## Front-end structure (HTML / CSS / TypeScript)

The front-end skeleton comprises three key files:

- index.html - Defines the layout. It includes a header with navigation buttons, a sidebar for the table of contents (#toc), a main code viewer (#code-view), a canvas section (#graph-canvas), and a narrator pane with mode buttons (hook, what it does, key lines, connections, next thread). The page imports styles.css for styling and app.js (compiled from TypeScript) for behavior.
- styles.css - Provides responsive layout styles. Flexbox is used to arrange the TOC, reader, canvas, and narrator panes. Sections have fixed widths or flexible flex ratios. Simple styles ensure the app uses the full viewport height, separates panels with borders, and adds padding for readability.
- app.ts - Implements the client-side logic. A GitReaderApp class binds DOM elements, registers event handlers, and stubs out methods to load chapters, render code, render graphs, and request narration. The TypeScript interfaces SymbolNode and GraphEdge define the shape of nodes and relationships. In a full implementation these would be populated with data fetched from a backend service. A call to loadChapter('1a') demonstrates how initial content is loaded, and event handlers trigger narration requests.

This skeleton is intentionally minimal; real syntax highlighting, graph drawing, and network requests are left to be implemented. However it shows how the main UI components fit together and how progressive disclosure and narration controls can be wired up.

## Backend responsibilities (language-agnostic)

For GitReader to work with any GitHub repo, a server component must perform the following tasks:

1. Repository ingestion - Clone the selected repository and checkout a specific commit or branch. For large repos, the server may only pull necessary directories.
2. Language detection and parsing - Identify the programming languages present. For each supported language, run a parser (for example Python's ast module, TypeScript's compiler API, Java's javaparser, etc.) to extract a symbol table and build a graph of definitions and relations. The goal is to build a unified representation of files, classes, functions or methods, and their connections (calls, imports, inheritance).
3. Call graph construction - Analyze function or method bodies to find call sites. For languages like Python this can be approximated by looking at ast.Call nodes; imported names must be resolved to fully qualified symbols. The server should annotate edges with confidence levels.
4. Metadata and summaries - Compute basic metrics (for example file sizes, number of references) and optionally use heuristics to suggest chapter sequences (for example top-level packages, tags, commit history). Precompute code embeddings or caches to reduce LLM costs.
5. LLM orchestration - When the front-end requests narration, send the code snippet, symbol metadata, and graph context to an LLM. Follow the structured prompt pattern: require citations (line numbers), ask for a hook, explanation bullets, key lines, connections, and a cliffhanger. Cache responses keyed by (repo, commit, symbol, snippet, prompt type) to avoid redundant calls.

## Extending beyond Python

Although the prototype uses Flasky as an example and implements parsing only for Python, the architecture supports other languages by writing language-specific analyzers that produce the same SymbolNode and GraphEdge structures. Tools like tree-sitter or multi-language LSPs can provide uniform parsing across languages. By keeping the front-end generic and the backend modular, GitReader can eventually browse JavaScript, TypeScript, Java, Go, or C++ repositories.

## Narrative UX additions

These features reinforce the story-like pacing and ensure the narrator feels intentional instead of generic.

- Authoring layer - Provide a lightweight editor to reorder chapters, annotate arcs, and insert human-written beats.
- Pacing controls - Support reveal timing, chapter length targets, and cliffhanger prompts that guide the reader forward.
- Reader personalization - Adjust depth and tone by skill level, curiosity tags, or prior reading history.
- Engagement signals - Track where readers pause, skip, or abandon chapters to refine heuristics.
- Narrator style guide - Define voice, structure, and guardrails so the commentary stays coherent across the repo.
- Narrative metrics - Track completion rate, average dwell time, and chapter-to-chapter retention.

## Story construction without commit history

GitReader should not assume commit history reflects a narrative arc. The story is derived from the code alone.

- TOC heuristics - Build chapters from code structure (entry points, packages, top-level modules, cross-cutting concerns).
- Dependency-first ordering - Prioritize entry points, configuration, and framework wiring before leaf modules.
- Hotspot detection - Use symbols with high fan-in or fan-out as plot pivots.
- Feature arcs - Cluster symbols by shared templates, routes, or API endpoints instead of commits.
- Author overrides - Allow curated chapter order that can ignore or replace heuristics.

## Messy repos hardening

Real-world repositories are inconsistent. The pipeline must stay resilient and give partial results.

- Ingestion limits - Shallow clone, optional subdir scan, cap file size, skip binaries and vendor folders.
- Encoding tolerance - Detect encodings with fallback to UTF-8 replacement, store lossy warnings.
- Parse resilience - Per-file try/except, collect errors, continue building the graph.
- Mixed languages - Parse supported files, treat others as opaque nodes for context.
- Heuristic resolution - Accept unresolved calls/imports and mark edges with low confidence.
- Performance guardrails - Timeouts per file, max file count per repo, incremental parsing and caching.

## Next steps

1. Static analysis module - Implement AST parsing and graph construction for Python as described above. Provide endpoints for the front-end to request the TOC and symbol graphs.
2. Graph rendering - Integrate a graph library (for example D3.js, Cytoscape.js, or Vis.js) to draw nodes and edges on the canvas. Support dragging, zooming, and selection.
3. Syntax highlighting - Use a library like highlight.js or Prism.js in the reader pane to render code nicely.
4. LLM integration - Develop a service wrapper around the LLM API. Define prompts that enforce citation and narrative structure. Implement caching and rate limiting.
5. Auth and GitHub integration - Allow users to authenticate with GitHub and select repositories. Use GitHub's API to fetch file contents and commit metadata instead of cloning when possible.

## Phase 1: Core backend pipeline - detailed implementation plan

### Scope and outcomes

- Scope - Python parsing only, single repository and revision at a time, local clone or URL, no auth yet. Narrative is derived from code structure, not commit history.
- Outputs - A SymbolNode and GraphEdge set stored in memory and serialized to JSON for reuse, plus parse warnings and confidence levels.
- Success criteria - TOC, graph, and symbol lookups work for Flasky and return partial results for messy repos without crashing.

### Step-by-step build plan

1. Define the domain models
   - Create a small schema module with dataclasses or TypedDicts for `SymbolNode`, `GraphEdge`, `FileNode`, and `RepoIndex`.
   - Decide on stable IDs and naming: `file:app/__init__.py`, `symbol:app.__init__.create_app`.
   - Standardize location fields: `path`, `start_line`, `end_line`, `column`.

2. Implement repository ingestion
   - Accept `repo_url`, `ref`, and optional `subdir` in a new `RepoSpec`.
   - Use `git` CLI for clone and checkout to avoid new dependencies, but do not rely on history for ordering.
   - Prefer shallow clone and optional sparse checkout for large repos.
   - Cache clones under a repo root (for example `instance/gitreader/repos/<slug>`).
   - Record current commit SHA in the `RepoIndex` for caching and invalidation.

3. Detect languages and select parsers
   - Walk the repo tree while skipping `node_modules`, `.git`, `venv`, `__pycache__`, `dist`, and `build`.
   - Skip binary files and cap file size to avoid memory pressure.
   - Collect extension counts and select the parser set for the repo.
   - For phase 1, only parse `.py` and report others as unsupported.

4. Parse Python files into ASTs
   - Map file paths to module paths (for example `app/main/views.py` -> `app.main.views`).
   - Parse with `ast.parse`, collecting syntax errors but continuing the scan.
   - Read files with encoding fallbacks and record lossy decoding warnings.
   - Store raw file content for later line slicing and snippets.

5. Build the symbol table
   - Create nodes for `Module`, `ClassDef`, `FunctionDef`, and `AsyncFunctionDef`.
   - Attach docstrings, signatures (best-effort), and location data.
   - Add `contains` edges from file nodes to symbol nodes.
   - Record per-file parse failures without aborting the repo scan.

6. Resolve imports
   - Extract `import` and `from ... import ...` statements for each module.
   - Build an alias map: `alias -> module.path` or `module.path.symbol`.
   - Link imported local modules to file nodes when possible.

7. Extract call graph edges
   - Walk `ast.Call` nodes inside functions and methods.
   - Resolve `ast.Name` calls against local symbols or import aliases.
   - Resolve `ast.Attribute` calls with heuristics:
     - `self.method()` -> method on enclosing class (medium confidence).
     - `module.func()` -> imported module symbol (high confidence).
     - `obj.attr()` unresolved -> external placeholder (low confidence).
   - Record unresolved calls as external nodes under an `external:` namespace.
   - Store confidence on each edge to surface uncertainty in the UI.

8. Add inheritance and framework heuristics
   - For each class, resolve bases to local or imported symbols.
   - Detect `Blueprint()` calls and create blueprint nodes.
   - Detect `register_blueprint()` and connect to blueprint nodes.

9. Assemble the graph index
   - Build `RepoIndex` with nodes, edges, and lookup maps:
     - by id, by file path, by kind, by module path.
   - Generate a TOC from code structure and dependencies, not commit history.
   - Seed chapter order with entry points, configuration, and high fan-in symbols.

10. Serialize and cache results
   - Persist `RepoIndex` to `instance/gitreader/index/<repo_id>.json`.
    - Add a checksum of file mtimes or commit SHA for cache validation.
    - Persist parse warnings and lossy decoding flags alongside the graph.

11. Wire up backend endpoints
    - Replace stub responses in `app/gitreader/routes.py` with real data:
      - `/api/toc` -> list of chapters from `RepoIndex`.
      - `/api/graph` -> nodes and edges for the selected scope.
      - `/api/narrate` -> placeholder until LLM integration.
    - Add query params for `repo`, `ref`, and optional `path` scope.

12. Add observability and error handling
    - Collect parse errors with file path and line info.
    - Track decoding warnings, skipped files, and binary exclusions.
    - Log ingestion durations and counts: files, nodes, edges.
    - Return structured error payloads from the API.

### Module layout suggestion

- `app/gitreader/models.py` - node and edge schemas, RepoSpec, RepoIndex.
- `app/gitreader/ingest.py` - clone and checkout, repo caching.
- `app/gitreader/scan.py` - filesystem walk and language detection.
- `app/gitreader/parse_python.py` - AST parsing and symbol extraction.
- `app/gitreader/graph.py` - edges, resolution, and graph assembly.
- `app/gitreader/storage.py` - JSON serialization and cache lookup.
- `app/gitreader/service.py` - orchestration entry point for routes.

### Validation and tests

- Unit tests for module path resolution and import alias handling.
- Unit tests for call resolution on `Name` and `Attribute` patterns.
- Integration test on Flasky: ensure `create_app` and `main` nodes exist.
- Integration test on a repo with syntax errors: expect partial graph with warnings.
- Manual smoke test: request `/gitreader/api/toc` and `/gitreader/api/graph` and verify non-empty output.

---

## Phase 2: Interactive reader + canvas polish

### Scope and outcomes

- Scope - Keep Python-only parsing, focus on making the Reader and Canvas feel like a real product. Build on the Phase 1 graph and snippet endpoints. Add LLM narration, graph rendering, syntax highlighting, and a small repo picker UI.
- Outputs - Real graph canvas with pan/zoom and selection, syntax-highlighted reader view, narrator panel that calls the LLM with caching, and richer UI states (loading, empty, error).
- Success criteria - Users can choose a repo, browse a scoped TOC, explore an interactive graph, and read code with a coherent narrator flow.

### Step-by-step build plan

1. Graph rendering in the Canvas
   - Integrate a graph library (Cytoscape.js or D3).
   - Map `SymbolNode` and `GraphEdge` to styles by kind and confidence.
   - Add pan/zoom, fit-to-view, and click selection.
   - Keep external dependencies collapsed by default with a toggle to expand.

2. Graph interactions and filters
   - Filter edges by kind (imports, calls, inherits, contains).
   - Add a "focus on selected" action to show the local neighborhood.
   - Persist layout mode (cluster, layer, manual) in local storage.

3. Reader upgrades
   - Add syntax highlighting (Prism or highlight.js).
   - Add a toggle for "body" vs "full file" view.
   - Add copy snippet and jump-to-line controls.

4. Narrator integration
   - Implement the LLM API wrapper with prompt templates and caching.
   - Add narrator loading and error states in the UI.
   - Store and reuse narration by `(repo, commit, symbol, mode)`.

5. Repo selection flow
   - Add a minimal repo picker (local path, optional Git URL + ref).
   - Surface scan warnings and file counts in the UI.
   - Keep repo selection in the URL query string for shareable links.

6. Performance pass
   - Lazy-load graphs by scope and debounce TOC navigation.
   - Cache snippets and narration in the client.
   - Cap node count in the Canvas with progressive reveal.

7. Validation and tests
   - Smoke tests for graph rendering and TOC switching.
   - Backend tests for narrator caching and repo selection.

### UI enhancements and polish

- Loading polish - skeleton states for TOC, reader, canvas, and narrator.
- Reader clarity - line highlights for signature and key lines, clearer file breadcrumbs.
- Canvas clarity - node legend, edge-type toggles, and hover tooltips with summaries.
- Navigation - search in TOC and "recently viewed" chips.
- Accessibility - keyboard navigation and focus outlines, ARIA labels on controls.
- Responsive layout - better stacking on small screens, preserve narrative order.
- Visual consistency - shared spacing scale, subtle separators, and consistent button styles.

---

## Flasky reading path and narrator pacing

Based on the book's table of contents and the commit tags in the Flasky repository, the first few chapters in the code follow a deliberate progression. Tags 1a through 3c map to the first few chapters: tag 1a is "Chapter 1 - initial version", tag 2a is "Chapter 2 - A complete application", tag 2b is "Chapter 2 - Dynamic routes", tag 3a is "Chapter 3 - Templates", tag 3b is "Chapter 3 - Templates with Flask-Bootstrap", and tag 3c is "Chapter 3 - Custom error pages". The book's table of contents likewise shows that Chapter 2 introduces initialization, routes, and dynamic routes, while Chapter 3 covers templates, Jinja2, variables, Bootstrap integration, and custom error pages. Building on this, here is a suggested reading path and how the LLM narrator can create a sense of suspense, plus a minimal static-analysis plan.

### Chapter 1 (tag 1a): "Hello, world" skeleton

- Entry point - flasky.py in the repo root. It creates a Flask app, defines a single @app.route('/') function returning a plain string, and calls app.run().
- Narrative pacing
  - Hook: show just the signature app = Flask(__name__) and the @app.route('/') decorator. Ask the reader: "What happens when a user visits the root URL?"
  - Question: reveal the body of the view function but hide app.run(). Let the LLM narrator explain that a route decorator binds a URL path to a Python callable and that returning a string produces a response.
  - Payoff: show app.run(); the narrator explains that it starts a development server and ties the whole story together. The "aha" is seeing how a three-line file becomes a working web app.
  - Teaser for next chapter: the narrator hints that returning raw strings will not scale and that Flask applications are often organized into packages.

### Chapter 2 (tags 2a and 2b): packaging and dynamic routes

#### 2a - A complete application (basic structure)

- Entry points - app/__init__.py, config.py, and app/main/views.py (or routes.py depending on the edition). Tag 2a in the commit history is labeled "A complete application" and corresponds to Chapter 2's "Initialization" and "Routes and View Functions" topics.
- Narrative pacing
  - Hook: show the create_app() function that constructs the Flask application. The narrator points out the separation between configuration, app creation, and route registration.
  - Question: reveal the blueprint registration line (for example app.register_blueprint(main)) but hide the blueprint's contents. Ask: "What is a blueprint and why register it?"
  - Clue: show main = Blueprint('main', __name__) and one route in main/views.py. The narrator explains that blueprints enable modular organization.
  - Payoff: reveal config.py showing Config classes; the narrator explains that the application can run in different environments by selecting a configuration class. The "aha" is understanding the application factory pattern and modular structure.

#### 2b - Dynamic routes

- Entry point - app/main/views.py (tag 2b), where routes like @main.route('/user/<name>') appear. The commit tag 2b is labeled "Dynamic routes" and Chapter 2's table of contents includes dynamic routes and request dispatching.
- Narrative pacing
  - Hook: show the route with a dynamic parameter (/<name>). The narrator poses the question: "How does Flask capture values from the URL?"
  - Clue: reveal the function signature with a name parameter and show it passed into render_template() or used to construct a greeting.
  - Payoff: show a call to url_for('main.user', name='Sally') from within another template or view, illustrating how dynamic URLs are generated. The narrator explains variable converters (for example <int:id>) and how they influence routing.
  - Next thread: hint that returning strings will soon be replaced by templates for more complex pages.

### Chapter 3 (tags 3a to 3c): templates, Bootstrap integration, and error pages

#### 3a - Introducing templates

- Entry points - app/main/views.py calling render_template(), templates/base.html, and templates/index.html. Tag 3a in the commit log is labeled "Templates". Chapter 3 topics include Jinja2, rendering templates, and variables.
- Narrative pacing
  - Hook: show the view function now calling render_template('index.html') and passing a name or a list of posts. Ask: "Where does the HTML come from?"
  - Clue: reveal the top of base.html with the {% extends %} and {% block %} definitions. The narrator explains template inheritance and placeholders.
  - Payoff: reveal index.html, showing how variables like {{ name }} are inserted. The "aha" is connecting variables in Python code to placeholders in HTML.

#### 3b - Templates with Flask-Bootstrap

- Entry points - new imports in app/__init__.py (for example from flask_bootstrap import Bootstrap) and updated templates. Tag 3b is "Templates with Flask-Bootstrap". Table of contents entries mention Bootstrap integration.
- Narrative pacing
  - Hook: show a template using Bootstrap classes (class="btn btn-primary") and macros. Ask: "Why do the pages suddenly look nicer?"
  - Clue: reveal app/__init__.py registering the Bootstrap extension. Explain that extensions add functionality, injecting CSS and JS into templates.
  - Payoff: show how custom macros or {{ wtf.quick_form(form) }} simplify rendering forms. The narrator underscores that using extensions is a key part of Flask's flexibility.

#### 3c - Custom error pages

- Entry points - app/main/errors.py, templates/404.html, and blueprint registration of error handlers. Tag 3c is labeled "Custom error pages". The table of contents lists custom error pages as part of Chapter 3.
- Narrative pacing
  - Hook: show a route intentionally raising 404 or abort(404). Ask: "What happens when a page is missing?"
  - Clue: reveal the error handler function with @main.app_errorhandler(404) returning render_template('404.html'). The narrator explains that error handlers centralize response logic.
  - Payoff: show the 404.html template extending base.html. The "aha" is realizing that every part of the user experience, even error messages, can be customized.

---

## Minimal static-analysis plan for the code graph

1. File and symbol extraction - Walk the repository, skipping non-Python files. For each .py file, parse it with Python's ast module to build an abstract syntax tree. Create a file node for each file. For each ast.ClassDef and ast.FunctionDef or ast.AsyncFunctionDef, create a symbol node (class or function) with metadata (qualified name, docstring, location).
2. Import resolution - Collect import and from ... import ... statements into a module-level mapping of imported names to module paths. This can later be used to link calls to external modules.
3. Call graph edges - Within each function or method body, find ast.Call nodes. Extract the called function's name:
   - If call.func is an ast.Name, treat it as a call to a local or imported function of that name.
   - If call.func is an ast.Attribute, resolve the base (for example self.send_email) to a class attribute or imported object if possible.
   - Create a call edge from the calling symbol node to the target symbol node if the name matches a defined symbol or an imported name. Otherwise, record the call as external (edge to a placeholder node representing the module or package).
4. Inheritance and blueprint edges - For each ast.ClassDef, inspect its .bases list to create inherits edges (for example class MyForm(FlaskForm): ...). For Flask blueprints, find calls to Blueprint() and create nodes; register edges from the factory (in create_app) to the blueprint.
5. Graph storage - Represent nodes and edges in a simple in-memory structure (for example dictionaries keyed by qualified name). Persist to a graph database or adjacency lists as needed.
6. LLM integration - When the user selects a node (file, class, method) or a subgraph, pass the corresponding source snippet, symbol metadata, and a summary of callers, callees, or imports to the LLM. Use a structured prompt that asks for a hook, what it does, why it exists, key lines, and a cliffhanger, and instruct the model to cite line ranges for important claims. Cache responses using a hash of (repo, commit, symbol, snippet, prompt type) to avoid duplicate calls.

This plan covers the essential structural relationships (files, functions or classes, calls, imports, and inheritance) and supports the progressive-disclosure UX. You can refine the static analysis over time (for example adding data-flow analysis or deeper resolution of dynamic attributes), but the above is enough to produce useful "Kindle plus Miro" experiences for Flasky's early chapters.
