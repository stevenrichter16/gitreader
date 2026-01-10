import hashlib
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Optional

from .models import RepoSpec


@dataclass
class RepoHandle:
    repo_id: str
    root_path: str
    commit_sha: Optional[str]


def ensure_repo(spec: RepoSpec, cache_root: str) -> RepoHandle:
    if spec.local_path:
        root_path = os.path.abspath(spec.local_path)
        commit_sha = _get_commit_sha(root_path)
        return RepoHandle(repo_id=_repo_id_for_spec(spec), root_path=root_path, commit_sha=commit_sha)

    if not spec.repo_url:
        raise ValueError('repo_url or local_path is required')

    repo_id = _repo_id_for_spec(spec)
    repo_path = os.path.join(cache_root, repo_id)
    if not os.path.isdir(repo_path):
        _run_git(['clone', '--depth', '1', spec.repo_url, repo_path])
    else:
        _run_git(['fetch', '--depth', '1', 'origin'], cwd=repo_path)

    if spec.ref:
        _run_git(['checkout', spec.ref], cwd=repo_path)
    else:
        _run_git(['checkout', 'HEAD'], cwd=repo_path)

    commit_sha = _get_commit_sha(repo_path)
    return RepoHandle(repo_id=repo_id, root_path=repo_path, commit_sha=commit_sha)


def _run_git(args, cwd: Optional[str] = None) -> None:
    subprocess.check_call(['git'] + args, cwd=cwd)


def _get_commit_sha(repo_path: str) -> Optional[str]:
    git_dir = os.path.join(repo_path, '.git')
    if not os.path.exists(git_dir):
        return None
    try:
        output = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo_path)
    except subprocess.CalledProcessError:
        return None
    return output.decode('utf-8', errors='replace').strip() or None


def _repo_id_for_spec(spec: RepoSpec) -> str:
    raw = spec.repo_key().encode('utf-8', errors='replace')
    slug = hashlib.sha1(raw).hexdigest()[:12]
    if spec.repo_url:
        name = _slugify(spec.repo_url)
    else:
        name = _slugify(spec.local_path or 'local')
    return f'{name}-{slug}'


def _slugify(value: str) -> str:
    value = value.strip().replace(os.sep, '-')
    value = re.sub(r'[^a-zA-Z0-9._-]+', '-', value)
    return value.strip('-').lower() or 'repo'
