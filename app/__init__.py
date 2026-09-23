"""Flask application factory.

Routes are imported inside ``create_app`` so that ``app.config`` and
``app.db`` can be imported by the ETL code without pulling in the web layer.
"""

from flask import Flask, jsonify, render_template, request

from app import config

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
}


def create_app() -> Flask:
    config.load_local_env()
    app = Flask(
        __name__,
        static_folder=str(config.ROOT_DIR / "public" / "static"),
        static_url_path="/static",
    )
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    from app.routes import api, cron, pages

    app.register_blueprint(pages.bp)
    app.register_blueprint(api.bp)
    app.register_blueprint(cron.bp)

    @app.after_request
    def add_headers(response):
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return jsonify(error="找不到這個資源。"), 404
        return render_template("error.html", message="找不到這個頁面。"), 404

    @app.errorhandler(500)
    def server_error(_error):
        if request.path.startswith("/api/"):
            return jsonify(error="伺服器發生未預期的錯誤。"), 500
        return render_template("error.html", message="伺服器發生未預期的錯誤。"), 500

    return app
