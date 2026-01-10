import os

from flask import current_app, jsonify, render_template, request

from . import gitreader
from .models import GraphEdge, RepoSpec, SourceLocation, SymbolNode
from .service import get_repo_index, get_symbol_snippet


@gitreader.route('/')
def index():
    return render_template('gitreader/index.html')


@gitreader.route('/api/toc')
def toc():
    spec = _repo_spec_from_request()
    mode = request.args.get('mode', 'story')
    try:
        repo_index = _load_index(spec)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    if mode == 'tree':
        chapters = _build_tree_toc(repo_index)
    else:
        chapters = _build_story_toc(repo_index)
        if not chapters:
            chapters = _build_tree_toc(repo_index)
            mode = 'tree'
    return jsonify({
        'chapters': chapters,
        'mode': mode,
        'stats': repo_index.stats,
        'warnings': [warning.to_dict() for warning in repo_index.warnings],
    })


@gitreader.route('/api/graph')
def graph():
    spec = _repo_spec_from_request()
    scope = request.args.get('scope', '')
    try:
        repo_index = _load_index(spec)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    nodes, edges = _filter_graph(repo_index, scope)
    nodes, edges = _collapse_externals(nodes, edges)
    return jsonify({
        'nodes': [node.to_dict() for node in nodes],
        'edges': [edge.to_dict() for edge in edges],
        'stats': repo_index.stats,
        'warnings': [warning.to_dict() for warning in repo_index.warnings],
        'scope': scope,
    })


@gitreader.route('/api/narrate', methods=['POST'])
def narrate():
    payload = request.get_json(silent=True) or {}
    mode = payload.get('mode', 'hook')
    symbol = payload.get('symbol', {})
    name = symbol.get('name', 'this symbol')
    narration = {
        'mode': mode,
        'symbol': name,
        'hook': f"A quiet line in the code hints at what {name} will awaken.",
        'summary': [
            f"{name} establishes a new step in the story.",
            'It gathers context and hands it to the next layer.',
            'The shape suggests a path toward the next chapter.',
        ],
        'key_lines': [
            {'line': 1, 'text': 'Signature reveals intent.'},
            {'line': 4, 'text': 'First interaction with the framework.'},
        ],
        'connections': [
            'Linked to the app factory for bootstrapping.',
            'Feeds the template layer with data.',
        ],
        'next_thread': 'Follow the blueprint registration to see the world expand.',
    }
    return jsonify(narration)


@gitreader.route('/api/symbol')
@gitreader.route('/api/symbol/<path:symbol_id>')
def symbol(symbol_id=None):
    if not symbol_id:
        symbol_id = request.args.get('id')
    if not symbol_id:
        return jsonify({
            'error': 'Missing id',
            'hint': 'Use /gitreader/api/symbol?id=symbol:module.name or /gitreader/api/symbol/symbol:module.name',
        }), 400
    section = request.args.get('section', 'full')
    spec = _repo_spec_from_request()
    try:
        snippet = _load_symbol_snippet(spec, symbol_id, section)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    return jsonify(snippet)


def _repo_spec_from_request() -> RepoSpec:
    repo_url = request.args.get('repo')
    local_path = request.args.get('local')
    if not repo_url and not local_path:
        local_path = _default_repo_root()
    return RepoSpec(
        repo_url=repo_url,
        ref=request.args.get('ref'),
        subdir=request.args.get('subdir'),
        local_path=local_path,
    )


def _load_index(spec: RepoSpec):
    cache_root = os.path.join(current_app.instance_path, 'gitreader')
    return get_repo_index(spec, cache_root=cache_root)


def _load_symbol_snippet(spec: RepoSpec, symbol_id: str, section: str):
    cache_root = os.path.join(current_app.instance_path, 'gitreader')
    return get_symbol_snippet(spec, cache_root=cache_root, symbol_id=symbol_id, section=section)


def _filter_graph(repo_index, scope: str):
    if not scope or scope == 'full':
        return list(repo_index.nodes.values()), list(repo_index.edges)
    if scope.startswith('group:'):
        group = scope[len('group:'):]
        allowed_paths = _group_paths(repo_index, group)
    elif scope.startswith('story:'):
        story_paths = _story_scope_paths(repo_index)
        allowed_paths = story_paths.get(scope, set())
    else:
        return list(repo_index.nodes.values()), list(repo_index.edges)
    if not allowed_paths:
        return list(repo_index.nodes.values()), list(repo_index.edges)
    return _apply_scope_paths(repo_index, allowed_paths)


def _apply_scope_paths(repo_index, allowed_paths: set[str]):
    allowed = set()
    for node in repo_index.nodes.values():
        location = node.location
        if not location or not location.path:
            continue
        normalized = location.path.replace(os.sep, '/')
        if normalized in allowed_paths:
            allowed.add(node.id)
    if not allowed:
        return list(repo_index.nodes.values()), list(repo_index.edges)
    external_extra = set()
    for edge in repo_index.edges:
        if edge.source in allowed and edge.target not in allowed:
            target_node = repo_index.nodes.get(edge.target)
            if target_node and target_node.kind == 'external':
                external_extra.add(edge.target)
        elif edge.target in allowed and edge.source not in allowed:
            source_node = repo_index.nodes.get(edge.source)
            if source_node and source_node.kind == 'external':
                external_extra.add(edge.source)
    allowed |= external_extra
    nodes = [node for node_id, node in repo_index.nodes.items() if node_id in allowed]
    edges = [edge for edge in repo_index.edges if edge.source in allowed and edge.target in allowed]
    return nodes, edges


def _collapse_externals(nodes: list[SymbolNode], edges: list[GraphEdge]):
    node_by_id = {node.id: node for node in nodes}
    external_ids = {node.id for node in nodes if node.kind == 'external'}
    if not external_ids:
        return nodes, edges

    grouped_nodes: dict[str, SymbolNode] = {}
    grouped_externals: dict[str, set[str]] = {}
    new_edges: list[GraphEdge] = []
    seen_edges: set[tuple[str, str, str, str]] = set()

    def add_edge(source: str, target: str, kind: str, confidence: str):
        key = (source, target, kind, confidence)
        if key in seen_edges:
            return
        seen_edges.add(key)
        new_edges.append(GraphEdge(source=source, target=target, kind=kind, confidence=confidence))

    def file_path_for(node_id: str) -> str | None:
        node = node_by_id.get(node_id)
        if not node or not node.location or not node.location.path:
            return None
        return node.location.path

    def ensure_group_node(file_path: str) -> str:
        group_id = f'external-group:{file_path}'
        if group_id not in grouped_nodes:
            file_name = os.path.basename(file_path) or file_path
            grouped_nodes[group_id] = SymbolNode(
                id=group_id,
                name=f'External dependencies - {file_name}',
                kind='external',
                summary='External dependencies',
                location=SourceLocation(path=file_path),
            )
        return group_id

    for edge in edges:
        source_is_external = edge.source in external_ids
        target_is_external = edge.target in external_ids
        if not source_is_external and not target_is_external:
            add_edge(edge.source, edge.target, edge.kind, edge.confidence)
            continue
        if source_is_external and target_is_external:
            add_edge(edge.source, edge.target, edge.kind, edge.confidence)
            continue
        external_id = edge.source if source_is_external else edge.target
        other_id = edge.target if source_is_external else edge.source
        file_path = file_path_for(other_id)
        if not file_path:
            add_edge(edge.source, edge.target, edge.kind, edge.confidence)
            continue
        group_id = ensure_group_node(file_path)
        external_node = node_by_id.get(external_id)
        if external_node:
            grouped_externals.setdefault(group_id, set()).add(external_node.name)
        if source_is_external:
            add_edge(group_id, other_id, edge.kind, edge.confidence)
        else:
            add_edge(other_id, group_id, edge.kind, edge.confidence)

    for group_id, names in grouped_externals.items():
        count = len(names)
        grouped_nodes[group_id].summary = f'{count} external symbol{"" if count == 1 else "s"}'

    referenced = {edge.source for edge in new_edges} | {edge.target for edge in new_edges}
    retained_nodes: list[SymbolNode] = [
        node for node in nodes
        if node.kind != 'external' or node.id in referenced
    ]
    retained_nodes.extend(grouped_nodes.values())
    return retained_nodes, new_edges


def _group_paths(repo_index, group: str) -> set[str]:
    allowed_paths = set()
    for node in repo_index.nodes.values():
        location = node.location
        if not location or not location.path:
            continue
        normalized = location.path.replace(os.sep, '/')
        if group == 'root':
            if '/' not in normalized:
                allowed_paths.add(normalized)
        elif normalized.startswith(f'{group}/'):
            allowed_paths.add(normalized)
    return allowed_paths


def _build_tree_toc(repo_index):
    groups = {}
    for node in repo_index.nodes.values():
        if node.kind != 'file' or not node.location or not node.location.path:
            continue
        normalized = node.location.path.replace(os.sep, '/')
        parts = normalized.split('/')
        group = 'root' if len(parts) == 1 else parts[0]
        groups.setdefault(group, 0)
        groups[group] += 1
    ordered_groups = sorted(groups.items(), key=lambda item: (item[0] != 'root', item[0]))
    toc = []
    for group, count in ordered_groups:
        title = 'Root files' if group == 'root' else f'Package: {group}'
        toc.append({
            'id': f'group:{group}',
            'title': title,
            'summary': f'{count} files',
            'scope': f'group:{group}',
        })
    return toc


def _build_story_toc(repo_index):
    paths_by_scope = _story_scope_paths(repo_index)
    chapters = []
    order = [
        ('story:entry', 'Entry points', 'Entry points that boot the app.'),
        ('story:config', 'Configuration', 'Settings and environment tuning.'),
        ('story:routes', 'Blueprints & Routes', 'Request flow and URL mapping.'),
        ('story:templates', 'Templates', 'Rendering and presentation clues.'),
        ('story:other', 'Other modules', 'Support code that fills in the gaps.'),
    ]
    for scope, title, fallback_summary in order:
        paths = paths_by_scope.get(scope, set())
        if not paths:
            continue
        summary = f'{len(paths)} files' if scope != 'story:templates' else f'{len(paths)} files (inferred)'
        chapters.append({
            'id': scope,
            'title': title,
            'summary': summary or fallback_summary,
            'scope': scope,
        })
    return chapters


def _story_scope_paths(repo_index):
    entry_names = {'flasky.py', 'manage.py', 'app.py', 'wsgi.py', 'asgi.py', 'main.py'}
    config_names = {'config.py', 'settings.py', 'configuration.py'}
    route_filenames = {'views.py', 'routes.py', 'handlers.py', 'controllers.py', 'blueprints.py', 'urls.py'}

    file_paths = set()
    for node in repo_index.nodes.values():
        if node.kind != 'file' or not node.location or not node.location.path:
            continue
        file_paths.add(node.location.path.replace(os.sep, '/'))

    entry_paths = {path for path in file_paths if os.path.basename(path) in entry_names}
    config_paths = {path for path in file_paths if os.path.basename(path) in config_names}

    route_paths = set()
    for path in file_paths:
        if os.path.basename(path) in route_filenames:
            route_paths.add(path)
    for node in repo_index.nodes.values():
        if node.kind == 'blueprint' and node.location and node.location.path:
            route_paths.add(node.location.path.replace(os.sep, '/'))

    template_paths = set()
    render_targets = {
        node_id for node_id, node in repo_index.nodes.items()
        if node.kind == 'external' and 'render_template' in node.name
    }
    if render_targets:
        for edge in repo_index.edges:
            if edge.target in render_targets:
                source_node = repo_index.nodes.get(edge.source)
                if source_node and source_node.location and source_node.location.path:
                    template_paths.add(source_node.location.path.replace(os.sep, '/'))

    assigned = set()

    def reserve(paths):
        reserved = {path for path in paths if path not in assigned}
        assigned.update(reserved)
        return reserved

    entry_paths = reserve(entry_paths)
    config_paths = reserve(config_paths)
    route_paths = reserve(route_paths)
    template_paths = reserve(template_paths)
    other_paths = file_paths - assigned

    return {
        'story:entry': entry_paths,
        'story:config': config_paths,
        'story:routes': route_paths,
        'story:templates': template_paths,
        'story:other': other_paths,
    }


def _default_repo_root() -> str:
    root_path = os.path.abspath(current_app.root_path)
    if os.path.isdir(os.path.join(root_path, 'app')):
        return root_path
    if os.path.basename(root_path) == 'app':
        return os.path.abspath(os.path.join(root_path, os.pardir))
    return root_path
