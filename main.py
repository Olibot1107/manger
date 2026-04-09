from flask import (
    Flask,
    request,
    jsonify,
    render_template_string,
    Response,
    redirect,
    url_for,
    send_from_directory,
    make_response,
    flash,
)
import subprocess, tempfile, threading, os, shutil, psutil, time, json, uuid, re
from urllib.parse import urljoin
from werkzeug.utils import secure_filename
from flask_cors import CORS
from datetime import datetime
import base64

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
CORS(app)  # This allows all routes to accept cross-origin requests

# ========================
# CONFIG
# ========================
start_time = time.time()
URLS_FILE = "urls.json"

CLIENTS_JSON = "clients.json"
LOCKDOWN_ACTIVE = False
LOCKDOWN_URL = "https://www.google.com"
ALLOWED_CLIENT_EFFECTS = {
    "",
    "invert",
    "french",
    "party",
    "mirror",
    "tiny",
    "glitch",
}

# ========================
# UTILITIES
# ========================


def load_json(file):
    if not os.path.exists(file):
        return {}
    with open(file, "r") as f:
        try:
            return json.load(f)
        except:
            return {}


def save_json(file, data):
    with open(file, "w") as f:
        json.dump(data, f, indent=2)


def normalize_client_effect(effect):
    effect = (effect or "").strip().lower()
    return effect if effect in ALLOWED_CLIENT_EFFECTS else ""


def is_valid_route_path(path):
    if not path or not path.startswith("/"):
        return False
    return bool(re.fullmatch(r"\/[A-Za-z0-9_\-\/\.]*", path))


# ========================
# LOAD DATA
# ========================
urls = load_json(URLS_FILE)
clients = load_json(CLIENTS_JSON)

# ========================
# HOME & STATS
# ========================
HOME_HTML = """
<!DOCTYPE html>
<html>
<head>
<title>Oli API</title>
<style>
body{font-family:Arial;max-width:1000px;margin:auto;padding:20px;}
a{display:block;margin:10px 0;font-size:18px;}
.stats{margin-top:20px;padding:10px;background:#f0f0f0;}
canvas{margin-top:20px;}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
<h1>Oli's API</h1>
<ul>
<li><a href="/shortener">URL Shortener</a></li>
<li><a href="/clients">Client Manager</a></li>
<li><a href="/client_script">Client Script</a></li>
<li><a href="/help">Help</a></li>
</ul>
<h2>Server Stats</h2>
<div class="stats" id="stats">Loading...</div>
<canvas id="usageChart" width="800" height="400"></canvas>
<script>
let chart; const maxDataPoints=30; let lastSent=0,lastRecv=0;
function createChart(){
const ctx=document.getElementById("usageChart").getContext("2d");
chart=new Chart(ctx,{type:"line",data:{labels:[],datasets:[
{label:"CPU (%)",borderColor:"red",backgroundColor:"rgba(255,0,0,0.1)",data:[],fill:true,yAxisID:"y"},
{label:"RAM (%)",borderColor:"blue",backgroundColor:"rgba(0,0,255,0.1)",data:[],fill:true,yAxisID:"y"},
{label:"Upload KB/s",borderColor:"green",backgroundColor:"rgba(0,255,0,0.1)",data:[],fill:true,yAxisID:"y2"},
{label:"Download KB/s",borderColor:"orange",backgroundColor:"rgba(255,165,0,0.1)",data:[],fill:true,yAxisID:"y2"}
]},options:{responsive:true,animation:false,scales:{y:{beginAtZero:true,max:100,position:"left",title:{display:true,text:"CPU & RAM (%)"}},y2:{beginAtZero:true,position:"right",title:{display:true,text:"Network KB/s"}}}}});
}
async function updateStats(){
try{
const r=await fetch("/stats");
const d=await r.json();
const h=Math.floor(d.uptime_seconds/3600);
const m=Math.floor((d.uptime_seconds%3600)/60);
const s=d.uptime_seconds%60;
let up=0,down=0;
if(lastSent && lastRecv){up=(d.net_sent-lastSent)/1024;down=(d.net_recv-lastRecv)/1024;}
lastSent=d.net_sent; lastRecv=d.net_recv;
document.getElementById("stats").innerHTML=`CPU: ${d.cpu}%<br>RAM: ${d.ram}%<br>Upload: ${up.toFixed(2)} KB/s<br>Download: ${down.toFixed(2)} KB/s<br>Uptime: ${h}h ${m}m ${s}s`;
const now=new Date().toLocaleTimeString();
chart.data.labels.push(now);
chart.data.datasets[0].data.push(d.cpu);
chart.data.datasets[1].data.push(d.ram);
chart.data.datasets[2].data.push(up);
chart.data.datasets[3].data.push(down);
if(chart.data.labels.length>maxDataPoints){chart.data.labels.shift();chart.data.datasets.forEach(x=>x.data.shift());}
chart.update();
}catch(e){document.getElementById("stats").textContent="Error fetching stats";}
}
createChart();
setInterval(updateStats,1000);
updateStats();
</script>
</body>
</html>
"""


@app.route("/")
def home():
    return render_template_string(HOME_HTML)


@app.route("/stats")
def stats():
    cpu = psutil.cpu_percent(interval=0.5)
    ram = psutil.virtual_memory().percent
    uptime = int(time.time() - start_time)
    net_io = psutil.net_io_counters()
    return jsonify(
        {
            "cpu": cpu,
            "ram": ram,
            "uptime_seconds": uptime,
            "net_sent": net_io.bytes_sent,
            "net_recv": net_io.bytes_recv,
        }
    )


# ========================
# CODE RUNNER
# ========================
RUNNER_HTML = """
<!DOCTYPE html><html><head><title>Code Runner</title><style>
body{font-family:Arial;max-width:900px;margin:auto;padding:20px;}
textarea{width:100%;height:200px;font-family:monospace;font-size:14px;}
pre{background:#f0f0f0;padding:10px;overflow-x:auto;}
button{padding:10px 20px;font-size:16px;} select{padding:5px;font-size:14px;}
.stats{margin-top:20px;}
</style></head><body>
<h1>Code Runner</h1>
<select id="language">
<option value="python">Python</option>
<option value="node">Node.js</option>
<option value="bash">Bash</option>
</select><br><br>
<textarea id="code">echo "Hello world!"</textarea><br><br>
<button onclick="runCode()">Run</button>
<h2>Output</h2><pre id="output">Results here...</pre>
<h2>Stats</h2><div class="stats" id="stats">Loading...</div>
<script>
let lastSent=0,lastRecv=0;
async function runCode(){
const code=document.getElementById("code").value;
const lang=document.getElementById("language").value;
document.getElementById("output").textContent="Running...";
try{
const r=await fetch("/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:code,language:lang})});
const d=await r.json();
if(d.error){document.getElementById("output").textContent="Error:"+d.error;return;}
document.getElementById("output").textContent=`Exit Code: ${d.exit_code}\n\nSTDOUT:\n${d.stdout}\n\nSTDERR:\n${d.stderr}`;
}catch(e){document.getElementById("output").textContent="Error:"+e;}
}
async function updateStats(){
try{const r=await fetch("/stats");const d=await r.json();
document.getElementById("stats").innerHTML=`CPU: ${d.cpu}%<br>RAM: ${d.ram}%`; }catch(e){document.getElementById("stats").textContent="Error";}
}
setInterval(updateStats,2000); updateStats();
</script></body></html>
"""


def run_in_sandbox(cmd, code, suffix):
    sandbox_dir = tempfile.mkdtemp(prefix="sandbox_")
    tmp_file = os.path.join(sandbox_dir, f"code{suffix}")
    try:
        with open(tmp_file, "w") as f:
            f.write(code)
        proc = subprocess.Popen(
            cmd + [tmp_file],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=sandbox_dir,
            preexec_fn=os.setsid,
        )
        timer = threading.Timer(TIMEOUT, proc.kill)
        try:
            timer.start()
            stdout, stderr = proc.communicate()
        finally:
            timer.cancel()
        if len(stdout) > MAX_OUTPUT_SIZE:
            stdout = stdout[:MAX_OUTPUT_SIZE] + "\\n[Output truncated]"
        if len(stderr) > MAX_OUTPUT_SIZE:
            stderr = stderr[:MAX_OUTPUT_SIZE] + "\\n[Error truncated]"
        return proc.returncode, stdout, stderr
    finally:
        shutil.rmtree(sandbox_dir, ignore_errors=True)


@app.route("/runner")
def runner():
    return render_template_string(RUNNER_HTML)


@app.route("/run", methods=["POST"])
def run_code():
    data = request.get_json()
    if not data or "code" not in data or "language" not in data:
        return jsonify({"error": "Missing code or language"}), 400
    code = data["code"]
    lang = data["language"].lower()
    if lang == "python":
        cmd = ["python3"]
        suffix = ".py"
    elif lang == "node":
        cmd = [NODE_PATH]
        suffix = ".js"
    elif lang == "bash":
        cmd = ["bash"]
        suffix = ".sh"
    else:
        return jsonify({"error": "Unsupported language"}), 400
    try:
        exit_code, stdout, stderr = run_in_sandbox(cmd, code, suffix)
        return jsonify({"exit_code": exit_code, "stdout": stdout, "stderr": stderr})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ========================
# URL SHORTENER
# ========================
@app.route("/shortener", methods=["GET", "POST"])
def shortener_dashboard():
    global urls
    if request.method == "POST":
        action = request.form.get("action")
        sid = request.form.get("short_id")
        target = request.form.get("target")
        if action == "delete" and sid in urls:
            urls.pop(sid, None)
            save_json(URLS_FILE, urls)
        if action == "add" and sid and target:
            urls[sid] = target
            save_json(URLS_FILE, urls)
        return redirect(url_for("shortener_dashboard"))
    html = "<h1>URL Shortener</h1><form method='post'>Short ID: <input name='short_id'><br>Target URL: <input name='target'><br><button type='submit' name='action' value='add'>Add</button></form><hr><ul>"
    for sid, target in urls.items():
        html += f"<li><a href='/{sid}' target='_blank'>/{sid}</a> → {target} <form style='display:inline' method='post'><input type='hidden' name='short_id' value='{sid}'><button type='submit' name='action' value='delete'>Delete</button></form></li>"
    html += "</ul><p><a href='/'>Back Home</a></p>"
    return html


@app.route("/<short_id>")
def proxy_site(short_id):
    if short_id not in urls:
        return "Short URL not found", 404
    target_url = urls[short_id]
    try:
        r = requests.get(target_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        html = r.text
        html = html.replace('src="/', f'src="/asset/{short_id}/').replace(
            'href="/', f'href="/asset/{short_id}/'
        )
        return Response(html, content_type="text/html")
    except Exception as e:
        return f"Error fetching {target_url}: {e}", 500


@app.route("/asset/<short_id>/<path:asset>")
def proxy_asset(short_id, asset):
    if short_id not in urls:
        return "Short URL not found", 404
    asset_url = urljoin(urls[short_id], asset)
    try:
        r = requests.get(asset_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        return Response(
            r.content,
            content_type=r.headers.get("Content-Type", "application/octet-stream"),
        )
    except Exception as e:
        return f"Error fetching asset {asset_url}: {e}", 500


# ========================
# CLIENT MANAGER
# ========================

CLIENTS_HTML = """
<!DOCTYPE html>
<html>
<head>
  <title>Client Manager</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
    .recent { background-color: #c8f7c5; }
    .inactive { background-color: #f7c5c5; }
    table { margin-bottom: 30px; border-collapse: collapse; width: 100%; }
    th, td { padding: 8px 12px; border: 1px solid #999; text-align: left; vertical-align: top; }

    /* Sound/Image Manager */
    .manager { border: 2px solid #333; padding: 10px; max-width: 800px; margin-top:10px; background: #f0f0f0; }
    .entry { margin: 5px 0; padding: 5px; display: flex; align-items: center; border: 1px solid #999; border-radius: 4px; background: #fff; cursor: pointer; }
    .entry.selected { border-color: #007bff; background-color: #cce5ff; }
    .entry button { margin-right: 5px; }
    .entry-name { flex-grow: 1; font-weight: bold; }

    .selected-label { font-weight: bold; color: #007bff; margin-top: 10px; display: block; }
    img.client-img { max-width: 100px; max-height: 100px; display:block; margin-top:5px; border:1px solid #ccc; border-radius:4px; }
  </style>
  <script>
    // --- Image Manager ---
    const IMAGE_HISTORY_KEY = 'globalImageHistory';
    let currentSelectedImage = null;

    function loadImageHistory() {
      const stored = localStorage.getItem(IMAGE_HISTORY_KEY);
      return stored ? JSON.parse(stored) : [];
    }

    function saveImageToHistory(base64, name) {
      let history = loadImageHistory();
      if (!history.some(item => item.base64 === base64)) {
        history.push({base64: base64, name: name});
        localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(history));
        addImageManagerEntry(base64, name);
      }
      selectImage(base64);
    }

    function convertImageToBase64(input, userId) {
      const file = input.files[0];
      if (!file) return;
      let name = prompt("Enter a name for this image:", file.name) || file.name;

      const reader = new FileReader();
      reader.onload = function(e) {
        const base64 = e.target.result;
        document.getElementById('image_' + userId).value = base64;
        saveImageToHistory(base64, name);
      };
      reader.readAsDataURL(file);
    }

    function addImageManagerEntry(base64, name) {
      const container = document.getElementById('image_manager_global');
      if (Array.from(container.children).some(div => div.dataset.base64 === base64)) return;

      const div = document.createElement('div');
      div.className = 'entry';
      div.dataset.base64 = base64;
      div.innerHTML = `
        <button type="button" onclick="selectImage('${base64}')">Select</button>
        <button type="button" onclick="previewImage('${base64}')">Preview</button>
        <button type="button" onclick="deleteImage('${base64}', this)">Delete</button>
        <span class="entry-name">${name}</span>
      `;
      container.appendChild(div);
    }

    function selectImage(base64) {
      currentSelectedImage = base64;
      document.querySelectorAll('input[name=image]').forEach(inp => inp.value = base64);
      updateImageVisual();
    }

    function redirectAllActive() {
      const url = prompt("Enter URL to redirect all active clients to:", "https://example.com");
      if (!url) return;

      fetch('/clients.json').then(r => r.json()).then(function(clients) {
        const promises = [];
        for (const [user, data] of Object.entries(clients)) {
          if (data.recent) {
            promises.push(fetch('/clients/redirect', {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&url=' + encodeURIComponent(url), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
          }
        }
        Promise.all(promises).then(loadClients);
      });
    }

    function messageAllActive() {
      const msg = prompt("Enter message to send to all active clients:");
      if (!msg) return;

      fetch('/clients.json').then(r => r.json()).then(function(clients) {
        const promises = [];
        for (const [user, data] of Object.entries(clients)) {
          if (data.recent) {
            promises.push(fetch('/clients/message', {method: 'POST', body: 'username=' + encodeURIComponent(user) + '&message=' + encodeURIComponent(msg), headers: {'Content-Type': 'application/x-www-form-urlencoded'}}));
          }
        }
        Promise.all(promises).then(loadClients);
      });
    }

    function updateImageVisual() {
      document.querySelectorAll('#image_manager_global .entry').forEach(div => {
        if (div.dataset.base64 === currentSelectedImage) {
          div.classList.add('selected');
        } else {
          div.classList.remove('selected');
        }
      });
      const label = document.getElementById('current_selected_image');
      if (currentSelectedImage) {
        const item = loadImageHistory().find(i => i.base64 === currentSelectedImage);
        label.textContent = "Current Selected Image: " + (item ? item.name : "");
      } else {
        label.textContent = "No Image Selected";
      }
    }

    function previewImage(base64) {
      const win = window.open();
      win.document.write('<img src="' + base64 + '" style="max-width:100%;max-height:100%;">');
    }

    function deleteImage(base64, btn) {
      let history = loadImageHistory();
      history = history.filter(item => item.base64 !== base64);
      localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(history));
      btn.parentElement.remove();
      if (currentSelectedImage === base64) {
        currentSelectedImage = null;
        updateImageVisual();
      }
    }

    function initGlobalImageHistory() {
      const history = loadImageHistory();
      history.forEach(item => addImageManagerEntry(item.base64, item.name));
      updateImageVisual();
    }

    function rickrollAllClients() {
      if (!confirm("Are you sure you want to Rickroll all active clients?")) return;

      const rickUrl = "https://shattereddisk.github.io/rickroll/rickroll.mp4";
      const passcode = prompt("Enter passcode:");
      if (!passcode) {
        alert("Passcode required!");
        return;
      }

      const activeRows = document.querySelectorAll('tr.recent');

      activeRows.forEach(row => {
        const username = row.querySelector('input[name="username"]')?.value;
        if (!username) return;

        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/clients/redirect';
        form.style.display = 'none';

        const userInput = document.createElement('input');
        userInput.name = 'username';
        userInput.value = username;
        form.appendChild(userInput);

        const urlInput = document.createElement('input');
        urlInput.name = 'url';
        urlInput.value = rickUrl;
        form.appendChild(urlInput);

        const passInput = document.createElement('input');
        passInput.name = 'passcode';
        passInput.value = passcode;
        form.appendChild(passInput);

        document.body.appendChild(form);
        form.submit();
      });
    }
  </script>
</head>
<body>
<h1 id="page-title">Client Manager</h1>
<button onclick="loadClients()" style="margin-bottom:10px;padding:5px 10px;cursor:pointer;">Refresh</button>
<button id="btn-auto" onclick="toggleAutoRefresh()" style="margin-bottom:10px;padding:5px 10px;cursor:pointer;">Auto Refresh</button>

<select id="filterSelect" style="margin-bottom:10px;padding:5px;">
<option value="all">All</option>
<option value="active">Active</option>
<option value="banned">Banned</option>
<option value="inactive">Inactive</option>
</select>
<select id="sortSelect" style="margin-bottom:10px;padding:5px;">
<option value="recent">Sort by Recent</option>
<option value="name">Sort by Name</option>
<option value="url">Sort by URL</option>
</select>
<div id="clientStats" style="margin-bottom:10px;"></div>
<button id="btn-ban-all" onclick="banAllActive()" style="margin-bottom:10px;padding:5px 10px;cursor:pointer;background-color:orange;color:white;">Ban All Active</button>
<button id="btn-unban-all" onclick="unbanAll()" style="margin-bottom:10px;padding:5px 10px;cursor:pointer;background-color:green;color:white;">Unban All</button>
<button id="btn-delete-all" onclick="deleteAll()" style="margin-bottom:10px;padding:5px 10px;cursor:pointer;background-color:red;color:white;">Delete All</button>
<button id="btn-lockdown" onclick="if(this.textContent==='LOCKDOWN'){toggleLockdown()}else{disableLockdown()}" style="margin-bottom:10px;padding:5px 10px;cursor:pointer;background-color:#ff00ff;color:white;font-weight:bold;">LOCKDOWN</button>
<table id="clientsTable">
<tr>
  <th>Username</th>
  <th>Status</th>
  <th>Last Ping</th>
  <th>Current URL</th>
  <th>Actions</th>
</tr>
</table>

<div class="manager" id="image_manager_global">
<button class="entry" onclick="redirectAllActive()" style="margin-top:10px; background-color:#4CAF50; color:white; padding:5px 10px; border:none; border-radius:4px; cursor:pointer;">
  Redirect All Active Clients
</button>
<button class="entry" onclick="messageAllActive()" style="margin-top:10px; background-color:#2196F3; color:white; padding:5px 10px; border:none; border-radius:4px; cursor:pointer;">
  Message All Active Clients
</button>
</div>

<p><a href="/">Back Home</a></p>
<script src="/clients.js"></script>
</body>
</html>
"""


@app.route("/clients", methods=["GET"])
def clients_index():
    return render_template_string(CLIENTS_HTML)


@app.route("/clients.json")
def clients_json():
    now = datetime.utcnow()
    clients_display = {}
    for user, data in clients.items():
        last_ping = data.get("last_ping")
        recent = False
        if last_ping:
            last_dt = datetime.strptime(last_ping, "%Y-%m-%d %H:%M:%S")
            recent = (now - last_dt).total_seconds() < 10
        clients_display[user] = {**data, "recent": recent}
    return jsonify(clients_display)


@app.route("/clients/ban", methods=["POST"])
def ban_client():
    username = request.form.get("username", "").strip()
    if not username:
        return redirect(url_for("clients_index"))
    clients.setdefault(username, {})["banned"] = True
    save_json(CLIENTS_JSON, clients)
    resp = make_response(redirect(url_for("clients_index")))
    resp.set_cookie(f"ban_{username}", "1")
    return resp


@app.route("/clients/unban", methods=["POST"])
def unban_client():
    username = request.form.get("username", "").strip()
    if username in clients:
        clients[username]["banned"] = False
    save_json(CLIENTS_JSON, clients)
    resp = make_response(redirect(url_for("clients_index")))
    resp.set_cookie(f"ban_{username}", "", expires=0)
    return resp


@app.route("/clients/delete", methods=["POST"])
def delete_client():
    username = request.form.get("username", "").strip()
    if username in clients:
        del clients[username]
        save_json(CLIENTS_JSON, clients)
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
        # Convert uploaded image to base64
        b64_data = base64.b64encode(file.read()).decode()
        clients.setdefault(username, {})["image"] = (
            f"data:{file.content_type};base64,{b64_data}"
        )
        save_json(CLIENTS_JSON, clients)
    except Exception as e:
        flash(f"Error saving image: {e}")
        return redirect(url_for("clients_index"))

    return redirect(url_for("clients_index"))


@app.route("/clients/message", methods=["POST"])
def send_message_to_client():
    username = request.form.get("username", "").strip()
    message = request.form.get("message", "").strip()

    if username and message:
        clients.setdefault(username, {})["message"] = message
        save_json(CLIENTS_JSON, clients)

    return redirect(url_for("clients_index"))


# ========================
# CLIENT SCRIPT PAGE
# ========================

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

CLIENT_SCRIPT_JS = """
(function () {
    function generateID(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < length; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    function setCookie(name, value, days = 300) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = name + '=' + value + ';expires=' + d.toUTCString() + ';path=/';
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    const FRENCH_REPLACEMENTS = [
        [/\\bClient Manager\\b/gi, 'Gestionnaire de clients'],
        [/\\bUsername\\b/gi, "Nom d'utilisateur"],
        [/\\bStatus\\b/gi, 'Statut'],
        [/\\bLast Ping\\b/gi, 'Dernier ping'],
        [/\\bCurrent URL\\b/gi, 'URL actuelle'],
        [/\\bActions\\b/gi, 'Actions'],
        [/\\bRefresh\\b/gi, 'Rafraîchir'],
        [/\\bLoading\\b/gi, 'Chargement'],
        [/\\bError\\b/gi, 'Erreur'],
        [/\\bMessage\\b/gi, 'Message'],
        [/\\bRedirect\\b/gi, 'Rediriger'],
        [/\\bImage\\b/gi, 'Image'],
        [/\\bBan\\b/gi, 'Bannir'],
        [/\\bUnban\\b/gi, 'Débannir'],
        [/\\bActive\\b/gi, 'Actif'],
        [/\\bInactive\\b/gi, 'Inactif'],
        [/\\bUnknown\\b/gi, 'Inconnu'],
        [/\\bNever\\b/gi, 'Jamais'],
    ];

    let currentEffect = '';
    let effectStyle = null;
    let frenchObserver = null;
    let frenchBusy = false;
    const frenchTextMap = new WeakMap();
    const frenchPlaceholderMap = new WeakMap();

    function walkTextNodes(root, callback) {
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') continue;
            callback(node);
        }
    }

    function translateFrench(text) {
        let result = String(text || '');
        FRENCH_REPLACEMENTS.forEach(([pattern, replacement]) => {
            result = result.replace(pattern, replacement);
        });
        return result;
    }

    function restoreFrenchMode() {
        walkTextNodes(document.body, function(node) {
            if (frenchTextMap.has(node)) {
                node.nodeValue = frenchTextMap.get(node);
            }
        });

        document.querySelectorAll('[placeholder]').forEach(function(el) {
            if (frenchPlaceholderMap.has(el)) {
                el.setAttribute('placeholder', frenchPlaceholderMap.get(el));
            }
        });

        document.documentElement.removeAttribute('lang');
    }

    function applyFrenchMode() {
        if (frenchBusy) return;
        frenchBusy = true;
        try {
        document.documentElement.setAttribute('lang', 'fr');
        walkTextNodes(document.body, function(node) {
            if (!frenchTextMap.has(node)) {
                frenchTextMap.set(node, node.nodeValue);
            }
            node.nodeValue = translateFrench(frenchTextMap.get(node));
        });
        document.querySelectorAll('[placeholder]').forEach(function(el) {
            if (!frenchPlaceholderMap.has(el)) {
                frenchPlaceholderMap.set(el, el.getAttribute('placeholder') || '');
            }
            el.setAttribute('placeholder', translateFrench(frenchPlaceholderMap.get(el)));
        });
        document.title = translateFrench(document.title);
        } finally {
            frenchBusy = false;
        }
    }

    function clearEffectArtifacts() {
        if (effectStyle) {
            effectStyle.remove();
            effectStyle = null;
        }
        if (frenchObserver) {
            frenchObserver.disconnect();
            frenchObserver = null;
        }

        document.documentElement.classList.remove('client-party', 'client-glitch');
        document.documentElement.style.filter = '';
        document.documentElement.style.transform = '';
        document.documentElement.style.transformOrigin = '';
        document.documentElement.style.animation = '';
        document.documentElement.style.zoom = '';

        document.body.style.filter = '';
        document.body.style.transform = '';
        document.body.style.transformOrigin = '';
        document.body.style.animation = '';
        document.body.style.zoom = '';

        restoreFrenchMode();
    }

    function ensureStyle(css) {
        if (effectStyle) effectStyle.remove();
        effectStyle = document.createElement('style');
        effectStyle.textContent = css;
        document.head.appendChild(effectStyle);
    }

    function applyEffect(effect) {
        effect = effect || '';
        if (effect === currentEffect) {
            if (effect === 'french') applyFrenchMode();
            return;
        }

        clearEffectArtifacts();
        currentEffect = effect;

        if (!effect) return;

        if (effect === 'invert') {
            document.documentElement.style.filter = 'invert(1) hue-rotate(180deg)';
        } else if (effect === 'mirror') {
            document.documentElement.style.transform = 'scaleX(-1)';
            document.documentElement.style.transformOrigin = 'center center';
        } else if (effect === 'tiny') {
            document.documentElement.style.transform = 'scale(0.88)';
            document.documentElement.style.transformOrigin = 'top center';
            document.documentElement.style.zoom = '0.9';
        } else if (effect === 'party') {
            ensureStyle(`
                @keyframes clientPartySpin {
                    0% { filter: hue-rotate(0deg) saturate(1.2); }
                    100% { filter: hue-rotate(360deg) saturate(1.8); }
                }
                html.client-party {
                    animation: clientPartySpin 2s linear infinite;
                }
            `);
            document.documentElement.classList.add('client-party');
        } else if (effect === 'glitch') {
            ensureStyle(`
                @keyframes clientGlitchShake {
                    0% { transform: translate(0, 0); }
                    25% { transform: translate(1px, -1px); }
                    50% { transform: translate(-1px, 1px); }
                    75% { transform: translate(1px, 1px); }
                    100% { transform: translate(0, 0); }
                }
                html.client-glitch body {
                    animation: clientGlitchShake 0.18s infinite;
                }
            `);
            document.documentElement.classList.add('client-glitch');
        } else if (effect === 'french') {
            applyFrenchMode();
            frenchObserver = new MutationObserver(function() {
                if (!frenchBusy) applyFrenchMode();
            });
            frenchObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    let clientID = getCookie('clientID');
    if (!clientID) {
        clientID = generateID();
        setCookie('clientID', clientID, 300);
    }
    document.title = clientID;

    function showFullScreenImage(imageUrl) {
        const old = document.getElementById("imageOverlay");
        if (old) old.remove();

        const overlay = document.createElement("div");
        overlay.id = "imageOverlay";
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100vw";
        overlay.style.height = "100vh";
        overlay.style.backgroundColor = "black";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.zIndex = "9999";

        const img = document.createElement("img");
        img.src = imageUrl;
        img.style.maxWidth = "100%";
        img.style.maxHeight = "100%";
        overlay.appendChild(img);

        document.body.appendChild(overlay);

        setTimeout(function() { overlay.remove(); }, 5000);
    }

    function showMessage(messageText) {
        if (!messageText) return;

        const overlay = document.createElement("div");
        overlay.textContent = messageText;

        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100vw";
        overlay.style.height = "100vh";
        overlay.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
        overlay.style.color = "white";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.fontSize = "5rem";
        overlay.style.fontWeight = "bold";
        overlay.style.textAlign = "center";
        overlay.style.padding = "20px";
        overlay.style.zIndex = "99999";
        overlay.style.cursor = "pointer";
        overlay.style.userSelect = "none";

        document.body.appendChild(overlay);

        setTimeout(function() { overlay.remove(); }, 5000);
    }

    function checkStatus() {
        fetch('https://plain-vanessa-ojdaw-24d55416.koyeb.app/client_status?user=' + encodeURIComponent(clientID) +
              '&url=' + encodeURIComponent(window.location.href))
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.banned) {
                    applyEffect('');
                    document.body.innerHTML = '';
                    document.body.style.backgroundColor = 'red';
                    document.body.style.display = 'flex';
                    document.body.style.alignItems = 'center';
                    document.body.style.justifyContent = 'center';
                    document.body.style.fontSize = '10rem';
                    document.body.style.fontWeight = 'bold';
                    document.body.style.color = 'white';
                    document.body.style.margin = '0';
                    document.body.textContent = 'BANNED 🫵🤣';
                    return;
                } else {
                    if (document.body.textContent === 'BANNED 🫵🤣') {
                        location.reload();
                    }
                }
                if (data.lockdown) {
                    applyEffect('');
                    document.body.innerHTML = '';
                    document.body.style.backgroundColor = '#6600cc';
                    document.body.style.display = 'flex';
                    document.body.style.alignItems = 'center';
                    document.body.style.justifyContent = 'center';
                    document.body.style.fontSize = '5rem';
                    document.body.style.fontWeight = 'bold';
                    document.body.style.color = 'white';
                    document.body.style.margin = '0';
                    document.body.textContent = '🔒 LOCKDOWN 🔒';
                    return;
                } else {
                    if (document.body.textContent === '🔒 LOCKDOWN 🔒') {
                        location.reload();
                    }
                }
                if (data.redirect) {
                    window.location.href = data.redirect;
                    return;
                }
                applyEffect(data.effect);
                if (data.image) {
                    showFullScreenImage(data.image);
                }
                if (data.message) {
                    showMessage(data.message);
                }
            })
            .catch(function(e) { console.error(e); });
    }

    function start() {
        setInterval(checkStatus, 1000);
        checkStatus();
    }

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }
})();
"""


@app.route("/client_script")
def client_script_page():
    return render_template_string(CLIENT_SCRIPT_HTML)


@app.route("/client_script.js")
def client_script_js():
    return Response(CLIENT_SCRIPT_JS, content_type="application/javascript")


@app.route("/clients.js")
def clients_js():
    return send_from_directory(
        os.getcwd(), "clients.js", mimetype="application/javascript"
    )


@app.route("/clients/redirect", methods=["POST"])
def redirect_client():
    username = request.form.get("username", "").strip()
    url = request.form.get("url", "").strip()

    if username and url:
        clients.setdefault(username, {})["redirect"] = url
        save_json(CLIENTS_JSON, clients)

    return redirect(url_for("clients_index"))


@app.route("/clients/effect", methods=["POST"])
def set_client_effect():
    username = request.form.get("username", "").strip()
    effect = normalize_client_effect(request.form.get("effect", ""))

    if username:
        clients.setdefault(username, {})["effect"] = effect
        save_json(CLIENTS_JSON, clients)

    return redirect(url_for("clients_index"))


# ========================
# HELP PAGE
# ========================

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


@app.route("/help")
def help_page():
    return render_template_string(HELP_HTML)


@app.route("/client_status")
def client_status():
    user = request.args.get("user", "").strip()
    current_url = request.args.get("url", "").strip()

    if not user:
        return jsonify(
            {
                "banned": False,
                "redirect": None,
                "image": None,
                "message": None,
                "effect": None,
                "last_ping": None,
                "current_url": None,
            }
        )

    # Auto-register
    if user not in clients:
        clients[user] = {
            "banned": False,
            "redirect": None,
            "image": None,
            "message": None,
            "effect": "",
            "last_ping": None,
            "current_url": None,
        }

    status = clients[user]

    # Clear redirect/image/message after sending
    redirect_url = status.get("redirect")
    if redirect_url:
        clients[user]["redirect"] = None

    image_b64 = status.get("image")
    if image_b64:
        clients[user]["image"] = None

    message_text = status.get("message")
    if message_text:
        clients[user]["message"] = None

    # Update last ping + URL
    last_ping = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    clients[user]["last_ping"] = last_ping
    clients[user]["current_url"] = current_url or status.get("current_url")

    save_json(CLIENTS_JSON, clients)

    return jsonify(
        {
            "banned": status.get("banned", False),
            "redirect": redirect_url if not LOCKDOWN_ACTIVE else LOCKDOWN_URL,
            "image": image_b64,
            "message": message_text,
            "effect": normalize_client_effect(status.get("effect")),
            "last_ping": last_ping,
            "current_url": clients[user]["current_url"],
            "lockdown": LOCKDOWN_ACTIVE,
        }
    )


@app.route("/lockdown", methods=["POST"])
def lockdown():
    global LOCKDOWN_ACTIVE, LOCKDOWN_URL
    action = request.form.get("action")
    url = request.form.get("url", "https://www.google.com")
    if action == "on":
        LOCKDOWN_ACTIVE = True
        LOCKDOWN_URL = url
    else:
        LOCKDOWN_ACTIVE = False
    return jsonify({"success": True, "lockdown": LOCKDOWN_ACTIVE, "url": LOCKDOWN_URL})


@app.route("/lockdown.json")
def lockdown_status():
    return jsonify({"active": LOCKDOWN_ACTIVE, "url": LOCKDOWN_URL})


# ========================
# RUN APP
# ========================

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
