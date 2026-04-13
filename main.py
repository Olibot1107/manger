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
from html import escape
from pathlib import Path
import subprocess, tempfile, threading, os, shutil, psutil, time, json, uuid, re
from urllib.parse import urljoin
from werkzeug.utils import secure_filename
from flask_cors import CORS
from datetime import datetime
import base64
import requests

BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
CORS(app)  # This allows all routes to accept cross-origin requests

# ========================
# CONFIG
# ========================
start_time = time.time()
URLS_FILE = BASE_DIR / "urls.json"

CLIENTS_JSON = BASE_DIR / "clients.json"
LOCKDOWN_ACTIVE = False
LOCKDOWN_URL = "https://www.google.com"
TIMEOUT = 10
MAX_OUTPUT_SIZE = 50_000
NODE_PATH = shutil.which("node") or "node"
ALLOWED_CLIENT_EFFECTS = {
    "",
    "invert",
    "french",
    "party",
    "mirror",
    "tiny",
    "glitch",
    "sepia",
    "gray",
    "rainbow",
    "wobble",
    "comic",
    "zoom",
    "blur",
    "flipv",
    "neon",
    "scanlines",
    "pulse",
    "skew",
    "spin",
    "confetti",
}
DATA_LOCK = threading.RLock()

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
    file = Path(file)
    tmp_file = file.with_suffix(file.suffix + ".tmp")
    with DATA_LOCK:
        with open(tmp_file, "w") as f:
            json.dump(data, f, indent=2, sort_keys=True)
        os.replace(tmp_file, file)


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
        safe_sid = escape(sid)
        safe_target = escape(target)
        html += f"<li><a href='/{safe_sid}' target='_blank'>/{safe_sid}</a> -&gt; {safe_target} <form style='display:inline' method='post'><input type='hidden' name='short_id' value='{safe_sid}'><button type='submit' name='action' value='delete'>Delete</button></form></li>"
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
# RUN APP
# ========================

from client_routes import register_routes as register_client_routes

register_client_routes(
    app,
    {
        "clients": clients,
        "clients_json_path": CLIENTS_JSON,
        "data_lock": DATA_LOCK,
        "save_json": save_json,
        "normalize_client_effect": normalize_client_effect,
        "lockdown": {"active": LOCKDOWN_ACTIVE, "url": LOCKDOWN_URL},
    },
)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
