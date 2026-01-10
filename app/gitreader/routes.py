from flask import jsonify, render_template, request

from . import gitreader


@gitreader.route('/')
def index():
    return render_template('gitreader/index.html')


@gitreader.route('/api/toc')
def toc():
    chapters = [
        {
            'id': '1a',
            'title': 'Hello, world',
            'summary': 'A three-line Flask app that starts the story.',
        },
        {
            'id': '2a',
            'title': 'A complete application',
            'summary': 'The factory pattern and blueprints enter the scene.',
        },
        {
            'id': '2b',
            'title': 'Dynamic routes',
            'summary': 'URLs start carrying meaning with parameters.',
        },
        {
            'id': '3a',
            'title': 'Templates',
            'summary': 'HTML moves into Jinja templates and blocks.',
        },
    ]
    return jsonify({'chapters': chapters})


@gitreader.route('/api/graph')
def graph():
    graph_payload = {
        'nodes': [
            {
                'id': 'flasky.py',
                'name': 'flasky.py',
                'kind': 'file',
                'summary': 'Entry point for the application.',
            },
            {
                'id': 'app.create_app',
                'name': 'create_app',
                'kind': 'function',
                'summary': 'Application factory that wires extensions.',
            },
            {
                'id': 'main.index',
                'name': 'index',
                'kind': 'function',
                'summary': 'Default route returning the homepage.',
            },
        ],
        'edges': [
            {
                'source': 'flasky.py',
                'target': 'app.create_app',
                'kind': 'calls',
                'confidence': 'high',
            },
            {
                'source': 'app.create_app',
                'target': 'main.index',
                'kind': 'contains',
                'confidence': 'medium',
            },
        ],
    }
    return jsonify(graph_payload)


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
