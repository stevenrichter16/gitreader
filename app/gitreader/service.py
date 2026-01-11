import hashlib
import logging
import os
import time
from typing import Optional

from . import ingest, scan, storage
from .graph import build_graph
from .models import RepoIndex, RepoSpec
from .parse_python import parse_files


DEFAULT_MAX_FILE_SIZE = 512 * 1024
DEFAULT_MAX_FILES = 5000
DEFAULT_SNIPPET_LINES = 200
DEFAULT_FALLBACK_CONTEXT = 40
LOGGER = logging.getLogger(__name__)


def get_repo_index(
    spec: RepoSpec,
    cache_root: str,
    max_file_size: int = DEFAULT_MAX_FILE_SIZE,
    max_files: Optional[int] = DEFAULT_MAX_FILES,
) -> RepoIndex:
    start_time = time.perf_counter()
    repo_cache_root = os.path.join(cache_root, 'repos')
    index_cache_root = os.path.join(cache_root, 'index')

    os.makedirs(repo_cache_root, exist_ok=True)
    repo_start = time.perf_counter()
    handle = ingest.ensure_repo(spec, repo_cache_root)
    repo_elapsed = time.perf_counter() - repo_start
    scan_root = handle.root_path
    if spec.subdir:
        scan_root = os.path.join(handle.root_path, spec.subdir)
        if not os.path.isdir(scan_root):
            raise ValueError(f'Subdir not found: {spec.subdir}')

    scan_start = time.perf_counter()
    scan_result = scan.scan_repo(scan_root, max_file_size=max_file_size, max_files=max_files)
    scan_elapsed = time.perf_counter() - scan_start
    content_signature = _compute_signature(handle.commit_sha, scan_result)

    cached = storage.load_index(index_cache_root, handle.repo_id)
    if cached and cached.content_signature == content_signature:
        total_elapsed = time.perf_counter() - start_time
        LOGGER.info(
            'gitreader index cache hit repo=%s commit=%s files=%s python=%s nodes=%s edges=%s warnings=%s skipped=%s '
            'timing repo=%.3fs scan=%.3fs total=%.3fs',
            handle.repo_id,
            handle.commit_sha or 'unknown',
            scan_result.total_files,
            len(scan_result.python_files),
            cached.stats.get('nodes', len(cached.nodes)),
            cached.stats.get('edges', len(cached.edges)),
            cached.stats.get('warnings', len(cached.warnings)),
            len(scan_result.skipped_files),
            repo_elapsed,
            scan_elapsed,
            total_elapsed,
        )
        return cached

    parse_start = time.perf_counter()
    parsed = parse_files(scan_root, scan_result.python_files)
    parse_elapsed = time.perf_counter() - parse_start
    graph_start = time.perf_counter()
    graph = build_graph(parsed.files)
    graph_elapsed = time.perf_counter() - graph_start

    warnings = scan_result.warnings + parsed.warnings
    stats = {
        'total_files': scan_result.total_files,
        'total_bytes': scan_result.total_bytes,
        'python_files': len(scan_result.python_files),
        'skipped_files': len(scan_result.skipped_files),
        'nodes': len(graph.nodes),
        'edges': len(graph.edges),
        'warnings': len(warnings),
    }

    index = RepoIndex(
        repo_id=handle.repo_id,
        root_path=scan_root,
        commit_sha=handle.commit_sha,
        nodes=graph.nodes,
        edges=graph.edges,
        toc=graph.toc,
        warnings=warnings,
        stats=stats,
        content_signature=content_signature,
        generated_at=time.time(),
    )

    storage_start = time.perf_counter()
    storage.save_index(index_cache_root, index)
    storage_elapsed = time.perf_counter() - storage_start
    total_elapsed = time.perf_counter() - start_time
    LOGGER.info(
        'gitreader index built repo=%s commit=%s files=%s python=%s nodes=%s edges=%s warnings=%s skipped=%s '
        'timing repo=%.3fs scan=%.3fs parse=%.3fs graph=%.3fs store=%.3fs total=%.3fs',
        handle.repo_id,
        handle.commit_sha or 'unknown',
        scan_result.total_files,
        len(scan_result.python_files),
        len(graph.nodes),
        len(graph.edges),
        len(warnings),
        len(scan_result.skipped_files),
        repo_elapsed,
        scan_elapsed,
        parse_elapsed,
        graph_elapsed,
        storage_elapsed,
        total_elapsed,
    )
    return index


def get_symbol_snippet(
    spec: RepoSpec,
    cache_root: str,
    symbol_id: str,
    max_lines: int = DEFAULT_SNIPPET_LINES,
    section: str = 'full',
) -> dict:
    index = get_repo_index(spec, cache_root=cache_root)
    node = index.nodes.get(symbol_id)
    if not node:
        raise ValueError('Symbol not found')
    payload = build_symbol_snippet(index, node, max_lines=max_lines, section=section)
    payload['warnings'] = [warning.to_dict() for warning in index.warnings]
    payload['stats'] = dict(index.stats)
    return payload


def build_symbol_snippet(
    index: RepoIndex,
    node,
    max_lines: int = DEFAULT_SNIPPET_LINES,
    section: str = 'full',
) -> dict:
    if not node.location or not node.location.path:
        raise ValueError('Symbol has no location')

    source_path = os.path.join(index.root_path, node.location.path)
    lines = _read_source_lines(source_path)
    if not lines:
        raise ValueError('Source file is empty or unreadable')

    start_line, end_line, highlights = _resolve_snippet_range(
        node,
        lines=lines,
        total_lines=len(lines),
        max_lines=max_lines,
        section=section,
    )
    snippet_lines = lines[start_line - 1:end_line]
    snippet = ''.join(snippet_lines)
    line_count = max(0, end_line - start_line + 1)
    if node.kind == 'file':
        truncated = end_line < len(lines)
    else:
        truncated = line_count >= max_lines and end_line < len(lines)

    return {
        'id': node.id,
        'name': node.name,
        'kind': node.kind,
        'summary': node.summary,
        'signature': node.signature,
        'docstring': node.docstring,
        'location': node.location.to_dict(),
        'start_line': start_line,
        'end_line': end_line,
        'total_lines': len(lines),
        'truncated': truncated,
        'highlights': highlights,
        'section': section,
        'snippet': snippet,
    }


def _compute_signature(commit_sha: Optional[str], scan_result: scan.ScanResult) -> str:
    extensions = sorted(scan_result.extension_counts.items())
    payload = f'{commit_sha or ""}|{scan_result.total_files}|{scan_result.total_bytes}|{len(scan_result.python_files)}|{extensions}'
    return hashlib.sha1(payload.encode('utf-8', errors='replace')).hexdigest()


def _read_source_lines(path: str) -> list[str]:
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            return handle.readlines()
    except UnicodeDecodeError:
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as handle:
                return handle.readlines()
        except OSError:
            return []
    except OSError:
        return []


def _resolve_line_range(kind: str, location, total_lines: int, max_lines: int) -> tuple[int, int]:
    start_line = max(1, getattr(location, 'start_line', 1) or 1)
    end_line = getattr(location, 'end_line', 0) or 0
    if kind == 'file' and end_line <= 0:
        end_line = min(total_lines, start_line + max_lines - 1)
        return start_line, end_line
    if end_line < start_line:
        end_line = min(total_lines, start_line + DEFAULT_FALLBACK_CONTEXT - 1)
    if end_line - start_line + 1 > max_lines:
        end_line = min(total_lines, start_line + max_lines - 1)
    return start_line, min(end_line, total_lines)


def _resolve_snippet_range(
    node,
    lines: list[str],
    total_lines: int,
    max_lines: int,
    section: str,
) -> tuple[int, int, list[dict[str, object]]]:
    if section == 'body' and node.kind in ('function', 'method', 'class'):
        signature_line = max(1, getattr(node.location, 'start_line', 1) or 1)
        if total_lines > 0:
            signature_line = min(signature_line, total_lines)
        header_start = signature_line
        while header_start > 1:
            line = lines[header_start - 2].lstrip()
            if line.startswith('@'):
                header_start -= 1
            else:
                break
        body_start = min(signature_line + 1, total_lines)
        if body_start < 1:
            body_start = 1
        end_line = getattr(node.location, 'end_line', 0) or 0
        if end_line < body_start:
            end_line = min(total_lines, body_start + DEFAULT_FALLBACK_CONTEXT - 1)
        if end_line - header_start + 1 > max_lines:
            end_line = min(total_lines, header_start + max_lines - 1)
        highlights = []
        if header_start < signature_line:
            highlights.append({
                'label': 'decorators',
                'start_line': header_start,
                'end_line': signature_line - 1,
            })
        highlights.append({
            'label': 'signature',
            'start_line': signature_line,
            'end_line': signature_line,
        })
        if body_start <= end_line:
            highlights.append({
                'label': 'body_start',
                'start_line': body_start,
                'end_line': body_start,
            })
            if end_line != body_start:
                highlights.append({
                    'label': 'body_end',
                    'start_line': end_line,
                    'end_line': end_line,
                })
        return header_start, end_line, highlights

    start_line, end_line = _resolve_line_range(node.kind, node.location, total_lines, max_lines)
    highlights = [{
        'label': 'snippet_start',
        'start_line': start_line,
        'end_line': start_line,
    }]
    if end_line != start_line:
        highlights.append({
            'label': 'snippet_end',
            'start_line': end_line,
            'end_line': end_line,
        })
    return start_line, end_line, highlights
