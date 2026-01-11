import hashlib
import json
import logging
import os
import time
import urllib.request
from typing import Dict, List, Optional

from . import storage
from .models import RepoSpec, RepoIndex, SymbolNode
from .service import build_symbol_snippet, get_repo_index


LOGGER = logging.getLogger(__name__)
PROMPT_VERSION = 'v1'


def narrate_symbol(
    spec: RepoSpec,
    cache_root: str,
    symbol_id: str,
    mode: str,
    section: Optional[str] = None,
) -> Dict[str, object]:
    index = get_repo_index(spec, cache_root=cache_root)
    node = index.nodes.get(symbol_id)
    if not node:
        raise ValueError('Symbol not found')

    snippet_section = section or _default_section(node)
    snippet = build_symbol_snippet(index, node, section=snippet_section)
    cache_key = _narration_cache_key(index, node, mode, snippet)
    cache_root = os.path.join(cache_root, 'narration')
    cached = storage.load_narration(cache_root, index.repo_id, cache_key)
    if cached:
        cached['cached'] = True
        return cached

    context = _build_context(index, node)
    narration, source, model = _generate_narration(node, snippet, context, mode)
    response = {
        'mode': mode,
        'symbol_id': node.id,
        'symbol_name': node.name,
        'hook': narration['hook'],
        'summary': narration['summary'],
        'key_lines': narration['key_lines'],
        'connections': narration['connections'],
        'next_thread': narration['next_thread'],
        'cached': False,
        'source': source,
        'model': model,
        'prompt_version': PROMPT_VERSION,
    }
    storage.save_narration(cache_root, index.repo_id, cache_key, response)
    return response


def load_cached_narration(
    index: RepoIndex,
    node: SymbolNode,
    cache_root: str,
    mode: str,
    section: Optional[str] = None,
) -> Optional[Dict[str, object]]:
    snippet_section = section or _default_section(node)
    try:
        snippet = build_symbol_snippet(index, node, section=snippet_section)
    except ValueError:
        return None
    cache_key = _narration_cache_key(index, node, mode, snippet)
    narration_root = os.path.join(cache_root, 'narration')
    return storage.load_narration(narration_root, index.repo_id, cache_key)


def _default_section(node: SymbolNode) -> str:
    if node.kind in ('function', 'method', 'class'):
        return 'body'
    return 'full'


def _narration_cache_key(index: RepoIndex, node: SymbolNode, mode: str, snippet: Dict[str, object]) -> str:
    snippet_text = str(snippet.get('snippet') or '')
    snippet_hash = hashlib.sha1(snippet_text.encode('utf-8', errors='replace')).hexdigest()
    payload = '|'.join([
        index.repo_id,
        index.commit_sha or '',
        node.id,
        mode,
        snippet_hash,
        PROMPT_VERSION,
    ])
    return hashlib.sha1(payload.encode('utf-8', errors='replace')).hexdigest()


def _build_context(index: RepoIndex, node: SymbolNode) -> Dict[str, List[str]]:
    incoming: List[str] = []
    outgoing: List[str] = []
    max_edges = 8
    for edge in index.edges:
        if edge.source == node.id:
            target = index.nodes.get(edge.target)
            target_name = target.name if target else edge.target
            target_kind = target.kind if target else 'unknown'
            outgoing.append(f'{edge.kind} -> {target_name} ({target_kind})')
        elif edge.target == node.id:
            source = index.nodes.get(edge.source)
            source_name = source.name if source else edge.source
            source_kind = source.kind if source else 'unknown'
            incoming.append(f'{edge.kind} <- {source_name} ({source_kind})')
        if len(incoming) >= max_edges and len(outgoing) >= max_edges:
            break
    return {
        'incoming': incoming[:max_edges],
        'outgoing': outgoing[:max_edges],
    }


def _generate_narration(
    node: SymbolNode,
    snippet: Dict[str, object],
    context: Dict[str, List[str]],
    mode: str,
) -> tuple[Dict[str, object], str, str]:
    api_key = os.getenv('GITREADER_LLM_API_KEY') or os.getenv('OPENAI_API_KEY')
    model = os.getenv('GITREADER_LLM_MODEL', 'gpt-4o-mini')
    base_url = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1').rstrip('/')

    fallback = _fallback_narration(node, snippet, context)
    if not api_key:
        LOGGER.warning('gitreader narrator disabled: missing GITREADER_LLM_API_KEY or OPENAI_API_KEY')
        return fallback, 'fallback', model

    messages = _build_messages(node, snippet, context, mode)
    start_time = time.perf_counter()
    try:
        content = _call_openai(
            api_key=api_key,
            base_url=base_url,
            model=model,
            messages=messages,
        )
    except Exception as exc:
        LOGGER.warning('gitreader narrator failed: %s', exc)
        return fallback, 'fallback', model
    elapsed = time.perf_counter() - start_time
    LOGGER.info('gitreader narrator generated mode=%s symbol=%s model=%s time=%.2fs', mode, node.id, model, elapsed)

    parsed = _parse_narration(content)
    narration = _merge_with_fallback(parsed, fallback)
    return narration, 'openai', model


def _build_messages(
    node: SymbolNode,
    snippet: Dict[str, object],
    context: Dict[str, List[str]],
    mode: str,
) -> List[Dict[str, str]]:
    snippet_text = _format_snippet(snippet)
    signature = node.signature or ''
    docstring = node.docstring or ''
    location = node.location.to_dict() if node.location else {}
    incoming = '\n'.join(f'- {item}' for item in context.get('incoming', [])) or '- none'
    outgoing = '\n'.join(f'- {item}' for item in context.get('outgoing', [])) or '- none'

    system = (
        'You are the GitReader narrator. Respond only with valid JSON. '
        'Keep the tone vivid but precise. Use line numbers from the snippet for key_lines.'
    )
    user = (
        f'Mode: {mode}\n'
        f'Symbol: {node.name}\n'
        f'Kind: {node.kind}\n'
        f'Location: {location}\n'
        f'Signature: {signature}\n'
        f'Docstring: {docstring}\n'
        f'\nSnippet:\n{snippet_text}\n'
        f'\nGraph context (incoming):\n{incoming}\n'
        f'Graph context (outgoing):\n{outgoing}\n'
        'Return JSON with keys: '
        'hook (string), summary (array of 2-4 strings), '
        'key_lines (array of {"line": number, "text": string}), '
        'connections (array of strings), next_thread (string). '
        'If a field is unknown, return an empty string or empty list.'
    )
    return [
        {'role': 'system', 'content': system},
        {'role': 'user', 'content': user},
    ]


def _format_snippet(snippet: Dict[str, object]) -> str:
    raw = str(snippet.get('snippet') or '')
    start_line = int(snippet.get('start_line') or 1)
    lines = raw.splitlines()
    formatted = []
    for offset, line in enumerate(lines):
        formatted.append(f'{start_line + offset:>4} {line}')
    return '\n'.join(formatted) or '<<empty>>'


def _call_openai(
    api_key: str,
    base_url: str,
    model: str,
    messages: List[Dict[str, str]],
) -> str:
    payload = {
        'model': model,
        'messages': messages,
        'temperature': _env_float('GITREADER_LLM_TEMPERATURE', 0.4),
        'max_tokens': _env_int('GITREADER_LLM_MAX_TOKENS', 700),
    }
    body = json.dumps(payload).encode('utf-8')
    request = urllib.request.Request(
        f'{base_url}/chat/completions',
        data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
        method='POST',
    )
    timeout = _env_int('GITREADER_LLM_TIMEOUT', 30)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode('utf-8', errors='replace')
    payload = json.loads(raw)
    choices = payload.get('choices') if isinstance(payload, dict) else None
    if not choices:
        raise ValueError('No choices in LLM response')
    message = choices[0].get('message') if isinstance(choices[0], dict) else None
    content = message.get('content') if isinstance(message, dict) else None
    if not content:
        raise ValueError('Empty LLM response')
    return str(content)


def _parse_narration(content: str) -> Dict[str, object]:
    content = content.strip()
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        start = content.find('{')
        end = content.rfind('}')
        if start == -1 or end == -1 or end <= start:
            return {}
        try:
            payload = json.loads(content[start:end + 1])
        except json.JSONDecodeError:
            return {}
    if not isinstance(payload, dict):
        return {}
    return _normalize_payload(payload)


def _normalize_payload(payload: Dict[str, object]) -> Dict[str, object]:
    def _string(value: object) -> str:
        return str(value).strip() if value is not None else ''

    summary_items = []
    for item in payload.get('summary', []) or []:
        text = _string(item)
        if text:
            summary_items.append(text)

    key_lines = []
    for item in payload.get('key_lines', []) or []:
        if not isinstance(item, dict):
            continue
        try:
            line = int(item.get('line') or 0)
        except (TypeError, ValueError):
            line = 0
        text = _string(item.get('text'))
        if line > 0 and text:
            key_lines.append({'line': line, 'text': text})

    connections = []
    for item in payload.get('connections', []) or []:
        text = _string(item)
        if text:
            connections.append(text)

    return {
        'hook': _string(payload.get('hook')),
        'summary': summary_items,
        'key_lines': key_lines,
        'connections': connections,
        'next_thread': _string(payload.get('next_thread')),
    }


def _merge_with_fallback(primary: Dict[str, object], fallback: Dict[str, object]) -> Dict[str, object]:
    merged = dict(fallback)
    for key in ('hook', 'next_thread'):
        value = primary.get(key)
        if isinstance(value, str) and value.strip():
            merged[key] = value
    for key in ('summary', 'connections', 'key_lines'):
        value = primary.get(key)
        if isinstance(value, list) and value:
            merged[key] = value
    return merged


def _fallback_narration(
    node: SymbolNode,
    snippet: Dict[str, object],
    context: Dict[str, List[str]],
) -> Dict[str, object]:
    name = node.name
    hook = f'{name} hints at the next beat in the code story.'
    summary = [
        f'{name} establishes a new step in the flow.',
        'It wires together a small slice of behavior.',
        'The shape suggests where the next chapter connects.',
    ]
    key_lines = []
    for highlight in snippet.get('highlights', []) or []:
        if not isinstance(highlight, dict):
            continue
        line = highlight.get('start_line')
        label = highlight.get('label', 'key line')
        if isinstance(line, int) and line > 0:
            key_lines.append({'line': line, 'text': str(label).replace('_', ' ').title()})
    if not key_lines and isinstance(snippet.get('start_line'), int):
        key_lines.append({'line': int(snippet.get('start_line')), 'text': 'Snippet start'})
    connections = context.get('outgoing') or context.get('incoming') or [
        'Connections are still being mapped.',
    ]
    next_thread = 'Follow the nearest referenced symbol to continue the thread.'
    return {
        'hook': hook,
        'summary': summary,
        'key_lines': key_lines[:4],
        'connections': connections[:4],
        'next_thread': next_thread,
    }


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default
