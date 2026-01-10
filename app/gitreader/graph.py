import ast
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .models import GraphEdge, SourceLocation, SymbolNode, blueprint_id, external_id, file_id, symbol_id
from .parse_python import ParsedFile, doc_summary, signature_from_node


@dataclass
class GraphResult:
    nodes: Dict[str, SymbolNode]
    edges: List[GraphEdge]
    toc: List[Dict[str, str]]


def build_graph(parsed_files: List[ParsedFile]) -> GraphResult:
    nodes: Dict[str, SymbolNode] = {}
    edges: List[GraphEdge] = []

    module_map: Dict[str, str] = {}
    symbols_by_module: Dict[str, Dict[str, str]] = {}
    methods_by_class: Dict[Tuple[str, str], Dict[str, str]] = {}
    blueprint_vars: Dict[str, Dict[str, str]] = {}

    for parsed in parsed_files:
        file_node = SymbolNode(
            id=file_id(parsed.path),
            name=parsed.path,
            kind='file',
            summary='',
            module=parsed.module,
            location=SourceLocation(path=parsed.path),
        )
        nodes[file_node.id] = file_node
        module_map[parsed.module] = file_node.id
        symbols_by_module.setdefault(parsed.module, {})
        methods_by_class.setdefault((parsed.module, ''), {})

    for parsed in parsed_files:
        blueprint_vars[parsed.module] = _extract_blueprints(parsed, nodes, edges)
        _extract_symbols(parsed, nodes, edges, symbols_by_module, methods_by_class)

    imports_by_module: Dict[str, Dict[str, str]] = {}
    for parsed in parsed_files:
        alias_map = _extract_imports(parsed, module_map, nodes, edges)
        imports_by_module[parsed.module] = alias_map

    for parsed in parsed_files:
        _extract_calls(
            parsed,
            nodes,
            edges,
            symbols_by_module,
            methods_by_class,
            imports_by_module,
            module_map,
            blueprint_vars,
        )

    toc = build_toc([parsed.path for parsed in parsed_files])
    return GraphResult(nodes=nodes, edges=edges, toc=toc)


def _extract_symbols(
    parsed: ParsedFile,
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
    symbols_by_module: Dict[str, Dict[str, str]],
    methods_by_class: Dict[Tuple[str, str], Dict[str, str]],
) -> None:
    for node in parsed.tree.body:
        if isinstance(node, ast.ClassDef):
            class_id = symbol_id(f'{parsed.module}.{node.name}')
            class_node = SymbolNode(
                id=class_id,
                name=node.name,
                kind='class',
                summary=doc_summary(ast.get_docstring(node)),
                signature=signature_from_node(node, parsed.source),
                docstring=ast.get_docstring(node),
                location=_location_from_node(parsed.path, node),
                module=parsed.module,
            )
            nodes[class_id] = class_node
            symbols_by_module[parsed.module][node.name] = class_id
            edges.append(GraphEdge(
                source=file_id(parsed.path),
                target=class_id,
                kind='contains',
                confidence='high',
            ))
            methods_by_class[(parsed.module, node.name)] = {}
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    method_id = symbol_id(f'{parsed.module}.{node.name}.{item.name}')
                    method_node = SymbolNode(
                        id=method_id,
                        name=item.name,
                        kind='method',
                        summary=doc_summary(ast.get_docstring(item)),
                        signature=signature_from_node(item, parsed.source),
                        docstring=ast.get_docstring(item),
                        location=_location_from_node(parsed.path, item),
                        module=parsed.module,
                    )
                    nodes[method_id] = method_node
                    methods_by_class[(parsed.module, node.name)][item.name] = method_id
                    edges.append(GraphEdge(
                        source=class_id,
                        target=method_id,
                        kind='contains',
                        confidence='high',
                    ))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func_id = symbol_id(f'{parsed.module}.{node.name}')
            func_node = SymbolNode(
                id=func_id,
                name=node.name,
                kind='function',
                summary=doc_summary(ast.get_docstring(node)),
                signature=signature_from_node(node, parsed.source),
                docstring=ast.get_docstring(node),
                location=_location_from_node(parsed.path, node),
                module=parsed.module,
            )
            nodes[func_id] = func_node
            symbols_by_module[parsed.module][node.name] = func_id
            edges.append(GraphEdge(
                source=file_id(parsed.path),
                target=func_id,
                kind='contains',
                confidence='high',
            ))


def _extract_imports(
    parsed: ParsedFile,
    module_map: Dict[str, str],
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
) -> Dict[str, str]:
    alias_map: Dict[str, str] = {}
    for node in parsed.tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                module_name = alias.name
                alias_name = alias.asname or module_name.split('.')[-1]
                alias_map[alias_name] = module_name
                _add_import_edge(parsed.path, module_name, module_map, nodes, edges)
        elif isinstance(node, ast.ImportFrom):
            module_name = _resolve_import_module(parsed.module, node.module, node.level)
            if module_name:
                _add_import_edge(parsed.path, module_name, module_map, nodes, edges)
            for alias in node.names:
                alias_name = alias.asname or alias.name
                if module_name:
                    alias_map[alias_name] = f'{module_name}.{alias.name}'
                else:
                    alias_map[alias_name] = alias.name
    return alias_map


def _add_import_edge(
    source_path: str,
    module_name: str,
    module_map: Dict[str, str],
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
) -> None:
    if not module_name:
        return
    target_id = module_map.get(module_name)
    confidence = 'high'
    if not target_id:
        target_id = _ensure_external(nodes, module_name)
        confidence = 'low'
    edges.append(GraphEdge(
        source=file_id(source_path),
        target=target_id,
        kind='imports',
        confidence=confidence,
    ))


def _extract_calls(
    parsed: ParsedFile,
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
    symbols_by_module: Dict[str, Dict[str, str]],
    methods_by_class: Dict[Tuple[str, str], Dict[str, str]],
    imports_by_module: Dict[str, Dict[str, str]],
    module_map: Dict[str, str],
    blueprint_vars: Dict[str, Dict[str, str]],
) -> None:
    module_symbols = symbols_by_module.get(parsed.module, {})
    alias_map = imports_by_module.get(parsed.module, {})
    blueprint_map = blueprint_vars.get(parsed.module, {})

    for node in parsed.tree.body:
        if isinstance(node, ast.ClassDef):
            class_id = module_symbols.get(node.name)
            if class_id:
                _extract_inheritance(node, class_id, nodes, edges, module_map)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    method_id = methods_by_class.get((parsed.module, node.name), {}).get(item.name)
                    if method_id:
                        _walk_calls(
                            item,
                            method_id,
                            node.name,
                            nodes,
                            edges,
                            module_symbols,
                            methods_by_class,
                            alias_map,
                            module_map,
                            blueprint_map,
                        )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            func_id = module_symbols.get(node.name)
            if func_id:
                _walk_calls(
                    node,
                    func_id,
                    None,
                    nodes,
                    edges,
                    module_symbols,
                    methods_by_class,
                    alias_map,
                    module_map,
                    blueprint_map,
                )


def _walk_calls(
    func_node: ast.AST,
    source_id: str,
    current_class: Optional[str],
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
    module_symbols: Dict[str, str],
    methods_by_class: Dict[Tuple[str, str], Dict[str, str]],
    alias_map: Dict[str, str],
    module_map: Dict[str, str],
    blueprint_map: Dict[str, str],
) -> None:
    for node in ast.walk(func_node):
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name):
            target_name = node.func.id
            target_id = module_symbols.get(target_name)
            confidence = 'high'
            if not target_id and target_name in alias_map:
                target_id = _resolve_module_target(alias_map[target_name], module_map, nodes)
                confidence = 'medium'
            if not target_id:
                target_id = _ensure_external(nodes, target_name)
                confidence = 'low'
            edges.append(GraphEdge(
                source=source_id,
                target=target_id,
                kind='calls',
                confidence=confidence,
            ))
        elif isinstance(node.func, ast.Attribute):
            attr = node.func.attr
            if isinstance(node.func.value, ast.Name):
                base = node.func.value.id
                if base in ('self', 'cls') and current_class:
                    method_id = methods_by_class.get((nodes[source_id].module or '', current_class), {}).get(attr)
                    if method_id:
                        edges.append(GraphEdge(
                            source=source_id,
                            target=method_id,
                            kind='calls',
                            confidence='medium',
                        ))
                        continue
                if base in alias_map:
                    module_name = alias_map[base]
                    target_id = _resolve_module_target(module_name, module_map, nodes)
                    edges.append(GraphEdge(
                        source=source_id,
                        target=target_id,
                        kind='calls',
                        confidence='medium',
                    ))
                    continue
                if attr == 'register_blueprint' and node.args:
                    first_arg = node.args[0]
                    if isinstance(first_arg, ast.Name):
                        blueprint_id_value = blueprint_map.get(first_arg.id)
                        if blueprint_id_value:
                            edges.append(GraphEdge(
                                source=source_id,
                                target=blueprint_id_value,
                                kind='blueprint',
                                confidence='medium',
                            ))
                            continue
                target_id = _ensure_external(nodes, f'{base}.{attr}')
                edges.append(GraphEdge(
                    source=source_id,
                    target=target_id,
                    kind='calls',
                    confidence='low',
                ))
            else:
                target_id = _ensure_external(nodes, attr)
                edges.append(GraphEdge(
                    source=source_id,
                    target=target_id,
                    kind='calls',
                    confidence='low',
                ))


def _extract_inheritance(
    node: ast.ClassDef,
    class_id: str,
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
    module_map: Dict[str, str],
) -> None:
    for base in node.bases:
        if isinstance(base, ast.Name):
            target_id = _ensure_external(nodes, base.id)
        elif isinstance(base, ast.Attribute):
            target_id = _ensure_external(nodes, base.attr)
        else:
            continue
        edges.append(GraphEdge(
            source=class_id,
            target=target_id,
            kind='inherits',
            confidence='low',
        ))


def _extract_blueprints(
    parsed: ParsedFile,
    nodes: Dict[str, SymbolNode],
    edges: List[GraphEdge],
) -> Dict[str, str]:
    blueprint_vars: Dict[str, str] = {}
    for node in parsed.tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            if isinstance(node.value.func, ast.Name) and node.value.func.id == 'Blueprint':
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        blueprint_node_id = blueprint_id(target.id)
                        if blueprint_node_id not in nodes:
                            nodes[blueprint_node_id] = SymbolNode(
                                id=blueprint_node_id,
                                name=target.id,
                                kind='blueprint',
                                summary='',
                                location=_location_from_node(parsed.path, node),
                                module=parsed.module,
                            )
                            edges.append(GraphEdge(
                                source=file_id(parsed.path),
                                target=blueprint_node_id,
                                kind='contains',
                                confidence='medium',
                            ))
                        blueprint_vars[target.id] = blueprint_node_id
    return blueprint_vars


def _resolve_module_target(module_name: str, module_map: Dict[str, str], nodes: Dict[str, SymbolNode]) -> str:
    target_id = module_map.get(module_name)
    if target_id:
        return target_id
    return _ensure_external(nodes, module_name)


def _ensure_external(nodes: Dict[str, SymbolNode], name: str) -> str:
    node_id = external_id(name)
    if node_id not in nodes:
        nodes[node_id] = SymbolNode(
            id=node_id,
            name=name,
            kind='external',
            summary='',
        )
    return node_id


def _resolve_import_module(current_module: str, module: Optional[str], level: int) -> str:
    if level == 0:
        return module or ''
    if not current_module:
        return module or ''
    parts = current_module.split('.')
    if level <= len(parts):
        parts = parts[:-level]
    else:
        parts = []
    if module:
        parts.extend(module.split('.'))
    return '.'.join(parts)


def _location_from_node(path: str, node: ast.AST) -> SourceLocation:
    return SourceLocation(
        path=path,
        start_line=getattr(node, 'lineno', 0) or 0,
        end_line=getattr(node, 'end_lineno', 0) or 0,
        start_col=getattr(node, 'col_offset', 0) or 0,
        end_col=getattr(node, 'end_col_offset', 0) or 0,
    )


def build_toc(paths: List[str]) -> List[Dict[str, str]]:
    groups: Dict[str, List[str]] = {}
    for path in paths:
        parts = path.split(os.sep)
        if len(parts) == 1:
            group = 'root'
        else:
            group = parts[0]
        groups.setdefault(group, []).append(path)
    ordered_groups = sorted(groups.items(), key=lambda item: (item[0] != 'root', item[0]))
    toc: List[Dict[str, str]] = []
    for group, files in ordered_groups:
        title = 'Root files' if group == 'root' else f'Package: {group}'
        toc.append({
            'id': f'group:{group}',
            'title': title,
            'summary': f'{len(files)} files',
        })
    return toc
