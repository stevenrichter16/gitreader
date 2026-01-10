import os

from flask import current_app, jsonify, render_template, request

from . import gitreader
from .models import RepoSpec
from .service import get_repo_index, get_symbol_snippet


@gitreader.route('/')
def index():
    return render_template('gitreader/index.html')


@gitreader.route('/api/toc')
def toc():
    spec = _repo_spec_from_request()
    try:
        repo_index = _load_index(spec)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400
    return jsonify({
        'chapters': repo_index.toc,
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
    if not scope or scope == 'full' or not scope.startswith('group:'):
        return list(repo_index.nodes.values()), list(repo_index.edges)
    group = scope[len('group:'):]
    allowed = set()
    for node in repo_index.nodes.values():
        location = node.location
        if not location or not location.path:
            continue
        normalized = location.path.replace(os.sep, '/')
        if group == 'root':
            if '/' not in normalized:
                allowed.add(node.id)
        elif normalized.startswith(f'{group}/'):
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


def _default_repo_root() -> str:
    root_path = os.path.abspath(current_app.root_path)
    if os.path.isdir(os.path.join(root_path, 'app')):
        return root_path
    if os.path.basename(root_path) == 'app':
        return os.path.abspath(os.path.join(root_path, os.pardir))
    return root_path
