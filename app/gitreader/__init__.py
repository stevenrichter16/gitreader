from flask import Blueprint

gitreader = Blueprint('gitreader', __name__)

from . import routes
