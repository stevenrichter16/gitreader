import ast
import os
from dataclasses import dataclass
from typing import List, Optional

from .models import ParseWarning


@dataclass
class ParsedFile:
    path: str
    module: str
    tree: ast.AST
    source: str


@dataclass
class ParsedPython:
    files: List[ParsedFile]
    warnings: List[ParseWarning]


def parse_files(root_path: str, rel_paths: List[str]) -> ParsedPython:
    parsed_files: List[ParsedFile] = []
    warnings: List[ParseWarning] = []
    for rel_path in rel_paths:
        full_path = os.path.join(root_path, rel_path)
        source = _read_source(full_path, rel_path, warnings)
        if source is None:
            continue
        try:
            tree = ast.parse(source, filename=rel_path)
        except SyntaxError as exc:
            warnings.append(ParseWarning(
                code='syntax_error',
                message=str(exc.msg),
                path=rel_path,
                line=exc.lineno,
            ))
            continue
        module_path = module_path_from_file(rel_path)
        parsed_files.append(ParsedFile(
            path=rel_path,
            module=module_path,
            tree=tree,
            source=source,
        ))
    return ParsedPython(files=parsed_files, warnings=warnings)


def module_path_from_file(rel_path: str) -> str:
    module_path = rel_path.replace(os.sep, '.')
    if module_path.endswith('.py'):
        module_path = module_path[:-3]
    if module_path.endswith('.__init__'):
        module_path = module_path[:-len('.__init__')]
    return module_path.strip('.')


def _read_source(full_path: str, rel_path: str, warnings: List[ParseWarning]) -> Optional[str]:
    try:
        with open(full_path, 'r', encoding='utf-8') as handle:
            return handle.read()
    except UnicodeDecodeError:
        try:
            with open(full_path, 'r', encoding='utf-8', errors='replace') as handle:
                warnings.append(ParseWarning(
                    code='decode_lossy',
                    message='Decoded with replacement characters',
                    path=rel_path,
                ))
                return handle.read()
        except OSError as exc:
            warnings.append(ParseWarning(
                code='read_failed',
                message=str(exc),
                path=rel_path,
            ))
            return None
    except OSError as exc:
        warnings.append(ParseWarning(
            code='read_failed',
            message=str(exc),
            path=rel_path,
        ))
        return None


def signature_from_node(node: ast.AST, source: str) -> Optional[str]:
    segment = ast.get_source_segment(source, node)
    if not segment:
        return None
    line = segment.strip().splitlines()[0].strip()
    if line.endswith(':'):
        return line[:-1]
    return line


def doc_summary(docstring: Optional[str]) -> str:
    if not docstring:
        return ''
    return docstring.strip().splitlines()[0].strip()
