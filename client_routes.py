from base64 import b64encode
from datetime import datetime
from html import escape
from pathlib import Path
import re
import time
import json

from flask import (
    Response,
    flash,
    jsonify,
    make_response,
    redirect,
    render_template_string,
    request,
    send_from_directory,
    url_for,
)


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

    def parse_duration_seconds(value):
        text = (value or "").strip().lower()
        if not text:
            return 0
        if text.isdigit():
            return int(text)

        total = 0
        matched = False
        for amount, unit in re.findall(r"(\d+)\s*([smhd])", text):
            matched = True
            amount = int(amount)
            if unit == "s":
                total += amount
            elif unit == "m":
                total += amount * 60
            elif unit == "h":
                total += amount * 3600
            elif unit == "d":
                total += amount * 86400

        return total if matched and total > 0 else 0

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

            timeout_until = data.get("timeout_until")
            timeout_active = False
            timeout_remaining = None
            if timeout_until:
                try:
                    timeout_remaining = max(0, int(timeout_until - time.time()))
                    timeout_active = timeout_remaining > 0
                except (TypeError, ValueError):
                    timeout_until = None

            if timeout_until and not timeout_active:
                with data_lock:
                    if user in clients:
                        clients[user]["timeout_reason"] = None
                        clients[user]["timeout_set_at"] = None
                        clients[user]["timeout_until"] = None
                        clients[user]["timeout_duration_seconds"] = None
                        save_json(clients_json_path, clients)
                timeout_remaining = 0

            clients_display[user] = {**data, "recent": recent}
            clients_display[user]["timeout_remaining_seconds"] = timeout_remaining
            clients_display[user]["timeout_active"] = timeout_active
        resp = jsonify(clients_display)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

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
        image_base64 = request.form.get("image", "").strip()

        if not username:
            flash("No username provided.")
            return redirect(url_for("clients_index"))

        image_data = None

        if image_base64:
            image_data = image_base64
        elif file:
            try:
                image_data = (
                    f"data:{file.content_type};base64,{b64encode(file.read()).decode()}"
                )
            except Exception as e:
                flash(f"Error reading image: {e}")
                return redirect(url_for("clients_index"))
        else:
            flash("No image file uploaded.")
            return redirect(url_for("clients_index"))

        if image_data:
            with data_lock:
                clients.setdefault(username, {})["image"] = image_data
                save_json(clients_json_path, clients)

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

    @app.route("/clients/question", methods=["POST"])
    def send_question_to_client():
        username = request.form.get("username", "").strip()
        question = request.form.get("question", "").strip()
        answer = request.form.get("answer", "").strip().lower()

        if not username:
            return redirect(url_for("clients_index"))

        with data_lock:
            client = clients.setdefault(username, {})
            if question:
                client["question"] = question
                client["question_answer"] = None
                client["question_asked_at"] = datetime.utcnow().strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                client["question_answered_at"] = None
                save_json(clients_json_path, clients)
            elif not question and not answer:
                # Clear question if empty question sent
                client["question"] = None
                client["question_answer"] = None
                client["question_asked_at"] = None
                client["question_answered_at"] = None
                save_json(clients_json_path, clients)
            elif answer in {"yes", "no"}:
                client["question_answer"] = answer
                client["question"] = None
                client["question_answered_at"] = datetime.utcnow().strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/clients/timeout", methods=["POST"])
    def send_timeout_to_client():
        username = request.form.get("username", "").strip()
        duration = request.form.get("duration", "").strip()
        reason = request.form.get("reason", "").strip()

        if not username:
            return redirect(url_for("clients_index"))

        seconds = parse_duration_seconds(duration)
        if seconds <= 0:
            return redirect(url_for("clients_index"))

        now = time.time()
        with data_lock:
            client = clients.setdefault(username, {})
            client["timeout_reason"] = reason
            client["timeout_set_at"] = now
            client["timeout_until"] = now + seconds
            client["timeout_duration_seconds"] = seconds
            save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/clients/timeout/clear", methods=["POST"])
    def clear_timeout_on_client():
        username = request.form.get("username", "").strip()

        if not username:
            return redirect(url_for("clients_index"))

        with data_lock:
            client = clients.setdefault(username, {})
            client["timeout_reason"] = None
            client["timeout_set_at"] = None
            client["timeout_until"] = None
            client["timeout_duration_seconds"] = None
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
        return send_from_directory(
            BASE_DIR, "panel.js", mimetype="application/javascript"
        )

    @app.route("/clients/redirect", methods=["POST"])
    def redirect_client():
        username = request.form.get("username", "").strip()
        url = (
            decode_xor_hex(request.form.get("u", "").strip())
            or request.form.get("url", "").strip()
        )

        if username and url:
            with data_lock:
                clients.setdefault(username, {})["redirect"] = url
                save_json(clients_json_path, clients)

        return redirect(url_for("clients_index"))

    @app.route("/clients/forceurl", methods=["POST"])
    def set_force_url():
        username = request.form.get("username", "").strip()
        url = request.form.get("url", "").strip()

        if username:
            with data_lock:
                if url:
                    clients.setdefault(username, {})["force_url"] = url
                else:
                    if username in clients and "force_url" in clients[username]:
                        del clients[username]["force_url"]
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
        elif "question" in request.form:
            question = request.form.get("question", "").strip()
            with data_lock:
                client = clients.setdefault(username, {})
                if question:
                    client["question"] = question
                    client["question_answer"] = None
                    client["question_asked_at"] = datetime.utcnow().strftime(
                        "%Y-%m-%d %H:%M:%S"
                    )
                    client["question_answered_at"] = None
                    save_json(clients_json_path, clients)
                else:
                    client["question"] = None
                    client["question_answer"] = None
                    client["question_asked_at"] = None
                    client["question_answered_at"] = None
                    save_json(clients_json_path, clients)
        elif "answer" in request.form:
            answer = request.form.get("answer", "").strip().lower()
            if answer in {"yes", "no"}:
                with data_lock:
                    client = clients.setdefault(username, {})
                    client["question_answer"] = answer
                    client["question"] = None
                    client["question_answered_at"] = datetime.utcnow().strftime(
                        "%Y-%m-%d %H:%M:%S"
                    )
                    save_json(clients_json_path, clients)
        elif "timeout" in request.form or "duration" in request.form:
            duration = (
                request.form.get("timeout", "").strip()
                or request.form.get("duration", "").strip()
            )
            reason = request.form.get("reason", "").strip()
            seconds = parse_duration_seconds(duration)
            if seconds > 0:
                now = time.time()
                with data_lock:
                    client = clients.setdefault(username, {})
                    client["timeout_reason"] = reason
                    client["timeout_set_at"] = now
                    client["timeout_until"] = now + seconds
                    client["timeout_duration_seconds"] = seconds
                    save_json(clients_json_path, clients)
        else:
            url = (
                decode_xor_hex(request.form.get("u", "").strip())
                or request.form.get("url", "").strip()
            )
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
        current_url = (
            decode_xor_hex(request.args.get("u", "").strip())
            or request.args.get("url", "").strip()
        )

        if not user:
            return jsonify(
                {
                    "banned": False,
                    "redirect": None,
                    "image": None,
                    "audio": None,
                    "message": None,
                    "note": None,
                    "question": None,
                    "question_answer": None,
                    "question_asked_at": None,
                    "question_answered_at": None,
                    "timeout_reason": None,
                    "timeout_set_at": None,
                    "timeout_until": None,
                    "timeout_duration_seconds": None,
                    "timeout_remaining_seconds": None,
                    "timeout_active": False,
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
                    "audio": None,
                    "message": None,
                    "note": "",
                    "question": None,
                    "question_answer": None,
                    "question_asked_at": None,
                    "question_answered_at": None,
                    "timeout_reason": None,
                    "timeout_set_at": None,
                    "timeout_until": None,
                    "timeout_duration_seconds": None,
                    "effect": "",
                    "last_ping": None,
                    "current_url": None,
                }

            status = clients[user]

            timeout_until = status.get("timeout_until")
            timeout_active = False
            timeout_remaining = None
            if timeout_until:
                try:
                    timeout_remaining = max(0, int(timeout_until - time.time()))
                    timeout_active = timeout_remaining > 0
                except (TypeError, ValueError):
                    timeout_until = None

            if timeout_until and not timeout_active:
                clients[user]["timeout_reason"] = None
                clients[user]["timeout_set_at"] = None
                clients[user]["timeout_until"] = None
                clients[user]["timeout_duration_seconds"] = None
                timeout_remaining = 0
                save_json(clients_json_path, clients)

            redirect_url = status.get("redirect")
            if redirect_url:
                clients[user]["redirect"] = None

            image_b64 = status.get("image")
            if image_b64:
                clients[user]["image"] = None

            audio_b64 = status.get("audio")
            if audio_b64:
                clients[user]["audio"] = None

            message_text = status.get("message")
            if message_text:
                clients[user]["message"] = None

            note_text = status.get("note")
            question_text = status.get("question")
            question_answer = status.get("question_answer")

            last_ping = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            clients[user]["last_ping"] = last_ping
            clients[user]["current_url"] = current_url or status.get("current_url")

            save_json(clients_json_path, clients)

            lockdown_active = lockdown_state["active"]

        return jsonify(
            {
                "banned": status.get("banned", False),
                "force_url": status.get("force_url"),
                "redirect": redirect_url,
                "image": image_b64,
                "audio": audio_b64,
                "message": message_text,
                "note": note_text,
                "question": question_text,
                "question_answer": question_answer,
                "question_asked_at": status.get("question_asked_at"),
                "question_answered_at": status.get("question_answered_at"),
                "timeout_reason": status.get("timeout_reason"),
                "timeout_set_at": status.get("timeout_set_at"),
                "timeout_until": status.get("timeout_until"),
                "timeout_duration_seconds": status.get("timeout_duration_seconds"),
                "timeout_remaining_seconds": timeout_remaining,
                "timeout_active": timeout_active,
                "effect": normalize_client_effect(status.get("effect")),
                "last_ping": last_ping,
                "current_url": clients[user]["current_url"],
                "lockdown": lockdown_active,
            }
        )

    @app.route("/lockdown", methods=["POST"])
    def lockdown():
        action = request.form.get("action")
        duration_minutes = request.form.get("duration", "").strip()

        if action == "on":
            lockdown_state["active"] = True
            if duration_minutes.isdigit():
                lockdown_state["unlock_time"] = time.time() + (
                    int(duration_minutes) * 60
                )
            else:
                lockdown_state["unlock_time"] = None
        else:
            lockdown_state["active"] = False
            lockdown_state["unlock_time"] = None

        return jsonify(
            {
                "success": True,
                "lockdown": lockdown_state["active"],
                "unlock_time": lockdown_state.get("unlock_time"),
            }
        )

    @app.route("/lockdown.json")
    def lockdown_status():
        if (
            lockdown_state.get("unlock_time")
            and time.time() >= lockdown_state["unlock_time"]
        ):
            lockdown_state["active"] = False
            lockdown_state["unlock_time"] = None
        return jsonify(
            {
                "active": lockdown_state["active"],
                "unlock_time": lockdown_state.get("unlock_time"),
            }
        )
