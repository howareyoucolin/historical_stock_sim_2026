"""Persistent StockSimulate2026 CLI shell driver.

Launches `npm run cli` once as a long-lived interactive process and talks to it
request/response style, so the heavy tsx startup is paid a single time instead of
per command. This is the CLI-only access path used by the strategy tools here:
every read and every trade goes through the same `npm run cli -- ...` surface a
human would use, so the sim-date data bound is always honored.

Usage:
    from cli_shell import Shell
    sh = Shell(session="default")
    sh.cmd("account init")            # session flag is appended automatically
    data = sh.js("stock status AAPL --json")
    sh.close()
"""
import subprocess, os, re, json

SIM_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# dev.sh pins Node 22 (v16 default lacks global fetch, which the CLI needs).
_NODE22 = os.path.expanduser("~/.nvm/versions/node/v22.22.3/bin")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_PROMPT = "stocksimulate>"


class Shell:
    # Start the interactive CLI and read past the welcome banner to the first prompt.
    def __init__(self, session="default", cwd=SIM_DIR):
        env = dict(os.environ)
        if os.path.isdir(_NODE22):
            env["PATH"] = _NODE22 + ":" + env["PATH"]
        self.session = session
        self.p = subprocess.Popen(
            ["npm", "run", "--silent", "cli"],
            cwd=cwd, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
        self._read_to_prompt()

    # Read stdout one char at a time until the shell prints its next prompt.
    def _read_to_prompt(self):
        buf = []
        while True:
            ch = self.p.stdout.read(1)
            if ch == "":
                raise RuntimeError("CLI shell closed unexpectedly:\n" + "".join(buf)[-500:])
            buf.append(ch)
            if _PROMPT in _ANSI.sub("", "".join(buf[-len(_PROMPT) - 2:])):
                break
        return _ANSI.sub("", "".join(buf))

    # Send one command and return its cleaned text output. The TRUE default session
    # takes NO --session flag (that is what the browser UI at :8600 and the upload
    # skill read); only a real named session gets the flag appended.
    def cmd(self, c):
        if self.session and self.session != "default" and "--session=" not in c:
            c = f"{c} --session={self.session}"
        self.p.stdin.write(c + "\n")
        self.p.stdin.flush()
        out = self._read_to_prompt()
        return out.replace(_PROMPT, "").strip()

    # Same as cmd() but parse the JSON payload; raises with context on bad JSON.
    def js(self, c):
        if "--json" not in c:
            c = c + " --json"
        out = self.cmd(c)
        try:
            return json.loads(out)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Non-JSON reply to `{c}`:\n{out[:500]}") from e

    def close(self):
        try:
            self.p.stdin.write("exit\n")
            self.p.stdin.flush()
            self.p.wait(timeout=5)
        except Exception:
            self.p.kill()
