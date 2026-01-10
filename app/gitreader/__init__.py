from flask import Blueprint

gitreader = Blueprint(
    'gitreader',
    __name__,
    template_folder='../templates',
    static_folder='../static',
)

from . import routes
