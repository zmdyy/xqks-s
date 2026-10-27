#!/usr/bin/env python3
"""Local-only service lifecycle. Daily Windows entry: start_system.vbs."""
from __future__ import annotations
import contextlib
import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get('SCORE_LOCAL_PORT', '5500'))
BASE_URL = f'http://127.0.0.1:{PORT}'
APP_ID = 'score-analysis-local-v1'
PROJECT_ID = hashlib.sha256(os.path.normcase(str(ROOT)).encode('utf-8')).hexdigest()[:24]
RUNTIME_HOME = Path(os.environ.get('SCORE_RUNTIME_HOME') or str(Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'ScoreAnalysisLocal'))
RUNTIME = RUNTIME_HOME / PROJECT_ID / str(PORT)
LOG = RUNTIME / 'service.log'
STATE = RUNTIME / 'service.json'
HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_json(path, *, token=None):
    req = urllib.request.Request(BASE_URL + path, method='POST' if token else 'GET')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    with HTTP.open(req, timeout=1) as response:
        return json.load(response)


def status():
    try:
        data = http_json('/__local_service__/status')
        return data if data.get('app_id') == APP_ID else None
    except (OSError, ValueError, AttributeError):
        return None


def port_used():
    with socket.socket() as probe:
        probe.settimeout(.4)
        return probe.connect_ex(('127.0.0.1', PORT)) == 0


def matching(data):
    return bool(data and data.get('project_id') == PROJECT_ID)


@contextlib.contextmanager
def launch_lock():
    RUNTIME_HOME.mkdir(parents=True, exist_ok=True)
    with (RUNTIME_HOME / f'port-{PORT}.lock').open('a+b') as lock:
        lock.seek(0, 2)
        if not lock.tell():
            lock.write(b'0')
            lock.flush()
        deadline = time.monotonic() + 20
        while True:
            try:
                lock.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError('另一个启动操作尚未完成，请稍后重试。')
                time.sleep(.15)
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


def open_page():
    if os.environ.get('SCORE_NO_BROWSER') != '1':
        webbrowser.open(BASE_URL + '/index.html')


def ensure_running():
    with launch_lock():
        current = status()
        if current:
            if not matching(current):
                raise RuntimeError(f'端口 {PORT} 正由另一份学情系统使用。请先在那份程序中运行 stop_local.bat，再启动本版本。')
            return current
        if port_used():
            raise RuntimeError(f'端口 {PORT} 已被占用。如果旧版黑色窗口还开着，请关闭它后再启动；不会停止其他程序。')
        RUNTIME.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 5 * 1024 * 1024:
            LOG.replace(RUNTIME / 'service.previous.log')
        instance = secrets.token_hex(16)
        env = os.environ.copy()
        env.update(PORT=str(PORT), MINERU_PORT=str(PORT), MINERU_SERVE_APP='1', HOST='127.0.0.1', PYTHONUNBUFFERED='1',
                   SCORE_SERVICE_TOKEN=secrets.token_urlsafe(32), SCORE_SERVICE_INSTANCE=instance, PYTHONIOENCODING='utf-8')
        executable = Path(sys.executable)
        if os.name == 'nt' and executable.with_name('pythonw.exe').exists():
            executable = executable.with_name('pythonw.exe')
        options = {'cwd': str(ROOT), 'env': env, 'stdin': subprocess.DEVNULL, 'close_fds': True}
        if os.name == 'nt':
            options['creationflags'] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            options['start_new_session'] = True
        with LOG.open('ab', buffering=0) as stream:
            child = subprocess.Popen([str(executable), str(Path(__file__).resolve()), 'serve'], stdout=stream, stderr=stream, **options)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            current = status()
            if matching(current) and current.get('instance') == instance:
                return current
            if child.poll() is not None:
                raise RuntimeError('本地服务未能启动。请运行 diagnose_local.bat 查看诊断日志。')
            time.sleep(.2)
        raise RuntimeError('本地服务启动超时。请运行 diagnose_local.bat 查看日志后重试。')


def stop_service():
    with launch_lock():
        current = status()
        if not current:
            if port_used():
                raise RuntimeError('此端口不是由新版启动器管理的服务，请关闭原来的服务窗口；不会停止其他程序。')
            print('本地服务未运行。')
            return
        if not matching(current):
            raise RuntimeError('此端口由另一份程序使用，请运行那份程序的 stop_local.bat。')
        try:
            state = json.loads(STATE.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise RuntimeError('找不到本次启动的控制记录。请查看诊断日志，不会按进程名强行停止程序。') from error
        if state.get('instance') != current.get('instance'):
            raise RuntimeError('启动记录不匹配，未停止服务。请运行诊断入口。')
        http_json('/__local_service__/stop', token=state['token'])
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            running = status()
            if not running or running.get('instance') != current['instance']:
                print('本地服务已停止。')
                return
            time.sleep(.2)
        raise RuntimeError('服务尚未退出，请稍后通过诊断入口检查。')


def serve():
    # Cloud deployments still run the original mineru_server.py / gunicorn.
    if sys.stdout is None:
        sys.stdout = LOG.open('a', encoding='utf-8', buffering=1)
    if sys.stderr is None:
        sys.stderr = sys.stdout
    import mineru_server
    from flask import abort, jsonify, request
    from werkzeug.serving import make_server
    token = os.environ.pop('SCORE_SERVICE_TOKEN')
    instance = os.environ.pop('SCORE_SERVICE_INSTANCE')
    app = mineru_server.app
    server = make_server('127.0.0.1', PORT, app, threaded=True)

    @app.get('/__local_service__/status')
    def service_status():
        return jsonify(app_id=APP_ID, project_id=PROJECT_ID, instance=instance, pid=os.getpid())

    @app.post('/__local_service__/stop')
    def service_stop():
        origin = request.headers.get('Origin')
        if request.remote_addr not in ('127.0.0.1', '::1') or origin or not secrets.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + token):
            abort(403)
        threading.Thread(target=server.shutdown, daemon=True).start()
        return jsonify(ok=True)

    RUNTIME.mkdir(parents=True, exist_ok=True)
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps({'instance': instance, 'token': token, 'pid': os.getpid()}), encoding='utf-8')
    temp.replace(STATE)
    print(f'Local service ready: {BASE_URL}/index.html; pid={os.getpid()}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        try:
            if json.loads(STATE.read_text(encoding='utf-8')).get('instance') == instance:
                STATE.unlink()
        except (OSError, ValueError):
            pass
        print('Local service stopped.', flush=True)


def diagnose():
    print('Local service diagnostic / 本地服务诊断', flush=True)
    print(f'程序目录：{ROOT}\n日志文件：{LOG}', flush=True)
    try:
        current = ensure_running()
        print(f'服务已运行：{BASE_URL}  PID={current["pid"]}', flush=True)
        open_page()
    except Exception as error:
        print(f'启动检查失败：{error}', flush=True)
        if LOG.exists():
            print(LOG.read_text(encoding='utf-8', errors='replace')[-20000:], flush=True)
        return 1
    print('下面显示实时日志。关闭此诊断窗口不会停止后台服务；退出服务请运行 stop_local.bat。', flush=True)
    with LOG.open('r', encoding='utf-8', errors='replace') as stream:
        stream.seek(max(0, LOG.stat().st_size - 20000))
        while True:
            line = stream.readline()
            if line:
                print(line, end='', flush=True)
            else:
                if not matching(status()):
                    print('\n本地服务已退出。', flush=True)
                    return 0
                time.sleep(.5)


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'start'
    try:
        if action == 'serve':
            serve()
        elif action == 'start':
            ensure_running()
            open_page()
        elif action == 'diagnose':
            return diagnose()
        elif action == 'stop':
            stop_service()
        else:
            raise ValueError('Unknown action: ' + action)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception as error:
        RUNTIME.mkdir(parents=True, exist_ok=True)
        with (RUNTIME / 'launcher-error.log').open('a', encoding='utf-8') as stream:
            traceback.print_exc(file=stream)
        text = str(error) + '\n\n运行 diagnose_local.bat 可查看诊断。\n日志位置：' + str(RUNTIME)
        if os.name == 'nt' and action == 'start':
            ctypes.windll.user32.MessageBoxW(None, text, '学情系统启动失败', 0x10)
        elif sys.stderr:
            print(text, file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
