from base64 import b64encode
from datetime import datetime
from html import escape
from pathlib import Path

from flask import Response, flash, jsonify, make_response, redirect, render_template_string, request, send_from_directory, url_for


BASE_DIR = Path(__file__).resolve().parent
ROUTE_KEY = "manger"
CLIENTS_HTML = (BASE_DIR / "client-manger.html").read_text()
CLIENT_SCRIPT_HTML = """
<!DOCTYPE html><html><head><title>Client Script</title></head><body>
<h1>Client Script Loader</h1>
<p>Copy this script to your website to connect with our client manager:</p>
<pre>
&lt;script src="http://localhost:5001/client_script.js"&gt;&lt;/script&gt;
</pre>
<p><a href="/">Back Home</a></p>
</body></html>
"""
CLIENT_SCRIPT_JS = (BASE_DIR / "client.js").read_text()
HELP_HTML = """
<!DOCTYPE html><html><head><title>Help</title></head><body>
<h1>Help</h1>
<ul>
<li><a href="/shortener">URL Shortener</a></li>
<li><a href="/clients">Client Manager</a></li>
</ul>
<p><a href="/">Back Home</a></p>
</body></html>
"""


def register_routes(app, state):
    clients = state["clients"]
    data_lock = state["data_lock"]
    save_json = state["save_json"]
    normalize_client_effect = state["normalize_client_effect"]
    clients_json_path = state["clients_json_path"]
    lockdown_state = state["lockdown"]

    def decode_xor_hex(value):
        if not value:
            return ""
        value = value.strip()
        if len(value) % 2:
            return value
        try:
            out = []
            for index in range(0, len(value), 2):
                byte = int(value[index : index + 2], 16)
                key_code = ord(ROUTE_KEY[(index // 2) % len(ROUTE_KEY)])
                out.append(chr(byte ^ key_code))
            return "".join(out)
        except ValueError:
            return value

    @app.route("/clients", methods=["GET"])
    def clients_index():
        return render_template_string(CLIENTS_HTML)

    @app.route("/clients.json")
    def clients_json():
        now = datetime.utcnow()
        with data_lock:
            snapshot = dict(clients)
        clients_display = {}
        for user, data in snapshot.items():
            last_ping = data.get("last_ping")
            recent = False
            if last_ping:
                try:
                    last_dt = datetime.strptime(last_ping, "%Y-%m-%d %H:%M:%S")
                    recent = (now - last_dt).total_seconds() < 10
                except ValueError:
                    recent = False
            clients_display[user] = {**data, "recent": recent}
        return jsonify(clients_display)

    @app.route("/clients/ban", methods=["POST"])
    def ban_client():
        username = request.form.get("username", "").strip()
        if not username:
            return redirect(url_for("clients_index"))
        with data_lock:
            clients.setdefault(username, {})["banned"] = True
            save_json(clients_json_path, clients)
        resp = make_response(redirect(url_for("clients_index")))
        resp.set_cookie(f"ban_{username}", "1")
        return resp

    @app.route("/clients/unban", methods=["POST"])
    def unban_client():
        username = request.form.get("username", "").strip()
        with data_lock:
            if username in clients:
                clients[username]["banned"] = False
                save_json(clients_json_path, clients)
        resp = make_response(redirect(url_for("clients_index")))
        resp.set_cookie(f"ban_{username}", "", expires=0)
        return resp

    @app.route("/clients/delete", methods=["POST"])
    def delete_client():
        username = request.form.get("username", "").strip()
        with data_lock:
            if username in clients:
                del clients[username]
                save_json(clients_json_path, clients)
        return redirect(url_for("clients_index"))

    @app.route("/clients/image", methods=["POST"])
    def send_image_to_client():
        username = request.form.get("username", "").strip()
        file = request.files.get("image_file")

        if not username:
            flash("No username provided.")
            return redirect(url_for("clients_index"))

        if not file:
            flash("No image file uploaded.")
            return redirect(url_for("clients_index"))

        try:
            b64_data = b64encode(file.read()).decode()
            with data_lock:
                clients.setdefault(username, {})["image"] = (
                    f"data:{file.content_type};base64,{b64_data}"
                )
                save_json(clients_json_path, clients)
        except Exception as e:
            flash(f"Error saving image: {e}")
            return redirect(url_for("clients_index"))

        return redirect(url_for("clients_index"))

    @app.route("/clients/message", methods=["POST"])
    def send_message_to_client():
        username = request.form.get("username", "").strip()
        message = request.form.get("message", "").strip()

        if username and message:
            with data_lock:
                clients.setdefault(username, {})["message"] = message
                save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/clients/note", methods=["POST"])
    def set_client_note():
        username = request.form.get("username", "").strip()
        note = request.form.get("note", "").strip()

        if username:
            with data_lock:
                clients.setdefault(username, {})["note"] = note
                save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/client_script")
    def client_script_page():
        return render_template_string(CLIENT_SCRIPT_HTML)

    @app.route("/client_script.js")
    def client_script_js():
        return Response(CLIENT_SCRIPT_JS, content_type="application/javascript")

    @app.route("/panel.js")
    def clients_js():
        return send_from_directory(BASE_DIR, "panel.js", mimetype="application/javascript")

    @app.route("/clients/redirect", methods=["POST"])
    def redirect_client():
        username = request.form.get("username", "").strip()
        url = decode_xor_hex(request.form.get("u", "").strip()) or request.form.get("url", "").strip()

        if username and url:
            with data_lock:
                clients.setdefault(username, {})["redirect"] = url
                save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/clients/effect", methods=["POST"])
    def set_client_effect():
        username = request.form.get("username", "").strip()
        effect = normalize_client_effect(request.form.get("effect", ""))

        if username:
            with data_lock:
                clients.setdefault(username, {})["effect"] = effect
                save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/clients/<path:subpath>", methods=["POST"])
    def clients_fallback(subpath):
        username = request.form.get("username", "").strip()
        if not username:
            return redirect(url_for("clients_index"))

        if "note" in request.form:
            note = request.form.get("note", "").strip()
            with data_lock:
                clients.setdefault(username, {})["note"] = note
                save_json(clients_json_path, clients)
        elif "effect" in request.form:
            effect = normalize_client_effect(request.form.get("effect", ""))
            with data_lock:
                clients.setdefault(username, {})["effect"] = effect
                save_json(clients_json_path, clients)
        elif "message" in request.form:
            message = request.form.get("message", "").strip()
            if message:
                with data_lock:
                    clients.setdefault(username, {})["message"] = message
                    save_json(clients_json_path, clients)
        else:
            url = decode_xor_hex(request.form.get("u", "").strip()) or request.form.get("url", "").strip()
            if url:
                with data_lock:
                    clients.setdefault(username, {})["redirect"] = url
                    save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/help")
    def help_page():
        return render_template_string(HELP_HTML)

    @app.route("/client_status")
    def client_status():
        user = request.args.get("user", "").strip()
        current_url = decode_xor_hex(request.args.get("u", "").strip()) or request.args.get("url", "").strip()

        if not user:
            return jsonify(
                {
                    "banned": False,
                    "redirect": None,
                    "image": None,
                    "message": None,
                    "note": None,
                    "effect": None,
                    "last_ping": None,
                    "current_url": None,
                }
            )

        with data_lock:
            if user not in clients:
                clients[user] = {
                    "banned": False,
                    "redirect": None,
                    "image": None,
                    "message": None,
                    "note": "",
                    "effect": "",
                    "last_ping": None,
                    "current_url": None,
                }

            status = clients[user]

            redirect_url = status.get("redirect")
            if redirect_url:
                clients[user]["redirect"] = None

            image_b64 = status.get("image")
            if image_b64:
                clients[user]["image"] = None

            message_text = status.get("message")
            if message_text:
                clients[user]["message"] = None

            note_text = status.get("note")

            last_ping = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            clients[user]["last_ping"] = last_ping
            clients[user]["current_url"] = current_url or status.get("current_url")

            save_json(clients_json_path, clients)

            lockdown_url = lockdown_state["url"]
            lockdown_active = lockdown_state["active"]

        return jsonify(
            {
                "banned": status.get("banned", False),
                "redirect": redirect_url if not lockdown_active else lockdown_url,
                "image": image_b64,
                "message": message_text,
                "note": note_text,
                "effect": normalize_client_effect(status.get("effect")),
                "last_ping": last_ping,
                "current_url": clients[user]["current_url"],
                "lockdown": lockdown_active,
            }
        )

    @app.route("/lockdown", methods=["POST"])
    def lockdown():
        action = request.form.get("action")
        url = decode_xor_hex(request.form.get("u", "").strip()) or request.form.get("url", "https://www.google.com")
        if action == "on":
            lockdown_state["active"] = True
            lockdown_state["url"] = url
        else:
            lockdown_state["active"] = False
        return jsonify({"success": True, "lockdown": lockdown_state["active"], "url": lockdown_state["url"]})

    @app.route("/lockdown.json")
    def lockdown_status():
        return jsonify({"active": lockdown_state["active"], "url": lockdown_state["url"]})
