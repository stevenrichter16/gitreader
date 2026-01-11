import os
import tempfile
import unittest

os.environ.setdefault('SERVER_NAME', 'localhost')

from app.gitreader.graph import build_graph
from app.gitreader.models import RepoSpec, file_id, symbol_id
from app.gitreader.parse_python import module_path_from_file, parse_files
from app.gitreader.service import get_repo_index


class ModulePathTests(unittest.TestCase):
    def test_module_path_from_file(self):
        cases = {
            'app/main/views.py': 'app.main.views',
            'app/__init__.py': 'app',
            'app/main/__init__.py': 'app.main',
            'flasky.py': 'flasky',
        }
        for rel_path, expected in cases.items():
            with self.subTest(rel_path=rel_path):
                self.assertEqual(module_path_from_file(rel_path), expected)


class GraphResolutionTests(unittest.TestCase):
    def test_import_alias_and_call_resolution(self):
        sources = {
            'pkg/foo.py': 'def ping():\n    return "pong"\n',
            'pkg/helper.py': 'def helper():\n    return 1\n',
            'main.py': (
                'import pkg.foo as foo\n'
                'from pkg import helper as helper_alias\n'
                '\n'
                'def ping():\n'
                '    return 1\n'
                '\n'
                'class Greeter:\n'
                '    def greet(self):\n'
                '        self.say()\n'
                '    def say(self):\n'
                '        return "hi"\n'
                '\n'
                'def caller():\n'
                '    foo.ping()\n'
                '    helper_alias()\n'
                '    ping()\n'
            ),
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            for rel_path, content in sources.items():
                full_path = os.path.join(tmpdir, rel_path)
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, 'w', encoding='utf-8') as handle:
                    handle.write(content)
            parsed = parse_files(tmpdir, list(sources.keys()))
            graph = build_graph(parsed.files)

        caller_id = symbol_id('main.caller')
        greet_id = symbol_id('main.Greeter.greet')
        say_id = symbol_id('main.Greeter.say')
        local_ping_id = symbol_id('main.ping')
        foo_file_id = file_id('pkg/foo.py')
        helper_file_id = file_id('pkg/helper.py')

        def has_edge(source, target, kind):
            return any(
                edge.source == source and edge.target == target and edge.kind == kind
                for edge in graph.edges
            )

        self.assertTrue(has_edge(caller_id, foo_file_id, 'calls'))
        self.assertTrue(has_edge(caller_id, helper_file_id, 'calls'))
        self.assertTrue(has_edge(caller_id, local_ping_id, 'calls'))
        self.assertTrue(has_edge(greet_id, say_id, 'calls'))


class IntegrationGraphTests(unittest.TestCase):
    def test_flasky_index_contains_expected_nodes(self):
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
        with tempfile.TemporaryDirectory() as cache_root:
            index = get_repo_index(RepoSpec(local_path=repo_root), cache_root=cache_root)
        self.assertIn(symbol_id('app.create_app'), index.nodes)
        self.assertTrue(
            any(node.kind == 'blueprint' and node.name == 'main' for node in index.nodes.values()),
            'Expected a blueprint node named "main"',
        )

    def test_messy_repo_with_syntax_error(self):
        with tempfile.TemporaryDirectory() as repo_root:
            with open(os.path.join(repo_root, 'good.py'), 'w', encoding='utf-8') as handle:
                handle.write('def ok():\n    return 1\n')
            with open(os.path.join(repo_root, 'bad.py'), 'w', encoding='utf-8') as handle:
                handle.write('def broken(\n    return 2\n')
            with tempfile.TemporaryDirectory() as cache_root:
                index = get_repo_index(RepoSpec(local_path=repo_root), cache_root=cache_root)

        warning_codes = {warning.code for warning in index.warnings}
        self.assertIn('syntax_error', warning_codes)
        self.assertIn(symbol_id('good.ok'), index.nodes)
