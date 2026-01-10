import os
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .models import ParseWarning


DEFAULT_SKIP_DIRS = {
    '.git',
    '.hg',
    '.svn',
    '__pycache__',
    'node_modules',
    'instance',
    'venv',
    '.venv',
    'dist',
    'build',
}


@dataclass
class ScanResult:
    python_files: List[str] = field(default_factory=list)
    extension_counts: Dict[str, int] = field(default_factory=dict)
    skipped_files: List[str] = field(default_factory=list)
    warnings: List[ParseWarning] = field(default_factory=list)
    total_files: int = 0
    total_bytes: int = 0


def scan_repo(root_path: str, max_file_size: int, max_files: Optional[int] = None) -> ScanResult:
    result = ScanResult()
    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [d for d in dirnames if d not in DEFAULT_SKIP_DIRS]
        for filename in filenames:
            if max_files is not None and len(result.python_files) >= max_files:
                return result
            full_path = os.path.join(dirpath, filename)
            rel_path = os.path.relpath(full_path, root_path)
            try:
                stat = os.stat(full_path)
            except OSError:
                result.warnings.append(ParseWarning(
                    code='stat_failed',
                    message='Unable to stat file',
                    path=rel_path,
                ))
                continue
            result.total_files += 1
            result.total_bytes += stat.st_size
            if stat.st_size > max_file_size:
                result.skipped_files.append(rel_path)
                result.warnings.append(ParseWarning(
                    code='file_too_large',
                    message=f'Skipped file larger than {max_file_size} bytes',
                    path=rel_path,
                ))
                continue
            if _is_binary(full_path):
                result.skipped_files.append(rel_path)
                result.warnings.append(ParseWarning(
                    code='binary_file',
                    message='Skipped binary file',
                    path=rel_path,
                ))
                continue
            _, ext = os.path.splitext(filename)
            ext = ext.lower()
            result.extension_counts[ext] = result.extension_counts.get(ext, 0) + 1
            if ext == '.py':
                result.python_files.append(rel_path)
    return result


def _is_binary(path: str) -> bool:
    try:
        with open(path, 'rb') as handle:
            chunk = handle.read(1024)
    except OSError:
        return True
    return b'\0' in chunk
