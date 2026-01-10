from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Union


@dataclass
class SourceLocation:
    path: str
    start_line: int = 0
    end_line: int = 0
    start_col: int = 0
    end_col: int = 0

    def to_dict(self) -> Dict[str, Union[int, str]]:
        return {
            'path': self.path,
            'start_line': self.start_line,
            'end_line': self.end_line,
            'start_col': self.start_col,
            'end_col': self.end_col,
        }


@dataclass
class SymbolNode:
    id: str
    name: str
    kind: str
    summary: str = ''
    signature: Optional[str] = None
    docstring: Optional[str] = None
    location: Optional[SourceLocation] = None
    module: Optional[str] = None

    def to_dict(self) -> Dict[str, object]:
        payload: Dict[str, object] = {
            'id': self.id,
            'name': self.name,
            'kind': self.kind,
            'summary': self.summary,
        }
        if self.signature:
            payload['signature'] = self.signature
        if self.docstring:
            payload['docstring'] = self.docstring
        if self.location:
            payload['location'] = self.location.to_dict()
        if self.module:
            payload['module'] = self.module
        return payload


@dataclass
class GraphEdge:
    source: str
    target: str
    kind: str
    confidence: str = 'low'

    def to_dict(self) -> Dict[str, str]:
        return {
            'source': self.source,
            'target': self.target,
            'kind': self.kind,
            'confidence': self.confidence,
        }


@dataclass
class ParseWarning:
    code: str
    message: str
    path: str
    line: Optional[int] = None

    def to_dict(self) -> Dict[str, object]:
        payload: Dict[str, object] = {
            'code': self.code,
            'message': self.message,
            'path': self.path,
        }
        if self.line is not None:
            payload['line'] = self.line
        return payload


@dataclass
class RepoSpec:
    repo_url: Optional[str] = None
    ref: Optional[str] = None
    subdir: Optional[str] = None
    local_path: Optional[str] = None

    def repo_key(self) -> str:
        parts = [self.repo_url or '', self.local_path or '', self.ref or '', self.subdir or '']
        return '|'.join(parts)


@dataclass
class RepoIndex:
    repo_id: str
    root_path: str
    commit_sha: Optional[str]
    nodes: Dict[str, SymbolNode] = field(default_factory=dict)
    edges: List[GraphEdge] = field(default_factory=list)
    toc: List[Dict[str, str]] = field(default_factory=list)
    warnings: List[ParseWarning] = field(default_factory=list)
    stats: Dict[str, int] = field(default_factory=dict)
    content_signature: Optional[str] = None
    generated_at: float = 0.0

    def to_dict(self) -> Dict[str, object]:
        return {
            'repo_id': self.repo_id,
            'root_path': self.root_path,
            'commit_sha': self.commit_sha,
            'nodes': [node.to_dict() for node in self.nodes.values()],
            'edges': [edge.to_dict() for edge in self.edges],
            'toc': list(self.toc),
            'warnings': [warning.to_dict() for warning in self.warnings],
            'stats': dict(self.stats),
            'content_signature': self.content_signature,
            'generated_at': self.generated_at,
        }

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> 'RepoIndex':
        nodes: Dict[str, SymbolNode] = {}
        for raw in payload.get('nodes', []):
            location = None
            raw_location = raw.get('location') if isinstance(raw, dict) else None
            if isinstance(raw_location, dict):
                location = SourceLocation(
                    path=str(raw_location.get('path', '')),
                    start_line=int(raw_location.get('start_line', 0)),
                    end_line=int(raw_location.get('end_line', 0)),
                    start_col=int(raw_location.get('start_col', 0)),
                    end_col=int(raw_location.get('end_col', 0)),
                )
            node = SymbolNode(
                id=str(raw.get('id', '')),
                name=str(raw.get('name', '')),
                kind=str(raw.get('kind', '')),
                summary=str(raw.get('summary', '')),
                signature=raw.get('signature'),
                docstring=raw.get('docstring'),
                location=location,
                module=raw.get('module'),
            )
            nodes[node.id] = node
        edges = [
            GraphEdge(
                source=str(edge.get('source', '')),
                target=str(edge.get('target', '')),
                kind=str(edge.get('kind', '')),
                confidence=str(edge.get('confidence', 'low')),
            )
            for edge in payload.get('edges', [])
            if isinstance(edge, dict)
        ]
        warnings = [
            ParseWarning(
                code=str(warning.get('code', 'warning')),
                message=str(warning.get('message', '')),
                path=str(warning.get('path', '')),
                line=warning.get('line'),
            )
            for warning in payload.get('warnings', [])
            if isinstance(warning, dict)
        ]
        return cls(
            repo_id=str(payload.get('repo_id', '')),
            root_path=str(payload.get('root_path', '')),
            commit_sha=payload.get('commit_sha'),
            nodes=nodes,
            edges=edges,
            toc=list(payload.get('toc', [])),
            warnings=warnings,
            stats=dict(payload.get('stats', {})),
            content_signature=payload.get('content_signature'),
            generated_at=float(payload.get('generated_at', 0.0)),
        )


def file_id(path: str) -> str:
    return f'file:{path}'


def symbol_id(qualname: str) -> str:
    return f'symbol:{qualname}'


def external_id(name: str) -> str:
    return f'external:{name}'


def blueprint_id(name: str) -> str:
    return f'blueprint:{name}'
